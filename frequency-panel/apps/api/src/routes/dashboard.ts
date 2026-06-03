import { Router } from 'express';
import { dashboardMetrics } from '../services/metrics.js';

export const dashboardRouter = Router();

dashboardRouter.get('/metrics', async (_req, res) => {
  try {
    const data = await dashboardMetrics();
    return res.json({ ok: true, ...data });
  } catch (error) {
    console.warn('[frequency-api] Dashboard sem MongoDB/dados sincronizados:', error);
    return res.json({
      ok: true,
      metrics: {
        total_members: 0,
        active_members: 0,
        open_points: 0,
        month_seconds: 0
      },
      trend: [],
      activity: []
    });
  }
});
