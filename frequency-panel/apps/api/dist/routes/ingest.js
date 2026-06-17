import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { collection, serializeDoc, toDate } from '../db.js';
import { requireIngestSecret } from '../middleware.js';
import { publishDashboardEvent } from '../events.js';
import { registerPoint } from '../services/attendance.js';
import { getMemberByDiscord, pruneMissingMembers, upsertMember } from '../services/members.js';
export const ingestRouter = Router();
ingestRouter.use(requireIngestSecret);
const DEFAULT_LIVE_MESSAGE = '@{streamer} {title}';
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
function detectLivePlatform(url) {
    try {
        const host = new URL(url.includes('://') ? url : `https://${url}`).hostname.toLowerCase();
        if (host.includes('twitch.tv'))
            return 'twitch';
        if (host.includes('youtube.com') || host.includes('youtu.be'))
            return 'youtube';
        if (host.includes('kick.com'))
            return 'kick';
    }
    catch {
        return 'custom';
    }
    return 'custom';
}
function liveSlug(url) {
    try {
        const parsed = new URL(url.includes('://') ? url : `https://twitch.tv/${url}`);
        return (parsed.pathname.split('/').filter(Boolean)[0] || parsed.hostname).replace(/^@/, '');
    }
    catch {
        return String(url || '').trim().replace(/^@/, '');
    }
}
function normalizeLiveUrl(value, platform) {
    const raw = String(value || '').trim();
    if (!raw || raw.includes('://'))
        return raw;
    const clean = raw.replace(/^@/, '').replace(/^\/+/, '');
    if (platform === 'twitch')
        return `https://www.twitch.tv/${clean}`;
    if (platform === 'kick')
        return `https://kick.com/${clean}`;
    return raw;
}
function ingestUnavailable(res, error) {
    console.warn('[frequency-api] Ingest indisponivel sem MongoDB:', error);
    return res.status(503).json({ ok: false, error: 'MongoDB unavailable for ingest' });
}
ingestRouter.post('/members', async (req, res) => {
    const parsed = z.object({
        members: z.array(memberSchema)
    }).safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ ok: false, error: 'Invalid members payload' });
    try {
        const saved = [];
        for (const member of parsed.data.members)
            saved.push(await upsertMember(member));
        await (await collection('audit_events')).insertOne({
            action: 'members.synced',
            payload: { count: saved.length },
            created_at: new Date()
        });
        publishDashboardEvent({ type: 'members.synced', payload: { count: saved.length } });
        return res.json({ ok: true, count: saved.length });
    }
    catch (error) {
        return ingestUnavailable(res, error);
    }
});
ingestRouter.post('/members/prune', async (req, res) => {
    const parsed = z.object({
        guildId: z.string().regex(/^\d{5,32}$/),
        presentDiscordUserIds: z.array(z.string().regex(/^\d{5,32}$/)).min(1)
    }).safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ ok: false, error: 'Invalid member snapshot payload' });
    try {
        const result = await pruneMissingMembers(parsed.data.guildId, parsed.data.presentDiscordUserIds);
        await (await collection('audit_events')).insertOne({
            guild_id: parsed.data.guildId,
            action: 'members.pruned',
            payload: result,
            created_at: new Date()
        });
        publishDashboardEvent({ type: 'members.pruned', payload: result });
        return res.json({ ok: true, ...result });
    }
    catch (error) {
        if (String(error?.message || '').includes('Snapshot de membros vazio')) {
            return res.status(400).json({ ok: false, error: error.message });
        }
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
    if (!parsed.success)
        return res.status(400).json({ ok: false, error: 'Invalid attendance payload' });
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
    }
    catch (error) {
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
    if (!parsed.success)
        return res.status(400).json({ ok: false, error: 'Invalid presence payload' });
    try {
        const now = new Date();
        const seenAt = toDate(parsed.data.seenAt) || now;
        await (await collection('discord_members')).updateOne({ guild_id: parsed.data.guildId, discord_user_id: parsed.data.discordUserId }, { $set: { last_seen_at: seenAt, updated_at: now } });
        if (typeof parsed.data.cityOnline === 'boolean') {
            const cityPresence = await collection('city_presence');
            const existing = await cityPresence.findOne({
                guild_id: parsed.data.guildId,
                discord_user_id: parsed.data.discordUserId
            });
            const cityOnline = parsed.data.cityOnline;
            const wasOnline = existing?.city_online === true && existing?.city_started_at;
            await cityPresence.updateOne({ guild_id: parsed.data.guildId, discord_user_id: parsed.data.discordUserId }, {
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
            }, { upsert: true });
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
    }
    catch (error) {
        return ingestUnavailable(res, error);
    }
});
ingestRouter.post('/point-snapshot', async (req, res) => {
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
    if (!parsed.success)
        return res.status(400).json({ ok: false, error: 'Invalid point snapshot payload' });
    try {
        const memberCache = new Map();
        const cacheKey = (guildId, discordUserId) => `${guildId}:${discordUserId}`;
        for (const member of parsed.data.members || []) {
            const saved = await upsertMember(member);
            if (saved)
                memberCache.set(cacheKey(member.guildId, member.discordUserId), saved);
        }
        const sessions = await collection('attendance_sessions');
        const now = new Date();
        let savedCount = 0;
        for (const item of parsed.data.sessions) {
            const openedAt = toDate(item.openedAt);
            if (!openedAt)
                continue;
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
            if (!member)
                continue;
            memberCache.set(key, member);
            const totalSeconds = closedAt
                ? Math.max(0, Math.floor((closedAt.getTime() - openedAt.getTime()) / 1000))
                : Number(item.totalSeconds || 0);
            await sessions.updateOne({ id: item.id }, {
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
            }, { upsert: true });
            savedCount += 1;
        }
        publishDashboardEvent({ type: 'points.snapshot', payload: { count: savedCount } });
        return res.json({ ok: true, count: savedCount });
    }
    catch (error) {
        return ingestUnavailable(res, error);
    }
});
ingestRouter.get('/live-alerts', async (req, res) => {
    const guildId = String(req.query.guildId || process.env.DISCORD_GUILD_ID || process.env.GUILD_ID || 'global');
    try {
        const [lives, settings] = await Promise.all([
            (await collection('live_alert_configs')).find({ guild_id: guildId }).sort({ created_at: -1 }).toArray(),
            (await collection('live_alert_settings')).findOne({ guild_id: guildId })
        ]);
        return res.json({
            ok: true,
            guildId,
            lives: lives.map((live) => ({
                ...serializeDoc(live),
                id: String(live._id || live.id || '')
            })),
            settings: settings ? { ...settings, _id: undefined } : {
                guild_id: guildId,
                enabled: true,
                default_alert_channel_id: null,
                default_mention_role_id: null,
                default_message: null,
                check_interval_seconds: 30
            }
        });
    }
    catch (error) {
        return ingestUnavailable(res, error);
    }
});
ingestRouter.post('/live-alerts', async (req, res) => {
    const parsed = z.object({
        guildId: z.string().min(1),
        platform: z.enum(['twitch', 'youtube', 'kick', 'custom']).optional(),
        url: z.string().min(1).max(240),
        streamerName: z.string().max(80).optional().nullable(),
        alertChannelId: z.string().optional().nullable(),
        mentionRoleId: z.string().optional().nullable(),
        enabled: z.boolean().optional(),
        customMessage: z.unknown().optional(),
        twitchLogin: z.string().optional().nullable(),
        twitchUserId: z.string().optional().nullable(),
        avatarUrl: z.string().optional().nullable(),
        bannerUrl: z.string().optional().nullable()
    }).safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ ok: false, error: 'Invalid live alert payload' });
    try {
        const input = parsed.data;
        const platform = input.platform || detectLivePlatform(input.url);
        const url = normalizeLiveUrl(input.url, platform);
        const twitchLogin = platform === 'twitch' ? String(input.twitchLogin || liveSlug(url)).toLowerCase() : null;
        const now = new Date();
        const doc = {
            guild_id: input.guildId,
            platform,
            url,
            streamer_name: input.streamerName || liveSlug(url) || 'Streamer',
            alert_channel_id: input.alertChannelId || null,
            mention_role_id: input.mentionRoleId || null,
            enabled: input.enabled !== false,
            custom_message: null,
            status: 'unknown',
            last_live_title: null,
            last_live_url: null,
            last_announced_live_id: null,
            last_alert_message_id: null,
            last_alert_updated_at: null,
            last_live_started_at: null,
            last_checked_at: null,
            twitch_login: twitchLogin,
            twitch_user_id: input.twitchUserId || null,
            avatar_url: input.avatarUrl || null,
            banner_url: input.bannerUrl || null,
            created_at: now,
            updated_at: now
        };
        const lives = await collection('live_alert_configs');
        const duplicateQuery = twitchLogin
            ? { guild_id: input.guildId, platform, twitch_login: twitchLogin }
            : { guild_id: input.guildId, platform, url };
        const existing = await lives.findOne(duplicateQuery);
        if (existing)
            return res.status(409).json({ ok: false, error: 'Esta live ja esta cadastrada neste servidor.' });
        const result = await lives.insertOne(doc);
        return res.status(201).json({ ok: true, live: { ...serializeDoc(doc), id: String(result.insertedId) } });
    }
    catch (error) {
        return ingestUnavailable(res, error);
    }
});
ingestRouter.patch('/live-alert-settings/:guildId', async (req, res) => {
    const parsed = z.object({
        enabled: z.boolean().optional(),
        defaultAlertChannelId: z.string().optional().nullable(),
        defaultMentionRoleId: z.string().optional().nullable(),
        defaultMessage: z.string().optional().nullable(),
        checkIntervalSeconds: z.number().int().min(30).max(3600).optional()
    }).safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ ok: false, error: 'Invalid live settings payload' });
    try {
        const guildId = String(req.params.guildId || 'global');
        const current = await (await collection('live_alert_settings')).findOne({ guild_id: guildId });
        const next = {
            guild_id: guildId,
            enabled: parsed.data.enabled ?? current?.enabled ?? true,
            default_alert_channel_id: parsed.data.defaultAlertChannelId ?? current?.default_alert_channel_id ?? null,
            default_mention_role_id: parsed.data.defaultMentionRoleId ?? current?.default_mention_role_id ?? null,
            default_message: DEFAULT_LIVE_MESSAGE,
            check_interval_seconds: parsed.data.checkIntervalSeconds ?? current?.check_interval_seconds ?? 30,
            updated_at: new Date()
        };
        await (await collection('live_alert_settings')).updateOne({ guild_id: guildId }, { $set: next, $setOnInsert: { created_at: new Date() } }, { upsert: true });
        return res.json({ ok: true, settings: next });
    }
    catch (error) {
        return ingestUnavailable(res, error);
    }
});
ingestRouter.patch('/live-alerts/:id/status', async (req, res) => {
    const parsed = z.object({
        status: z.enum(['online', 'offline', 'unknown']).optional(),
        lastLiveTitle: z.string().nullable().optional(),
        lastLiveUrl: z.string().nullable().optional(),
        lastAnnouncedLiveId: z.string().nullable().optional(),
        lastAlertMessageId: z.string().nullable().optional(),
        lastAlertUpdatedAt: z.string().nullable().optional(),
        lastLiveStartedAt: z.string().nullable().optional()
    }).safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ ok: false, error: 'Invalid live status payload' });
    try {
        const id = String(req.params.id || '');
        if (!ObjectId.isValid(id))
            return res.status(400).json({ ok: false, error: 'Invalid live id' });
        const input = parsed.data;
        const update = {
            status: input.status || 'unknown',
            last_live_title: input.lastLiveTitle || null,
            last_live_url: input.lastLiveUrl || null,
            last_announced_live_id: input.lastAnnouncedLiveId ?? null,
            last_alert_message_id: input.lastAlertMessageId ?? null,
            last_alert_updated_at: toDate(input.lastAlertUpdatedAt) || null,
            last_live_started_at: toDate(input.lastLiveStartedAt) || null,
            last_checked_at: new Date(),
            updated_at: new Date()
        };
        await (await collection('live_alert_configs')).updateOne({ _id: new ObjectId(id) }, { $set: update });
        return res.json({ ok: true });
    }
    catch (error) {
        return ingestUnavailable(res, error);
    }
});
