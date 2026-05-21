import { Router } from 'express';
import { dashboardMetrics } from '../services/reports.js';

export const dashboardRouter = Router();

dashboardRouter.get('/metrics', async (_req, res) => {
  const data = await dashboardMetrics();
  return res.json({ ok: true, ...data });
});
