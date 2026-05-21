import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { ensureAdminUser } from './auth.js';
import { env } from './env.js';
import { requireAuth } from './middleware.js';
import { authRouter } from './routes/auth.js';
import { dashboardRouter } from './routes/dashboard.js';
import { eventsRouter } from './events.js';
import { ingestRouter } from './routes/ingest.js';
import { membersRouter } from './routes/members.js';

const app = express();

app.use(helmet());
app.use(cors({ origin: env.apiOrigin, credentials: true }));
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'vortex-frequency-api' });
});

app.use('/auth', authRouter);
app.use('/events', eventsRouter);
app.use('/ingest', ingestRouter);
app.use('/dashboard', requireAuth, dashboardRouter);
app.use('/members', requireAuth, membersRouter);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ ok: false, error: 'Internal server error' });
});

await ensureAdminUser();

app.listen(env.apiPort, () => {
  console.log(`Vortex Frequency API running on port ${env.apiPort}`);
});
