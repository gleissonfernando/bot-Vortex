import type { NextFunction, Request, Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { env } from './env.js';
import { verifyToken, type SessionUser } from './auth.js';
import { findSiteUser } from './services/site-users.js';

declare global {
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  res.setHeader('Cache-Control', 'no-store');
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : getCookie(req, 'vortex_access_token');
  const user = token ? verifyToken(token) : null;
  if (!user) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  if (user.discordId) {
    const siteUser = await findSiteUser(user.guildId || env.discordGuildId, user.discordId).catch(() => null);
    if (!siteUser || siteUser.status !== 'active') {
      res.clearCookie('vortex_access_token', { path: '/' });
      res.clearCookie('vortex_refresh_token', { path: '/' });
      return res.status(403).json({ ok: false, error: 'Acesso Negado. Sua conta não foi cadastrada pela administração. Solicite a liberação para um responsável autorizado.' });
    }
    user.role = siteUser.system_role;
    user.name = siteUser.discord_name || user.name;
  }
  req.user = user;
  next();
}

export function requireRole(...roles: SessionUser['role'][]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ ok: false, error: 'Forbidden' });
    }
    return next();
  };
}

export function requireManager(req: Request, res: Response, next: NextFunction) {
  if (!req.user || !['admin', 'manager'].includes(req.user.role)) {
    return res.status(403).json({ ok: false, error: 'Forbidden' });
  }
  next();
}

export function requireIngestSecret(req: Request, res: Response, next: NextFunction) {
  const secret = String(req.headers['x-ingest-secret'] || '');
  if (!secret || !safeSecretEqual(secret, env.ingestSecret)) {
    return res.status(401).json({ ok: false, error: 'Invalid ingest secret' });
  }
  next();
}

function safeSecretEqual(input: string, expected: string) {
  const inputBuffer = Buffer.from(input);
  const expectedBuffer = Buffer.from(expected);
  if (inputBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(inputBuffer, expectedBuffer);
}

function getCookie(req: Request, name: string) {
  const cookies = String(req.headers.cookie || '').split(';');
  for (const cookie of cookies) {
    const [key, ...value] = cookie.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return '';
}
