import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../middleware.js';
import { auditLog } from '../security.js';
import { createBackup, listBackups, restoreBackup } from '../services/backup.js';
export const backupsRouter = Router();
backupsRouter.use(requireRole('admin'));
backupsRouter.get('/', async (_req, res) => {
    const backups = await listBackups();
    return res.json({ ok: true, backups });
});
backupsRouter.post('/', async (req, res) => {
    const backup = await createBackup('manual');
    await auditLog(req, 'backup.created', { filename: backup.filename });
    return res.json({ ok: true, backup });
});
backupsRouter.post('/restore', async (req, res) => {
    const parsed = z.object({
        filename: z.string().min(1).max(180)
    }).safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ ok: false, error: 'Backup invalido' });
    const result = await restoreBackup(parsed.data.filename);
    await auditLog(req, 'backup.restored', { filename: parsed.data.filename });
    return res.json({ ok: true, restore: result });
});
