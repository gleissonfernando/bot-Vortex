import { Router } from 'express';
import { listAbsences } from '../services/absences.js';
export const absencesRouter = Router();
function readQuery(req) {
    return {
        guildId: String(req.query.guildId || ''),
        status: String(req.query.status || 'all'),
        search: String(req.query.search || ''),
        from: String(req.query.from || ''),
        to: String(req.query.to || ''),
        limit: Number(req.query.limit || 200)
    };
}
absencesRouter.get('/', async (req, res) => {
    try {
        const data = await listAbsences(readQuery(req));
        return res.json({ ok: true, ...data });
    }
    catch (error) {
        console.warn('[frequency-api] Lista de ausencias indisponivel:', error);
        return res.json({
            ok: true,
            metrics: { total: 0, active: 0, scheduled: 0, pending: 0, approved: 0 },
            active: [],
            records: []
        });
    }
});
