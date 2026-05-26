import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { login } from '../auth.js';
import { requireAuth } from '../middleware.js';

export const authRouter = Router();

type LoginBucket = {
  count: number;
  resetAt: number;
};

const loginAttempts = new Map<string, LoginBucket>();
const loginWindowMs = readPositiveIntEnv('LOGIN_RATE_LIMIT_WINDOW_MS', 10 * 60 * 1000);
const loginMaxAttempts = readPositiveIntEnv('LOGIN_RATE_LIMIT_MAX', 8);

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
  }).safeParse(req.body);

  if (!parsed.success) return res.status(400).json({ ok: false, error: 'Invalid login data' });

  const session = await login(parsed.data.email, parsed.data.password);
  if (!session) return res.status(401).json({ ok: false, error: 'Invalid credentials' });

  loginAttempts.delete(getClientKey(req));
  return res.json({ ok: true, ...session });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  return res.json({ ok: true, user: req.user });
});
