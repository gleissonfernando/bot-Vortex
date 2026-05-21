import { Router } from 'express';
import { z } from 'zod';
import { getAbsences, getFrequency, getMemberAttendance } from '../services/attendance.js';
import { getMember, listMembers } from '../services/members.js';
import { memberReport, secondsToLabel, toCsv } from '../services/reports.js';

export const membersRouter = Router();

membersRouter.get('/', async (req, res) => {
  const members = await listMembers({
    guildId: String(req.query.guildId || ''),
    search: String(req.query.search || ''),
    role: String(req.query.role || ''),
    status: String(req.query.status || ''),
    limit: Number(req.query.limit || 80)
  });

  return res.json({ ok: true, members });
});

membersRouter.get('/:id', async (req, res) => {
  const member = await getMember(req.params.id);
  if (!member) return res.status(404).json({ ok: false, error: 'Member not found' });

  const report = await memberReport(req.params.id, String(req.query.from || ''), String(req.query.to || ''));
  return res.json({ ok: true, member, report });
});

membersRouter.get('/:id/attendance', async (req, res) => {
  const sessions = await getMemberAttendance(req.params.id, String(req.query.from || ''), String(req.query.to || ''));
  return res.json({ ok: true, sessions });
});

membersRouter.get('/:id/frequency', async (req, res) => {
  const days = await getFrequency(req.params.id, String(req.query.from || ''), String(req.query.to || ''));
  return res.json({ ok: true, days });
});

membersRouter.get('/:id/absences', async (req, res) => {
  const absences = await getAbsences(req.params.id, String(req.query.from || ''), String(req.query.to || ''));
  return res.json({ ok: true, absences });
});

membersRouter.get('/:id/export', async (req, res) => {
  const sessions = await getMemberAttendance(req.params.id, String(req.query.from || ''), String(req.query.to || ''));
  const rows = sessions.map((session: any) => ({
    opened_at: session.opened_at,
    closed_at: session.closed_at || '',
    total: secondsToLabel(session.total_seconds),
    total_seconds: session.total_seconds,
    source: session.source,
    opened_by: session.opened_by || '',
    closed_by: session.closed_by || ''
  }));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="member-${req.params.id}-attendance.csv"`);
  return res.send(toCsv(rows));
});

membersRouter.post('/:id/absences', async (_req, res) => {
  return res.status(501).json({ ok: false, error: 'Absence creation should be implemented by policy workflow' });
});

export const dateRangeSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional()
});
