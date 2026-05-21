import { Router } from 'express';
import { z } from 'zod';
import { collection, toDate } from '../db.js';
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
  await (await collection('audit_events')).insertOne({
    action: 'members.synced',
    payload: { count: saved.length },
    created_at: new Date()
  });
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
  await (await collection('audit_events')).insertOne({
    guild_id: parsed.data.guildId,
    actor_id: parsed.data.actorId || parsed.data.discordUserId,
    action: `attendance.${parsed.data.action}`,
    payload: result,
    created_at: new Date()
  });
  return res.json({ ok: true, result });
});

ingestRouter.post('/presence', async (req, res) => {
  const parsed = z.object({
    guildId: z.string(),
    discordUserId: z.string(),
    seenAt: z.string().optional()
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: 'Invalid presence payload' });

  const now = new Date();
  await (await collection('discord_members')).updateOne(
    { guild_id: parsed.data.guildId, discord_user_id: parsed.data.discordUserId },
    { $set: { last_seen_at: toDate(parsed.data.seenAt) || now, updated_at: now } }
  );
  return res.json({ ok: true });
});
