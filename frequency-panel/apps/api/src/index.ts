import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { ensureAdminUser } from './auth.js';
import { env } from './env.js';
import { requireAuth } from './middleware.js';
import { authRouter } from './routes/auth.js';
import { bauRouter } from './routes/bau.js';
import { botVortexRouter } from './routes/bot-vortex.js';
import { dashboardRouter } from './routes/dashboard.js';
import { eventsRouter } from './events.js';
import { ingestRouter } from './routes/ingest.js';
import { livesRouter } from './routes/lives.js';
import { memberAvatarHandler, membersRouter } from './routes/members.js';

const app = express();

app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({ origin: env.apiOrigin, credentials: true }));
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'vortex-frequency-api' });
});

app.use('/auth', authRouter);
app.use('/events', eventsRouter);
app.use('/ingest', ingestRouter);
app.use('/bau', requireAuth, bauRouter);
app.use('/bot-vortex', requireAuth, botVortexRouter);
app.use('/dashboard', requireAuth, dashboardRouter);
app.use('/lives', requireAuth, livesRouter);
app.get('/members/:id/avatar', memberAvatarHandler);
app.use('/members', requireAuth, membersRouter);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ ok: false, error: 'Internal server error' });
});

await ensureAdminUser();

app.listen(env.apiPort, () => {
  console.log(`Vortex Frequency API running on port ${env.apiPort}`);
});
