import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { ZodError } from 'zod';
import { ensureAdminUser } from './auth.js';
import { env } from './env.js';
import { requireAuth } from './middleware.js';
import { absencesRouter } from './routes/absences.js';
import { authRouter } from './routes/auth.js';
import { backupsRouter } from './routes/backups.js';
import { bauRouter } from './routes/bau.js';
import { botVortexRouter, getMaintenanceStatus } from './routes/bot-vortex.js';
import { dashboardRouter } from './routes/dashboard.js';
import { eventsRouter } from './events.js';
import { ingestRouter } from './routes/ingest.js';
import { livesRouter, startLiveNotificationMonitor } from './routes/lives.js';
import { memberAvatarHandler, membersRouter } from './routes/members.js';
import { ordersRouter } from './routes/orders.js';
import { siteUsersRouter } from './routes/site-users.js';
import { auditLog, rateLimit, requireTrustedOrigin } from './security.js';
import { scheduleDailyBackup } from './services/backup.js';
const app = express();
app.set('trust proxy', 1);
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            baseUri: ["'self'"],
            frameAncestors: ["'none'"],
            objectSrc: ["'none'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:', 'https:'],
            connectSrc: ["'self'", env.apiOrigin]
        }
    },
    frameguard: { action: 'deny' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));
app.use(cors({ origin: env.apiOrigin, credentials: true }));
app.use(rateLimit({ keyPrefix: 'api', windowMs: env.apiRateLimitWindowMs, max: env.apiRateLimitMax }));
app.use(requireTrustedOrigin);
app.use(express.json({ limit: '2mb' }));
app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'vortex-frequency-api' });
});
app.get('/status/maintenance', (_req, res) => {
    res.json({ ok: true, maintenance: getMaintenanceStatus() });
});
app.use('/auth', authRouter);
app.use('/events', eventsRouter);
app.use('/ingest', ingestRouter);
app.use('/absences', requireAuth, auditSuccessfulMutation, absencesRouter);
app.use('/backups', requireAuth, auditSuccessfulMutation, backupsRouter);
app.use('/bau', requireAuth, auditSuccessfulMutation, bauRouter);
app.use('/bot-vortex', requireAuth, auditSuccessfulMutation, botVortexRouter);
app.use('/dashboard', requireAuth, dashboardRouter);
app.use('/lives', requireAuth, auditSuccessfulMutation, livesRouter);
app.get('/members/:id/avatar', memberAvatarHandler);
app.use('/members', requireAuth, auditSuccessfulMutation, membersRouter);
app.use('/orders', requireAuth, auditSuccessfulMutation, ordersRouter);
app.use('/site-users', requireAuth, auditSuccessfulMutation, siteUsersRouter);
app.use((err, _req, res, _next) => {
    console.error(err);
    if (err instanceof ZodError) {
        const message = err.issues.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`).join('; ');
        return res.status(400).json({ ok: false, error: message || 'Dados invalidos.' });
    }
    res.status(500).json({ ok: false, error: 'Internal server error' });
});
await ensureAdminUser();
scheduleDailyBackup();
startLiveNotificationMonitor();
app.listen(env.apiPort, () => {
    console.log(`Vortex API running on port ${env.apiPort}`);
});
function auditSuccessfulMutation(req, res, next) {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method))
        return next();
    res.on('finish', () => {
        if (res.statusCode < 400) {
            void auditLog(req, 'admin.mutation', { status_code: res.statusCode });
        }
    });
    return next();
}
