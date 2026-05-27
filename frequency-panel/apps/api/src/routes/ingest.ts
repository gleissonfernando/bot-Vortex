import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { collection, toDate } from '../db.js';
import { requireIngestSecret } from '../middleware.js';
import { publishDashboardEvent } from '../events.js';
import { registerPoint } from '../services/attendance.js';
import { getMemberByDiscord, upsertMember } from '../services/members.js';

export const ingestRouter = Router();

ingestRouter.use(requireIngestSecret);

function ingestUnavailable(res: any, error: unknown) {
  console.warn('[frequency-api] Ingest indisponivel sem MongoDB:', error);
  return res.status(503).json({ ok: false, error: 'MongoDB unavailable for ingest' });
}

ingestRouter.post('/members', async (req, res) => {
  const parsed = z.object({
    members: z.array(z.object({
      guildId: z.string(),
      discordUserId: z.string(),
      username: z.string(),
      globalName: z.string().nullable().optional(),
      displayName: z.string(),
      avatarUrl: z.string().nullable().optional(),
      bannerUrl: z.string().nullable().optional(),
      highestRoleId: z.string().nullable().optional(),
      highestRoleName: z.string().nullable().optional(),
      roles: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
      joinedAt: z.string().nullable().optional(),
      status: z.enum(['active', 'inactive']).optional(),
      lastSeenAt: z.string().nullable().optional()
    }))
  }).safeParse(req.body);

  if (!parsed.success) return res.status(400).json({ ok: false, error: 'Invalid members payload' });

  try {
    const saved = [];
    for (const member of parsed.data.members) saved.push(await upsertMember(member));
    await (await collection('audit_events')).insertOne({
      action: 'members.synced',
      payload: { count: saved.length },
      created_at: new Date()
    });
    publishDashboardEvent({ type: 'members.synced', payload: { count: saved.length } });
    return res.json({ ok: true, count: saved.length });
  } catch (error) {
    return ingestUnavailable(res, error);
  }
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

  try {
    const result = await registerPoint(parsed.data);
    await (await collection('audit_events')).insertOne({
      guild_id: parsed.data.guildId,
      actor_id: parsed.data.actorId || parsed.data.discordUserId,
      action: `attendance.${parsed.data.action}`,
      payload: result,
      created_at: new Date()
    });
    publishDashboardEvent({
      type: `attendance.${parsed.data.action}`,
      payload: {
        guildId: parsed.data.guildId,
        discordUserId: parsed.data.discordUserId,
        action: result.action
      }
    });
    return res.json({ ok: true, result });
  } catch (error) {
    return ingestUnavailable(res, error);
  }
});

ingestRouter.post('/presence', async (req, res) => {
  const parsed = z.object({
    guildId: z.string(),
    discordUserId: z.string(),
    seenAt: z.string().optional(),
    cityOnline: z.boolean().optional(),
    cityName: z.string().nullable().optional(),
    activityName: z.string().nullable().optional(),
    activityDetails: z.string().nullable().optional(),
    activityState: z.string().nullable().optional()
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: 'Invalid presence payload' });

  try {
    const now = new Date();
    const seenAt = toDate(parsed.data.seenAt) || now;
    await (await collection('discord_members')).updateOne(
      { guild_id: parsed.data.guildId, discord_user_id: parsed.data.discordUserId },
      { $set: { last_seen_at: seenAt, updated_at: now } }
    );

    if (typeof parsed.data.cityOnline === 'boolean') {
      const cityPresence = await collection('city_presence');
      const existing = await cityPresence.findOne({
        guild_id: parsed.data.guildId,
        discord_user_id: parsed.data.discordUserId
      });
      const cityOnline = parsed.data.cityOnline;
      const wasOnline = existing?.city_online === true && existing?.city_started_at;

      await cityPresence.updateOne(
        { guild_id: parsed.data.guildId, discord_user_id: parsed.data.discordUserId },
        {
          $set: {
            guild_id: parsed.data.guildId,
            discord_user_id: parsed.data.discordUserId,
            city_online: cityOnline,
            city_name: cityOnline ? (parsed.data.cityName || 'FiveM') : null,
            activity_name: cityOnline ? (parsed.data.activityName || null) : null,
            activity_details: cityOnline ? (parsed.data.activityDetails || null) : null,
            activity_state: cityOnline ? (parsed.data.activityState || null) : null,
            city_started_at: cityOnline ? (wasOnline ? existing.city_started_at : seenAt) : null,
            city_left_at: cityOnline ? null : seenAt,
            seen_at: seenAt,
            updated_at: now
          },
          $setOnInsert: {
            created_at: now
          }
        },
        { upsert: true }
      );
    }

    publishDashboardEvent({
      type: typeof parsed.data.cityOnline === 'boolean' ? 'city_presence.updated' : 'presence.updated',
      payload: {
        guildId: parsed.data.guildId,
        discordUserId: parsed.data.discordUserId,
        cityOnline: parsed.data.cityOnline
      }
    });
    return res.json({ ok: true });
  } catch (error) {
    return ingestUnavailable(res, error);
  }
});

