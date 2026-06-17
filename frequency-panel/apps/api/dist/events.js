import { Router } from 'express';
import { verifyToken } from './auth.js';
const clients = new Set();
export const eventsRouter = Router();
eventsRouter.get('/', (req, res) => {
    const header = req.headers.authorization || '';
    const headerToken = header.startsWith('Bearer ') ? header.slice(7) : '';
    const queryToken = typeof req.query.token === 'string' ? req.query.token : '';
    const user = verifyToken(headerToken || queryToken);
    if (!user)
        return res.status(401).json({ ok: false, error: 'Unauthorized' });
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
    });
    const send = (event) => {
        res.write(`event: dashboard\n`);
        res.write(`data: ${JSON.stringify({ ...event, at: event.at || new Date().toISOString() })}\n\n`);
    };
    clients.add(send);
    send({ type: 'connected' });
    const heartbeat = setInterval(() => {
        res.write(`event: ping\n`);
        res.write(`data: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
    }, 25_000);
    req.on('close', () => {
        clearInterval(heartbeat);
        clients.delete(send);
    });
});
export function publishDashboardEvent(event) {
    const next = { ...event, at: event.at || new Date().toISOString() };
    for (const send of clients)
        send(next);
}
