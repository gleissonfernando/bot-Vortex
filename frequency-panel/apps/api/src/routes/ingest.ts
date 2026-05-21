import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { requireIngestSecret } from '../middleware.js';
import { registerPoint } from '../services/attendance.js';
import { upsertMember } from '../services/members.js';

export const ingestRouter = Router();

ingestRouter.use(requireIngestSecret);

ingestRouter.post('/members', async (req, res) => {
  const parsed = z.object({
    members: z.array(z.object({
      guildId: z.string(),
      discordUserId: z.string(),
      username: z.string(),
      displayName: z.string(),
      avatarUrl: z.string().nullable().optional(),
      highestRoleId: z.string().nullable().optional(),
      highestRoleName: z.string().nullable().optional(),
      roles: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
      joinedAt: z.string().nullable().optional(),
      status: z.enum(['active', 'inactive']).optional(),
      lastSeenAt: z.string().nullable().optional()
    }))
  }).safeParse(req.body);

  if (!parsed.success) return res.status(400).json({ ok: false, error: 'Invalid members payload' });

  const saved = [];
  for (const member of parsed.data.members) saved.push(await upsertMember(member));
  await query('INSERT INTO audit_events (action, payload) VALUES ($1, $2)', ['members.synced', JSON.stringify({ count: saved.length })]);
  return res.json({ ok: true, count: saved.length });
});

ingestRouter.post('/attendance', async (req, res) => {
  const parsed = z.object({
    action: z.enum(['open', 'close']),
    guildId: z.string(),
    discordUserId: z.string(),
    actorId: z.string().nullable().optional(),
    note: z.string().nullable().optional(),
    member: z.any().optional()
  }).safeParse(req.body);

  if (!parsed.success) return res.status(400).json({ ok: false, error: 'Invalid attendance payload' });

  const result = await registerPoint(parsed.data);
  await query('INSERT INTO audit_events (guild_id, actor_id, action, payload) VALUES ($1, $2, $3, $4)', [
    parsed.data.guildId,
    parsed.data.actorId || parsed.data.discordUserId,
    `attendance.${parsed.data.action}`,
    JSON.stringify(result)
  ]);
  return res.json({ ok: true, result });
});

ingestRouter.post('/presence', async (req, res) => {
  const parsed = z.object({
    guildId: z.string(),
    discordUserId: z.string(),
    seenAt: z.string().optional()
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: 'Invalid presence payload' });

  await query(
    'UPDATE discord_members SET last_seen_at = COALESCE($3::timestamptz, now()), updated_at = now() WHERE guild_id = $1 AND discord_user_id = $2',
    [parsed.data.guildId, parsed.data.discordUserId, parsed.data.seenAt || null]
  );
  return res.json({ ok: true });
});
