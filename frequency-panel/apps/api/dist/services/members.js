import { randomUUID } from 'node:crypto';
import { collection, serializeDoc, serializeDocs, toDate } from '../db.js';
import { buildRegisteredMemberFilter, getRegisteredProfileMemberInputs, isRegisteredProfile } from './profileRegistry.js';
const USER_ID_ARRAY_KEYS = new Set([
    'billingExemptUserIds'
]);
const IDENTITY_FIELDS = [
    'userId',
    'discordUserId',
    'targetUserId',
    'targetId',
    'memberId',
    'discordId',
    'discord_user_id',
    'target_user_id'
];
const GUILD_FIELDS = ['guildId', 'guild_id'];
const REMOVED = Symbol('removed-user-record');
function normalizeDiscordId(value) {
    const text = String(value || '').trim();
    return /^\d{15,25}$/.test(text) ? text : null;
}
function uniqueDiscordIds(values) {
    return [...new Set(values.map(normalizeDiscordId).filter(Boolean))];
}
function cloneJson(value) {
    if (value === undefined)
        return undefined;
    return JSON.parse(JSON.stringify(value));
}
function getRecordGuildId(record) {
    if (!record || typeof record !== 'object' || Array.isArray(record))
        return null;
    for (const field of GUILD_FIELDS) {
        const guildId = normalizeDiscordId(record[field]);
        if (guildId)
            return guildId;
    }
    return null;
}
function recordBelongsToGuild(record, guildId) {
    const recordGuildId = getRecordGuildId(record);
    return !recordGuildId || recordGuildId === guildId;
}
function recordHasRemovedIdentity(record, removedUserIds) {
    if (!record || typeof record !== 'object' || Array.isArray(record))
        return false;
    return IDENTITY_FIELDS.some((field) => removedUserIds.has(String(record[field] || '').trim()));
}
function isRemovedUserRecord(record, guildId, removedUserIds) {
    return recordHasRemovedIdentity(record, removedUserIds) && recordBelongsToGuild(record, guildId);
}
function isRemovedUserScopedKey(key, guildId, removedUserIds) {
    const text = String(key || '');
    for (const userId of removedUserIds) {
        if (text === userId
            || text === `${guildId}:${userId}`
            || text.startsWith(`${guildId}:${userId}:`)
            || text.includes(`:${userId}:`)
            || text.endsWith(`:${userId}`)) {
            return true;
        }
    }
    return false;
}
function stripRemovedUserRecords(value, guildId, removedUserIds, keyName = null) {
    if (Array.isArray(value)) {
        if (USER_ID_ARRAY_KEYS.has(String(keyName || ''))) {
            const next = value.filter((item) => !removedUserIds.has(String(item || '').trim()));
            return { value: next, removed: next.length !== value.length };
        }
        let removed = false;
        const next = [];
        for (const item of value) {
            if (isRemovedUserRecord(item, guildId, removedUserIds)) {
                removed = true;
                continue;
            }
            const cleaned = stripRemovedUserRecords(item, guildId, removedUserIds, keyName);
            if (cleaned.value === REMOVED) {
                removed = true;
                continue;
            }
            removed ||= cleaned.removed;
            next.push(cleaned.value);
        }
        return { value: next, removed };
    }
    if (!value || typeof value !== 'object') {
        return { value, removed: false };
    }
    if (isRemovedUserRecord(value, guildId, removedUserIds)) {
        return { value: REMOVED, removed: true };
    }
    let removed = false;
    const next = {};
    for (const [key, item] of Object.entries(value)) {
        if (isRemovedUserScopedKey(key, guildId, removedUserIds)) {
            removed = true;
            continue;
        }
        const cleaned = stripRemovedUserRecords(item, guildId, removedUserIds, key);
        if (cleaned.value === REMOVED) {
            removed = true;
            continue;
        }
        removed ||= cleaned.removed;
        next[key] = cleaned.value;
    }
    return { value: next, removed };
}
export async function upsertMember(input) {
    const members = await collection('discord_members');
    const now = new Date();
    const existing = await members.findOne({
        guild_id: input.guildId,
        discord_user_id: input.discordUserId
    });
    const joinedAt = toDate(input.joinedAt) || existing?.joined_at || null;
    const lastSeenAt = toDate(input.lastSeenAt) || existing?.last_seen_at || null;
    const id = existing?.id || randomUUID();
    await members.updateOne({ guild_id: input.guildId, discord_user_id: input.discordUserId }, {
        $set: {
            id,
            guild_id: input.guildId,
            discord_user_id: input.discordUserId,
            username: input.username,
            global_name: input.globalName || null,
            display_name: input.displayName,
            avatar_url: input.avatarUrl || null,
            banner_url: input.bannerUrl || null,
            highest_role_id: input.highestRoleId || null,
            highest_role_name: input.highestRoleName || null,
            roles: input.roles || [],
            joined_at: joinedAt,
            status: input.status || 'active',
            last_seen_at: lastSeenAt,
            updated_at: now
        },
        $setOnInsert: {
            created_at: now
        }
    }, { upsert: true });
    return getMemberByDiscord(input.guildId, input.discordUserId);
}
export async function listMembers(params) {
    const members = await collection('discord_members');
    const sessions = await collection('attendance_sessions');
    await ensureRegisteredMembers(params.guildId);
    const filter = {};
    if (params.guildId)
        filter.guild_id = params.guildId;
    if (params.status)
        filter.status = params.status;
    if (params.search) {
        const pattern = new RegExp(params.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        filter.$or = [
            { display_name: pattern },
            { global_name: pattern },
            { username: pattern },
            { discord_user_id: pattern }
        ];
    }
    if (params.role) {
        filter.$and = [
            ...(filter.$and || []),
            {
                $or: [
                    { highest_role_id: params.role },
                    { highest_role_name: params.role },
                    { roles: { $elemMatch: { id: params.role } } },
                    { roles: { $elemMatch: { name: params.role } } }
                ]
            }
        ];
    }
    filter.$and = [
        ...(filter.$and || []),
        await buildRegisteredMemberFilter(params.guildId)
    ];
    const limit = Math.min(Math.max(Number(params.limit || 80), 1), 200);
    const docs = serializeDocs(await members.find(filter).sort({ display_name: 1 }).limit(limit).toArray());
    const memberIds = docs.map((member) => member.id).filter(Boolean);
    const sessionStats = memberIds.length
        ? await sessions.aggregate([
            { $match: { member_id: { $in: memberIds } } },
            {
                $group: {
                    _id: '$member_id',
                    total_seconds: { $sum: '$total_seconds' },
                    session_count: { $sum: 1 },
                    last_point_at: { $max: { $ifNull: ['$closed_at', '$opened_at'] } }
                }
            }
        ]).toArray()
        : [];
    const statsByMemberId = new Map(sessionStats.map((item) => [item._id, item]));
    return docs.map((member) => {
        const stats = statsByMemberId.get(member.id);
        return {
            ...member,
            total_seconds: Number(stats?.total_seconds || 0),
            session_count: Number(stats?.session_count || 0),
            last_point_at: stats?.last_point_at ? stats.last_point_at.toISOString() : null
        };
    });
}
export async function ensureRegisteredMembers(guildId) {
    const profileMembers = await getRegisteredProfileMemberInputs(guildId);
    if (!profileMembers.length)
        return;
    const members = await collection('discord_members');
    const existing = await members.find({
        $or: profileMembers.map((member) => ({
            guild_id: member.guildId,
            discord_user_id: member.discordUserId
        }))
    }, { projection: { guild_id: 1, discord_user_id: 1 } }).toArray();
    const existingKeys = new Set(existing.map((member) => `${member.guild_id}:${member.discord_user_id}`));
    for (const member of profileMembers) {
        if (existingKeys.has(`${member.guildId}:${member.discordUserId}`))
            continue;
        await upsertMember(member);
    }
}
export async function getMember(memberId) {
    const members = await collection('discord_members');
    const sessions = await collection('attendance_sessions');
    const absences = await collection('absence_records');
    const member = serializeDoc(await members.findOne({ id: memberId }));
    if (!member)
        return null;
    if (!(await isRegisteredProfile(member.guild_id, member.discord_user_id)))
        return null;
    const related = await sessions.find({ member_id: memberId }).toArray();
    const total_seconds = related.reduce((sum, session) => sum + Number(session.total_seconds || 0), 0);
    const last = related
        .map((session) => session.closed_at || session.opened_at)
        .filter(Boolean)
        .sort((a, b) => b.getTime() - a.getTime())[0] || null;
    const absence_count = await absences.countDocuments({ member_id: memberId });
    return {
        ...member,
        total_seconds,
        session_count: related.length,
        last_point_at: last ? last.toISOString() : null,
        absence_count
    };
}
export async function getMemberByDiscord(guildId, discordUserId) {
    const members = await collection('discord_members');
    return serializeDoc(await members.findOne({ guild_id: guildId, discord_user_id: discordUserId }));
}
export async function pruneMissingMembers(guildId, presentDiscordUserIds) {
    const normalizedGuildId = normalizeDiscordId(guildId);
    if (!normalizedGuildId)
        throw new Error('Guild ID invalido');
    const presentIds = uniqueDiscordIds(presentDiscordUserIds);
    if (!presentIds.length)
        throw new Error('Snapshot de membros vazio; limpeza cancelada.');
    const members = await collection('discord_members');
    const missingMembers = await members.find({
        guild_id: normalizedGuildId,
        discord_user_id: { $nin: presentIds }
    }, { projection: { id: 1, discord_user_id: 1 } }).toArray();
    const removedDiscordIds = uniqueDiscordIds(missingMembers.map((member) => member.discord_user_id));
    const removedUserSet = new Set(removedDiscordIds);
    if (!removedDiscordIds.length) {
        return {
            guildId: normalizedGuildId,
            presentMembers: presentIds.length,
            removedMembers: 0,
            deleted: {},
            jsonDocumentsUpdated: 0
        };
    }
    const memberIds = [...new Set(missingMembers.map((member) => String(member.id || '').trim()).filter(Boolean))];
    const now = new Date();
    const memberIdOrUserFilter = [
        ...(memberIds.length ? [{ member_id: { $in: memberIds } }] : []),
        { guild_id: normalizedGuildId, discord_user_id: { $in: removedDiscordIds } }
    ];
    const deleted = {};
    deleted.discord_members = (await members.deleteMany({
        guild_id: normalizedGuildId,
        discord_user_id: { $in: removedDiscordIds }
    })).deletedCount || 0;
    deleted.city_presence = (await (await collection('city_presence')).deleteMany({
        guild_id: normalizedGuildId,
        discord_user_id: { $in: removedDiscordIds }
    })).deletedCount || 0;
    deleted.attendance_sessions = (await (await collection('attendance_sessions')).deleteMany({
        $or: memberIdOrUserFilter
    })).deletedCount || 0;
    deleted.absence_records = (await (await collection('absence_records')).deleteMany({
        $or: memberIdOrUserFilter
    })).deletedCount || 0;
    deleted.site_users = (await (await collection('site_users')).deleteMany({
        guild_id: normalizedGuildId,
        discord_id: { $in: removedDiscordIds }
    })).deletedCount || 0;
    deleted.site_user_audit_logs = (await (await collection('site_user_audit_logs')).deleteMany({
        guild_id: normalizedGuildId,
        $or: [
            { target_discord_id: { $in: removedDiscordIds } },
            { actor_id: { $in: removedDiscordIds } }
        ]
    })).deletedCount || 0;
    const auditEventFilter = [
        { guild_id: normalizedGuildId, actor_id: { $in: removedDiscordIds } },
        { 'payload.guildId': normalizedGuildId, 'payload.discordUserId': { $in: removedDiscordIds } },
        { 'payload.member.guildId': normalizedGuildId, 'payload.member.discordUserId': { $in: removedDiscordIds } },
        ...(memberIds.length ? [{ 'payload.session.member_id': { $in: memberIds } }] : [])
    ];
    deleted.audit_events = (await (await collection('audit_events')).deleteMany({ $or: auditEventFilter })).deletedCount || 0;
    const orderFamilies = await collection('order_families');
    const familyMemberPull = await orderFamilies.updateMany({ guild_id: normalizedGuildId, 'members.discord_id': { $in: removedDiscordIds } }, { $pull: { members: { discord_id: { $in: removedDiscordIds } } }, $set: { updated_at: now } });
    const familyLeaderCleanup = await orderFamilies.updateMany({ guild_id: normalizedGuildId, leader_id: { $in: removedDiscordIds } }, { $set: { leader_id: null, leader_name: null, updated_at: now } });
    deleted.order_family_links = (familyMemberPull.modifiedCount || 0) + (familyLeaderCleanup.modifiedCount || 0);
    deleted.order_favorites = (await (await collection('order_favorites')).deleteMany({
        guild_id: normalizedGuildId,
        created_by_id: { $in: removedDiscordIds }
    })).deletedCount || 0;
    const jsonDocuments = await collection('jsondocuments');
    const documents = await jsonDocuments.find({}).toArray();
    let jsonDocumentsUpdated = 0;
    for (const document of documents) {
        const cleaned = stripRemovedUserRecords(cloneJson(document.data || {}), normalizedGuildId, removedUserSet);
        if (!cleaned.removed || cleaned.value === REMOVED)
            continue;
        await jsonDocuments.updateOne({ _id: document._id }, {
            $set: {
                data: cleaned.value,
                updatedAt: now,
                updated_at: now
            }
        });
        jsonDocumentsUpdated += 1;
    }
    return {
        guildId: normalizedGuildId,
        presentMembers: presentIds.length,
        removedMembers: removedDiscordIds.length,
        deleted,
        jsonDocumentsUpdated
    };
}
