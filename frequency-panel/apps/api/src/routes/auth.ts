import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { login, refreshSession, sessionFromRegisteredDiscordUser } from '../auth.js';
import { requireAuth } from '../middleware.js';
import { auditLog } from '../security.js';
import { env } from '../env.js';
import { updateSiteUser } from '../services/site-users.js';

export const authRouter = Router();

type LoginBucket = {
  count: number;
  resetAt: number;
};

const loginAttempts = new Map<string, LoginBucket>();
const loginWindowMs = readPositiveIntEnv('LOGIN_RATE_LIMIT_WINDOW_MS', 10 * 60 * 1000);
const loginMaxAttempts = readPositiveIntEnv('LOGIN_RATE_LIMIT_MAX', 8);
const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/'
};

function readPositiveIntEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function getClientKey(req: Request) {
  const forwardedFor = String(req.headers['x-forwarded-for'] || '').split(',')[0]?.trim();
  return forwardedFor || req.ip || req.socket.remoteAddress || 'unknown';
}

function limitLoginAttempts(req: Request, res: Response, next: NextFunction) {
  const now = Date.now();
  const key = getClientKey(req);
  if (loginAttempts.size > 1000) cleanupExpiredAttempts(now);
  const bucket = loginAttempts.get(key);

  if (!bucket || bucket.resetAt <= now) {
    loginAttempts.set(key, { count: 1, resetAt: now + loginWindowMs });
    return next();
  }

  bucket.count += 1;
  if (bucket.count > loginMaxAttempts) {
    res.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
    return res.status(429).json({ ok: false, error: 'Muitas tentativas. Tente novamente em alguns minutos.' });
  }

  return next();
}

function cleanupExpiredAttempts(now = Date.now()) {
  for (const [key, bucket] of loginAttempts) {
    if (bucket.resetAt <= now) loginAttempts.delete(key);
  }
}

authRouter.post('/login', limitLoginAttempts, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  const parsed = z.object({
    email: z.string().email(),
    password: z.string().min(1)
  }).safeParse(req.body || {});

  if (!parsed.success) return res.status(400).json({ ok: false, error: 'Invalid login data' });

  const session = await login(parsed.data.email, parsed.data.password);
  if (!session) {
    await auditLog(req, 'auth.login.failed', { email: parsed.data.email.toLowerCase() });
    return res.status(401).json({ ok: false, error: 'Invalid credentials' });
  }

  loginAttempts.delete(getClientKey(req));
  req.user = session.user;
  setSessionCookies(res, session.token, session.refreshToken);
  await auditLog(req, 'auth.login.success', { email: session.user.email });
  return res.json({ ok: true, user: session.user });
});

authRouter.get('/discord/start', (req, res) => {
  if (!env.discordClientId || !env.discordOauthRedirectUri) {
    return res.status(503).json({ ok: false, error: 'OAuth2 do Discord nao configurado.' });
  }

  const state = encodeURIComponent(String(req.query.next || '/dashboard'));
  const params = new URLSearchParams({
    client_id: env.discordClientId,
    redirect_uri: env.discordOauthRedirectUri,
    response_type: 'code',
    scope: 'identify email guilds',
    prompt: 'none',
    state
  });

  return res.redirect(`https://discord.com/oauth2/authorize?${params.toString()}`);
});

authRouter.get('/discord/callback', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  const code = String(req.query.code || '');
  const next = decodeNext(req.query.state);
  if (!code) return res.redirect(`${env.siteOrigin}/?error=${encodeURIComponent('Login Discord invalido.')}`);

  try {
    const token = await exchangeDiscordCode(code);
    const discordUser = await fetchDiscordUser(token.access_token);
    const discordGuilds = await fetchDiscordGuilds(token.access_token);
    const guildMember = await fetchDiscordGuildMember(discordUser.id);
    if (!guildMember.ok) {
      await auditLog(req, 'auth.discord.guild_check.failed', { discord_id: discordUser.id });
      return res.redirect(`${env.siteOrigin}/?error=${encodeURIComponent('Acesso negado. Voce nao esta no servidor Discord autorizado.')}`);
    }

    const result = await sessionFromRegisteredDiscordUser({
      guildId: env.discordGuildId,
      discordId: discordUser.id,
      discordName: discordUser.global_name || discordUser.username || discordUser.id
    });

    if (!result.ok) {
      await auditLog(req, 'auth.discord.denied', { discord_id: discordUser.id, reason: result.error });
      return res.redirect(`${env.siteOrigin}/?error=${encodeURIComponent(result.error)}`);
    }

    req.user = result.session.user;
    await updateSiteUser(discordUser.id, {
      discord_name: discordUser.global_name || discordUser.username || discordUser.id,
      discord_email: discordUser.email || null,
      discord_avatar_url: discordAvatarUrl(discordUser),
      discord_roles: Array.isArray(guildMember.member?.roles) ? guildMember.member.roles.map(String) : [],
      discord_guilds: discordGuilds.map((guild) => guild.id)
    } as any, env.discordGuildId);
    setSessionCookies(res, result.session.token, result.session.refreshToken);
    await auditLog(req, 'auth.discord.success', { discord_id: discordUser.id });
    return res.redirect(`${env.siteOrigin}${next}`);
  } catch (error) {
    console.warn('[frequency-api] Falha no OAuth Discord:', error);
    await auditLog(req, 'auth.discord.failed');
    return res.redirect(`${env.siteOrigin}/?error=${encodeURIComponent('Falha ao validar login Discord.')}`);
  }
});

