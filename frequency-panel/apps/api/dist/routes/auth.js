import { Router } from 'express';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { login, refreshSession, sessionFromDiscordOAuthUser, sessionFromRegisteredDiscordUser } from '../auth.js';
import { requireAuth } from '../middleware.js';
import { auditLog, getClientIp } from '../security.js';
import { env } from '../env.js';
import { updateSiteUser } from '../services/site-users.js';
export const authRouter = Router();
const loginAttempts = new Map();
const loginWindowMs = readPositiveIntEnv('LOGIN_RATE_LIMIT_WINDOW_MS', 10 * 60 * 1000);
const loginMaxAttempts = readPositiveIntEnv('LOGIN_RATE_LIMIT_MAX', 8);
const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/'
};
function readPositiveIntEnv(name, fallback) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}
function limitLoginAttempts(req, res, next) {
    const now = Date.now();
    const key = getClientIp(req);
    if (loginAttempts.size > 1000)
        cleanupExpiredAttempts(now);
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
        if (bucket.resetAt <= now)
            loginAttempts.delete(key);
    }
}
authRouter.post('/login', limitLoginAttempts, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const parsed = z.object({
        email: z.string().email(),
        password: z.string().min(1)
    }).safeParse(req.body || {});
    if (!parsed.success)
        return res.status(400).json({ ok: false, error: 'Invalid login data' });
    const session = await login(parsed.data.email, parsed.data.password);
    if (!session) {
        await auditLog(req, 'auth.login.failed', { email: parsed.data.email.toLowerCase() });
        return res.status(401).json({ ok: false, error: 'Invalid credentials' });
    }
    loginAttempts.delete(getClientIp(req));
    req.user = session.user;
    setSessionCookies(res, session.token, session.refreshToken);
    await auditLog(req, 'auth.login.success', { email: session.user.email });
    return res.json({ ok: true, user: session.user });
});
authRouter.get('/discord/start', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const missing = firstMissingEnv(['SITE_ORIGIN', 'DISCORD_CLIENT_ID', 'DISCORD_OAUTH_REDIRECT_URI']);
    if (missing) {
        console.warn('[frequency-api] OAuth Discord start bloqueado por config ausente', { missing });
        return res.status(503).json({ ok: false, error: missingOAuthPublicMessage() });
    }
    const next = decodeNext(req.query.next);
    const state = encodeState(next);
    const params = new URLSearchParams({
        client_id: env.discordClientId,
        redirect_uri: env.discordOauthRedirectUri,
        response_type: 'code',
        scope: 'identify email guilds',
        prompt: 'consent',
        state
    });
    console.info('[frequency-api] OAuth Discord start', {
        clientId: maskValue(env.discordClientId),
        redirectUri: env.discordOauthRedirectUri,
        next
    });
    return res.redirect(`https://discord.com/oauth2/authorize?${params.toString()}`);
});
authRouter.get('/discord/callback', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const code = String(req.query.code || '');
    const discordError = String(req.query.error_description || req.query.error || '');
    const state = decodeState(req.query.state);
    const next = state.next;
    if (!code) {
        if (discordError)
            console.warn('[frequency-api] OAuth Discord callback sem code', { discordError });
        return res.redirect(`${loginUrl()}?error=missing_code`);
    }
    if (!state.ok)
        return res.redirect(`${loginUrl()}?error=${encodeURIComponent('invalid_state')}`);
    const missing = firstMissingEnv(['SITE_ORIGIN', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'DISCORD_OAUTH_REDIRECT_URI']);
    if (missing) {
        console.warn('[frequency-api] OAuth Discord callback bloqueado por config ausente', { missing });
        return res.redirect(`${loginUrl()}?error=${encodeURIComponent(missingOAuthPublicMessage())}`);
    }
    try {
        console.info('[frequency-api] OAuth Discord callback recebido', { next, codeLength: code.length });
        const token = await exchangeDiscordCode(code);
        const discordUser = await fetchDiscordUser(token.access_token);
        const discordGuilds = await fetchDiscordGuilds(token.access_token);
        const avatarUrl = discordAvatarUrl(discordUser);
        const result = await sessionFromDiscordOAuthUser({
            guildId: env.discordGuildId,
            discordId: discordUser.id,
            username: discordUser.username || discordUser.id,
            displayName: discordUser.global_name || discordUser.username || discordUser.id,
            email: discordUser.email || null,
            avatar: avatarUrl,
            guilds: discordGuilds.map((guild) => guild.id)
        });
        if (!result.ok) {
            await auditLog(req, 'auth.discord.denied', { discord_id: discordUser.id, reason: result.error });
            return res.redirect(`${loginUrl()}?error=${encodeURIComponent(result.error)}`);
        }
        const sessionGuildId = result.session.user.guildId || env.discordGuildId;
        const guildMember = await fetchDiscordGuildMember(discordUser.id, sessionGuildId);
        req.user = result.session.user;
        await updateSiteUser(discordUser.id, {
            discord_name: discordUser.global_name || discordUser.username || discordUser.id,
            discord_email: discordUser.email || null,
            discord_avatar_url: avatarUrl,
            discord_roles: Array.isArray(guildMember.member?.roles) ? guildMember.member.roles.map(String) : [],
            discord_guilds: discordGuilds.map((guild) => guild.id)
        }, sessionGuildId).catch((error) => {
            console.warn('[frequency-api] OAuth Discord nao atualizou site_user existente', {
                discordId: discordUser.id,
                error: error instanceof Error ? error.message : String(error)
            });
        });
        setSessionCookies(res, result.session.token, result.session.refreshToken);
        await auditLog(req, 'auth.discord.success', { discord_id: discordUser.id });
        console.info('[frequency-api] OAuth Discord login concluido', {
            discordId: discordUser.id,
            username: discordUser.username,
            guildCount: discordGuilds.length,
            redirectTo: `${env.siteOrigin}${next}`
        });
        return res.redirect(`${env.siteOrigin}${next}`);
    }
    catch (error) {
        console.warn('[frequency-api] Falha no OAuth Discord:', error);
        await auditLog(req, 'auth.discord.failed');
        return res.redirect(`${loginUrl()}?error=${encodeURIComponent(publicOAuthErrorMessage(error))}`);
    }
});
authRouter.post('/discord-id', limitLoginAttempts, async (req, res) => {
    if (!env.discordIdLoginEnabled) {
        return res.status(403).json({ ok: false, error: 'Login por Discord ID esta desativado. Use Discord OAuth2.' });
    }
    const parsed = z.object({
        discordId: z.string().regex(/^\d{15,25}$/)
    }).safeParse(req.body || {});
    if (!parsed.success)
        return res.status(400).json({ ok: false, error: 'Discord ID invalido' });
    const result = await sessionFromRegisteredDiscordUser({
        guildId: env.discordGuildId,
        discordId: parsed.data.discordId,
        discordName: parsed.data.discordId
    });
    if (!result.ok)
        return res.status(403).json({ ok: false, error: result.error });
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
    if (!parsed.success)
        return res.status(400).json({ ok: false, error: 'Invalid refresh data' });
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
function setSessionCookies(res, token, refreshToken) {
    res.cookie('vortex_access_token', token, { ...cookieOptions, maxAge: 2 * 60 * 60 * 1000 });
    res.cookie('vortex_refresh_token', refreshToken, { ...cookieOptions, maxAge: 7 * 24 * 60 * 60 * 1000 });
}
function clearSessionCookies(res) {
    res.clearCookie('vortex_access_token', cookieOptions);
    res.clearCookie('vortex_refresh_token', cookieOptions);
}
function getCookie(req, name) {
    const cookies = String(req.headers.cookie || '').split(';');
    for (const cookie of cookies) {
        const [key, ...value] = cookie.trim().split('=');
        if (key === name)
            return decodeURIComponent(value.join('='));
    }
    return '';
}
function decodeNext(value) {
    const next = String(value || '/dashboard');
    if (!next.startsWith('/') || next.startsWith('//'))
        return '/dashboard';
    return next;
}
function firstMissingEnv(names) {
    return names.find((name) => !envValueByName(name)?.trim()) || '';
}
function envValueByName(name) {
    if (name === 'SITE_ORIGIN')
        return env.siteOrigin;
    if (name === 'DISCORD_CLIENT_ID')
        return env.discordClientId;
    if (name === 'DISCORD_CLIENT_SECRET')
        return env.discordClientSecret;
    if (name === 'DISCORD_OAUTH_REDIRECT_URI')
        return env.discordOauthRedirectUri;
    return process.env[name] || '';
}
function missingOAuthPublicMessage() {
    return 'Login Discord indisponivel no momento. Configure o OAuth2 no servidor.';
}
function encodeState(next) {
    const payload = {
        next: decodeNext(next),
        nonce: randomBytes(16).toString('hex'),
        iat: Date.now()
    };
    const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = signStateData(data);
    return `${data}.${signature}`;
}
function decodeState(value) {
    const raw = String(value || '');
    const [data, signature] = raw.split('.');
    if (!data || !signature || !safeEqual(signature, signStateData(data)))
        return { ok: false, next: '/dashboard' };
    try {
        const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
        if (!payload.iat || Date.now() - payload.iat > 15 * 60 * 1000)
            return { ok: false, next: '/dashboard' };
        return { ok: true, next: decodeNext(payload.next) };
    }
    catch {
        return { ok: false, next: '/dashboard' };
    }
}
function signStateData(data) {
    return createHmac('sha256', env.jwtSecret).update(data).digest('base64url');
}
function safeEqual(left, right) {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
function loginUrl() {
    return `${env.siteOrigin}/login`;
}
function maskValue(value) {
    if (value.length <= 8)
        return '***';
    return `${value.slice(0, 4)}...${value.slice(-4)}`;
}
class DiscordOAuthError extends Error {
    constructor(message, publicMessage = 'Falha ao validar login Discord.') {
        super(message);
        this.name = 'DiscordOAuthError';
        this.publicMessage = publicMessage;
    }
    publicMessage;
}
function publicOAuthErrorMessage(error) {
    if (error instanceof DiscordOAuthError)
        return error.publicMessage;
    return 'Falha ao validar login Discord.';
}
async function exchangeDiscordCode(code) {
    if (!env.discordClientId || !env.discordClientSecret || !env.discordOauthRedirectUri) {
        throw new DiscordOAuthError('Discord OAuth2 nao configurado', missingOAuthPublicMessage());
    }
    const response = await fetch('https://discord.com/api/oauth2/token', {
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
    if (!response.ok) {
        const body = await response.text().catch(() => '');
        const discordError = parseDiscordErrorBody(body);
        console.warn('[frequency-api] Discord token exchange falhou', {
            status: response.status,
            clientId: maskValue(env.discordClientId),
            redirectUri: env.discordOauthRedirectUri,
            body: body.slice(0, 500)
        });
        throw new DiscordOAuthError(`Discord token HTTP ${response.status}: ${discordError.raw || body.slice(0, 200)}`, oauthTokenPublicMessage(response.status, discordError));
    }
    return response.json();
}
function parseDiscordErrorBody(body) {
    try {
        const parsed = JSON.parse(body);
        return {
            code: String(parsed.error || ''),
            description: String(parsed.error_description || parsed.message || ''),
            raw: body
        };
    }
    catch {
        return { code: '', description: body, raw: body };
    }
}
function oauthTokenPublicMessage(status, discordError) {
    const detail = `${discordError.code} ${discordError.description}`.toLowerCase();
    if (detail.includes('invalid_client')) {
        return 'Discord OAuth recusou as credenciais da aplicacao. Confira o Client ID e o Client Secret no painel do Discord.';
    }
    if (detail.includes('redirect') || detail.includes('invalid_grant')) {
        return 'Discord OAuth recusou o callback. Confira se DISCORD_OAUTH_REDIRECT_URI e o Redirect do Discord Developer Portal sao identicos.';
    }
    if (status === 401) {
        return 'Discord OAuth nao autorizou a aplicacao. Confira as credenciais no painel do Discord.';
    }
    return `Discord OAuth retornou HTTP ${status}. Confira os logs do frequency-api.`;
}
async function fetchDiscordUser(accessToken) {
    const response = await fetch('https://discord.com/api/users/@me', {
        headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!response.ok)
        throw new Error(`Discord user HTTP ${response.status}`);
    return response.json();
}
async function fetchDiscordGuilds(accessToken) {
    const response = await fetch('https://discord.com/api/users/@me/guilds', {
        headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!response.ok)
        return [];
    const guilds = await response.json().catch(() => []);
    return Array.isArray(guilds) ? guilds.map((guild) => ({ id: String(guild.id || '') })).filter((guild) => guild.id) : [];
}
async function fetchDiscordGuildMember(discordId, guildId = env.discordGuildId) {
    if (!env.discordBotToken || !guildId)
        return { ok: false };
    const response = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${discordId}`, {
        headers: { Authorization: `Bot ${env.discordBotToken}` }
    });
    return { ok: response.ok, member: response.ok ? await response.json() : null };
}
function discordAvatarUrl(user) {
    return user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128` : null;
}
