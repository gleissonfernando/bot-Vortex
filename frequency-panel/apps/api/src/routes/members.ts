import { Router } from 'express';
import { z } from 'zod';
import { collection, serializeDoc } from '../db.js';
import { getAbsences, getFrequency, getMemberAttendance } from '../services/attendance.js';
import { getMember, listMembers } from '../services/members.js';
import { memberReport, secondsToLabel, toCsv } from '../services/reports.js';

export const membersRouter = Router();

export async function memberAvatarHandler(req: any, res: any) {
  let member: any = null;
  try {
    const members = await collection('discord_members');
    member = serializeDoc(await members.findOne({ id: req.params.id })) as any;
  } catch {
    return res.status(404).end();
  }
  const avatarUrl = String(member?.avatar_url || '').replace(/\.webp(\?size=\d+)?$/i, '.png$1');
  if (!avatarUrl) return res.status(404).end();

  try {
    const response = await fetch(avatarUrl);
    if (!response.ok || !response.body) return res.status(404).end();

    res.setHeader('Content-Type', response.headers.get('content-type') || 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
    const buffer = Buffer.from(await response.arrayBuffer());
    return res.send(buffer);
  } catch {
    return res.status(404).end();
  }
}

membersRouter.get('/', async (req, res) => {
  try {
    const members = await listMembers({
      guildId: String(req.query.guildId || ''),
      search: String(req.query.search || ''),
      role: String(req.query.role || ''),
      status: String(req.query.status || ''),
      limit: Number(req.query.limit || 80)
    });

    return res.json({ ok: true, members });
  } catch (error) {
    console.warn('[frequency-api] Lista de membros indisponivel sem MongoDB:', error);
    return res.json({ ok: true, members: [] });
  }
});

membersRouter.get('/:id/avatar', async (req, res) => {
  return memberAvatarHandler(req, res);
});

membersRouter.get('/:id', async (req, res) => {
  try {
    const member = await getMember(req.params.id);
    if (!member) return res.status(404).json({ ok: false, error: 'Member not found' });

    const report = await memberReport(req.params.id, String(req.query.from || ''), String(req.query.to || ''));
    return res.json({ ok: true, member, report });
  } catch {
    return res.status(404).json({ ok: false, error: 'Member database unavailable' });
  }
});

membersRouter.get('/:id/attendance', async (req, res) => {
  try {
    const sessions = await getMemberAttendance(req.params.id, String(req.query.from || ''), String(req.query.to || ''));
    return res.json({ ok: true, sessions });
  } catch {
    return res.json({ ok: true, sessions: [] });
  }
});

membersRouter.get('/:id/frequency', async (req, res) => {
  try {
    const days = await getFrequency(req.params.id, String(req.query.from || ''), String(req.query.to || ''));
    return res.json({ ok: true, days });
  } catch {
    return res.json({ ok: true, days: [] });
  }
});

membersRouter.get('/:id/absences', async (req, res) => {
  try {
    const absences = await getAbsences(req.params.id, String(req.query.from || ''), String(req.query.to || ''));
    return res.json({ ok: true, absences: absences });
  } catch {
    return res.json({ ok: true, absences: [] });
  }
});

membersRouter.get('/:id/export', async (req, res) => {
  let sessions: any[] = [];
  try {
    sessions = await getMemberAttendance(req.params.id, String(req.query.from || ''), String(req.query.to || ''));
  } catch {
    sessions = [];
  }
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