authRouter.post('/discord-id', limitLoginAttempts, async (req, res) => {
  if (!env.discordIdLoginEnabled) {
    return res.status(403).json({ ok: false, error: 'Login por Discord ID esta desativado. Use Discord OAuth2.' });
  }

  const parsed = z.object({
    discordId: z.string().regex(/^\d{15,25}$/)
  }).safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ ok: false, error: 'Discord ID invalido' });

  const result = await sessionFromRegisteredDiscordUser({
    guildId: env.discordGuildId,
    discordId: parsed.data.discordId,
    discordName: parsed.data.discordId
  });
  if (!result.ok) return res.status(403).json({ ok: false, error: result.error });

  req.user = result.session.user;
  setSessionCookies(res, result.session.token, result.session.refreshToken);
  await auditLog(req, 'auth.discord_id.success', { discord_id: parsed.data.discordId });
  return res.json({ ok: true, user: result.session.user });
});

authRouter.post('/refresh', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  const parsed = z.object({
    refreshToken: z.string().min(20).optional()
  }).safeParse(req.body || {});

  if (!parsed.success) return res.status(400).json({ ok: false, error: 'Invalid refresh data' });

  const refreshToken = parsed.data.refreshToken || getCookie(req, 'vortex_refresh_token');
  const session = refreshToken ? refreshSession(refreshToken) : null;
  if (!session) {
    await auditLog(req, 'auth.refresh.failed');
    return res.status(401).json({ ok: false, error: 'Invalid refresh token' });
  }

  req.user = session.user;
  setSessionCookies(res, session.token, session.refreshToken);
  await auditLog(req, 'auth.refresh.success');
  return res.json({ ok: true, user: session.user });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  return res.json({ ok: true, user: req.user });
});

authRouter.post('/logout', requireAuth, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  clearSessionCookies(res);
  await auditLog(req, 'auth.logout');
  return res.json({ ok: true });
});

authRouter.post('/password-reset/request', limitLoginAttempts, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  const parsed = z.object({
    email: z.string().email()
  }).safeParse(req.body);

  if (parsed.success) {
    await auditLog(req, 'auth.password_reset.requested', { email: parsed.data.email.toLowerCase() });
  }

  return res.json({ ok: true, message: 'Se o email existir, as instrucoes de recuperacao serao enviadas.' });
});

function setSessionCookies(res: Response, token: string, refreshToken: string) {
  res.cookie('vortex_access_token', token, { ...cookieOptions, maxAge: 2 * 60 * 60 * 1000 });
  res.cookie('vortex_refresh_token', refreshToken, { ...cookieOptions, maxAge: 7 * 24 * 60 * 60 * 1000 });
}

function clearSessionCookies(res: Response) {
  res.clearCookie('vortex_access_token', cookieOptions);
  res.clearCookie('vortex_refresh_token', cookieOptions);
}

function getCookie(req: Request, name: string) {
  const cookies = String(req.headers.cookie || '').split(';');
  for (const cookie of cookies) {
    const [key, ...value] = cookie.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return '';
}

function decodeNext(value: unknown) {
  const next = String(value || '/dashboard');
  if (!next.startsWith('/') || next.startsWith('//')) return '/dashboard';
  return next;
}

async function exchangeDiscordCode(code: string) {
  if (!env.discordClientId || !env.discordClientSecret || !env.discordOauthRedirectUri) {
    throw new Error('Discord OAuth2 nao configurado');
  }

  const response = await fetch('https://discord.com/api/v10/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.discordClientId,
      client_secret: env.discordClientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: env.discordOauthRedirectUri
    })
  });

  if (!response.ok) throw new Error(`Discord token HTTP ${response.status}`);
  return response.json() as Promise<{ access_token: string }>;
}

async function fetchDiscordUser(accessToken: string) {
  const response = await fetch('https://discord.com/api/v10/users/@me', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) throw new Error(`Discord user HTTP ${response.status}`);
  return response.json() as Promise<{ id: string; username?: string; global_name?: string | null; avatar?: string | null; email?: string | null }>;
}

async function fetchDiscordGuilds(accessToken: string) {
  const response = await fetch('https://discord.com/api/v10/users/@me/guilds', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) return [];
  const guilds = await response.json().catch(() => []);
  return Array.isArray(guilds) ? guilds.map((guild) => ({ id: String(guild.id || '') })).filter((guild) => guild.id) : [];
}

async function fetchDiscordGuildMember(discordId: string) {
  if (!env.discordBotToken || !env.discordGuildId) return { ok: false };
  const response = await fetch(`https://discord.com/api/v10/guilds/${env.discordGuildId}/members/${discordId}`, {
    headers: { Authorization: `Bot ${env.discordBotToken}` }
  });
  return { ok: response.ok, member: response.ok ? await response.json() : null };
}

function discordAvatarUrl(user: { id: string; avatar?: string | null }) {
  return user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128` : null;
}
