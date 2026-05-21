import type { NextFunction, Request, Response } from 'express';
import { env } from './env.js';
import { verifyToken, type SessionUser } from './auth.js';

declare global {
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const user = token ? verifyToken(token) : null;
  if (!user) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  req.user = user;
  next();
}

export function requireManager(req: Request, res: Response, next: NextFunction) {
  if (!req.user || !['admin', 'manager'].includes(req.user.role)) {
    return res.status(403).json({ ok: false, error: 'Forbidden' });
  }
  next();
}

export function requireIngestSecret(req: Request, res: Response, next: NextFunction) {
  const secret = String(req.headers['x-ingest-secret'] || '');
  if (!secret || secret !== env.ingestSecret) {
    return res.status(401).json({ ok: false, error: 'Invalid ingest secret' });
  }
  next();
}
