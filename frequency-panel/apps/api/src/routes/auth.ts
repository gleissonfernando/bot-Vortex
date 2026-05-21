import { Router } from 'express';
import { z } from 'zod';
import { login } from '../auth.js';
import { requireAuth } from '../middleware.js';

export const authRouter = Router();

authRouter.post('/login', async (req, res) => {
  const parsed = z.object({
    email: z.string().email(),
    password: z.string().min(1)
  }).safeParse(req.body);

  if (!parsed.success) return res.status(400).json({ ok: false, error: 'Invalid login data' });

  const session = await login(parsed.data.email, parsed.data.password);
  if (!session) return res.status(401).json({ ok: false, error: 'Invalid credentials' });

  return res.json({ ok: true, ...session });
});

authRouter.get('/me', requireAuth, (req, res) => {
  return res.json({ ok: true, user: req.user });
});