ingestRouter.post('/point-snapshot', async (req, res) => {
  const memberSchema = z.object({
    guildId: z.string(),
    discordUserId: z.string(),
    username: z.string(),
    globalName: z.string().nullable().optional(),
    displayName: z.string(),
    avatarUrl: z.string().nullable().optional(),
    bannerUrl: z.string().nullable().optional(),
    highestRoleId: z.string().nullable().optional(),
    highestRoleName: z.string().nullable().optional(),
    roles: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
    joinedAt: z.string().nullable().optional(),
    status: z.enum(['active', 'inactive']).optional(),
    lastSeenAt: z.string().nullable().optional()
  });

  const parsed = z.object({
    members: z.array(memberSchema).optional(),
    sessions: z.array(z.object({
      id: z.string().min(1),
      guildId: z.string(),
      discordUserId: z.string(),
      openedAt: z.string(),
      closedAt: z.string().nullable().optional(),
      totalSeconds: z.number().int().nonnegative().optional(),
      source: z.string().optional(),
      openedBy: z.string().nullable().optional(),
      closedBy: z.string().nullable().optional(),
      note: z.string().nullable().optional(),
      member: memberSchema.partial().optional()
    }))
  }).safeParse(req.body);

  if (!parsed.success) return res.status(400).json({ ok: false, error: 'Invalid point snapshot payload' });

  try {
    const memberCache = new Map<string, any>();
    const cacheKey = (guildId: string, discordUserId: string) => `${guildId}:${discordUserId}`;

    for (const member of parsed.data.members || []) {
      const saved = await upsertMember(member);
      if (saved) memberCache.set(cacheKey(member.guildId, member.discordUserId), saved);
    }

    const sessions = await collection('attendance_sessions');
    const now = new Date();
    let savedCount = 0;

    for (const item of parsed.data.sessions) {
      const openedAt = toDate(item.openedAt);
      if (!openedAt) continue;
      const closedAt = item.closedAt ? toDate(item.closedAt) : null;
      const key = cacheKey(item.guildId, item.discordUserId);
      let member = memberCache.get(key) || await getMemberByDiscord(item.guildId, item.discordUserId);

      if (!member) {
        member = await upsertMember({
          guildId: item.guildId,
          discordUserId: item.discordUserId,
          username: item.member?.username || item.discordUserId,
          globalName: item.member?.globalName || null,
          displayName: item.member?.displayName || item.member?.globalName || item.member?.username || item.discordUserId,
          avatarUrl: item.member?.avatarUrl || null,
          bannerUrl: item.member?.bannerUrl || null,
          highestRoleId: item.member?.highestRoleId || null,
          highestRoleName: item.member?.highestRoleName || null,
          roles: item.member?.roles || [],
          joinedAt: item.member?.joinedAt || null,
          lastSeenAt: closedAt?.toISOString() || openedAt.toISOString()
        });
      }

      if (!member) continue;
      memberCache.set(key, member);

      const totalSeconds = closedAt
        ? Math.max(0, Math.floor((closedAt.getTime() - openedAt.getTime()) / 1000))
        : Number(item.totalSeconds || 0);

      await sessions.updateOne(
        { id: item.id },
        {
          $set: {
            id: item.id,
            guild_id: item.guildId,
            member_id: member.id,
            opened_at: openedAt,
            closed_at: closedAt,
            total_seconds: totalSeconds,
            source: item.source || 'vortex-point',
            opened_by: item.openedBy || item.discordUserId,
            closed_by: closedAt ? (item.closedBy || item.discordUserId) : null,
            note: item.note || null,
            updated_at: now
          },
          $setOnInsert: {
            import_id: randomUUID(),
            created_at: now
          }
        },
        { upsert: true }
      );
      savedCount += 1;
    }

    publishDashboardEvent({ type: 'points.snapshot', payload: { count: savedCount } });
    return res.json({ ok: true, count: savedCount });
  } catch (error) {
    return ingestUnavailable(res, error);
  }
});
