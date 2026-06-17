import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collection, toDate, toIso } from '../db.js';
const ABSENCES_KEY = 'commands/ausencias.json';
let cachedAbsences = null;
let cacheExpiresAt = 0;
let readPromise = null;
function readPositiveIntEnv(name, fallback) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}
function cacheMs() {
    return readPositiveIntEnv('ABSENCE_REGISTRY_CACHE_MS', 30 * 1000);
}
function normalizeDiscordId(value) {
    const text = String(value || '').trim();
    return /^\d{15,25}$/.test(text) ? text : null;
}
function resolveAbsencesPath() {
    const candidates = [];
    for (const start of [process.cwd(), path.dirname(fileURLToPath(import.meta.url))]) {
        let current = start;
        for (let depth = 0; depth < 10; depth += 1) {
            candidates.push(path.join(current, 'commands', 'ausencias.json'));
            const next = path.dirname(current);
            if (next === current)
                break;
            current = next;
        }
    }
    return candidates.find((candidate) => fs.existsSync(candidate))
        || path.join(process.cwd(), 'commands', 'ausencias.json');
}
function readAbsencesFromDisk() {
    const filePath = resolveAbsencesPath();
    if (!fs.existsSync(filePath))
        return {};
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8') || '{}');
    }
    catch (error) {
        console.warn('[frequency-api] Nao foi possivel ler commands/ausencias.json:', error);
        return {};
    }
}
async function readAbsencesFromMongo() {
    try {
        const documents = await collection('jsondocuments');
        const document = await documents.findOne({ key: ABSENCES_KEY });
        const data = document?.data;
        if (!data || typeof data !== 'object' || Array.isArray(data))
            return null;
        return data;
    }
    catch (error) {
        console.warn('[frequency-api] Nao foi possivel ler commands/ausencias.json no MongoDB:', error);
        return null;
    }
}
async function readAbsenceData() {
    const now = Date.now();
    if (cachedAbsences && cacheExpiresAt > now)
        return cachedAbsences;
    if (readPromise)
        return readPromise;
    readPromise = (async () => {
        const data = await readAbsencesFromMongo() || readAbsencesFromDisk();
        cachedAbsences = data;
        cacheExpiresAt = Date.now() + cacheMs();
        return data;
    })().finally(() => {
        readPromise = null;
    });
    return readPromise;
}
function flattenAbsences(data) {
    const records = [];
    for (const [guildId, guildRecords] of Object.entries(data)) {
        if (!guildRecords || typeof guildRecords !== 'object' || Array.isArray(guildRecords))
            continue;
        for (const [userId, absence] of Object.entries(guildRecords)) {
            if (!absence || typeof absence !== 'object' || Array.isArray(absence))
                continue;
            const normalizedUserId = normalizeDiscordId(absence.userId) || normalizeDiscordId(userId);
            const normalizedGuildId = normalizeDiscordId(absence.guildId) || normalizeDiscordId(guildId);
            if (!normalizedUserId || !normalizedGuildId)
                continue;
            records.push({ ...absence, guildId: normalizedGuildId, userId: normalizedUserId });
        }
    }
    return records;
}
function dateMs(value) {
    const date = toDate(typeof value === 'string' ? value : null);
    return date ? date.getTime() : 0;
}
function firstIso(...values) {
    for (const value of values) {
        const iso = toIso(typeof value === 'string' || value instanceof Date ? value : null);
        if (iso)
            return iso;
    }
    return null;
}
function relevantTime(absence) {
    return Math.max(dateMs(absence.updatedAt), dateMs(absence.approvedAt), dateMs(absence.rejectedAt), dateMs(absence.removedAt), dateMs(absence.finishedAt), dateMs(absence.createdAt), dateMs(absence.startsAt), dateMs(absence.startedAt));
}
function periodDays(startsAt, endsAt) {
    const start = toDate(startsAt || null);
    const end = toDate(endsAt || null);
    if (!start || !end)
        return 0;
    return Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86400000));
}
function overlapsRange(absence, from, to) {
    if (!from && !to)
        return true;
    const start = toDate(absence.startsAt || absence.startedAt || absence.createdAt || null);
    const end = toDate(absence.endsAt || absence.finishedAt || absence.removedAt || absence.rejectedAt || absence.startsAt || absence.createdAt || null);
    if (!start && !end)
        return true;
    const fromDate = toDate(from || null);
    const toDateValue = toDate(to || null);
    const rangeStart = fromDate?.getTime() ?? Number.NEGATIVE_INFINITY;
    const rangeEndDate = toDateValue ? new Date(toDateValue) : null;
    if (rangeEndDate)
        rangeEndDate.setUTCDate(rangeEndDate.getUTCDate() + 1);
    const rangeEnd = rangeEndDate?.getTime() ?? Number.POSITIVE_INFINITY;
    const itemStart = start?.getTime() ?? end?.getTime() ?? 0;
    const itemEnd = end?.getTime() ?? itemStart;
    return itemStart < rangeEnd && itemEnd >= rangeStart;
}
function statusMatches(status, filter) {
    const value = String(status || 'pending').toLowerCase();
    if (!filter || filter === 'all')
        return true;
    if (filter === 'current')
        return ['active', 'scheduled'].includes(value);
    if (filter === 'history')
        return !['active', 'scheduled', 'pending'].includes(value);
    return value === filter;
}
function searchMatches(record, search) {
    const needle = String(search || '').trim().toLowerCase();
    if (!needle)
        return true;
    return [
        record.member_name,
        record.username,
        record.discord_user_id,
        record.status,
        record.reason,
        record.approved_by_name,
        record.approved_by_id,
        record.rejected_by_name,
        record.rejected_by_id
    ].some((value) => String(value || '').toLowerCase().includes(needle));
}
async function loadMemberMap(absences) {
    const userIds = new Set();
    for (const absence of absences) {
        for (const key of ['userId', 'approvedBy', 'rejectedBy', 'removedBy', 'updatedBy']) {
            const id = normalizeDiscordId(absence[key]);
            if (id)
                userIds.add(id);
        }
    }
    if (!userIds.size)
        return new Map();
    try {
        const members = await collection('discord_members');
        const docs = await members.find({ discord_user_id: { $in: [...userIds] } }, { projection: { id: 1, guild_id: 1, discord_user_id: 1, username: 1, global_name: 1, display_name: 1, avatar_url: 1 } }).toArray();
        const map = new Map();
        for (const member of docs) {
            map.set(`${member.guild_id}:${member.discord_user_id}`, member);
            if (!map.has(member.discord_user_id))
                map.set(member.discord_user_id, member);
        }
        return map;
    }
    catch (error) {
        console.warn('[frequency-api] Nao foi possivel enriquecer ausencias com membros:', error);
        return new Map();
    }
}
function memberFromMap(map, guildId, userId) {
    if (!userId)
        return null;
    return map.get(`${guildId}:${userId}`) || map.get(userId) || null;
}
function personName(map, guildId, userId) {
    const member = memberFromMap(map, guildId, userId);
    return member?.global_name || member?.display_name || member?.username || userId || null;
}
function toRecord(absence, membersByUser) {
    const guildId = String(absence.guildId);
    const userId = String(absence.userId);
    const member = memberFromMap(membersByUser, guildId, userId);
    const approvedBy = normalizeDiscordId(absence.approvedBy);
    const rejectedBy = normalizeDiscordId(absence.rejectedBy);
    const removedBy = normalizeDiscordId(absence.removedBy);
    const updatedBy = normalizeDiscordId(absence.updatedBy);
    const startsAt = firstIso(absence.startsAt, absence.startedAt);
    const endsAt = firstIso(absence.endsAt);
    const approvedAt = firstIso(absence.approvedAt);
    const rejectedAt = firstIso(absence.rejectedAt);
    return {
        id: `${guildId}:${userId}:${absence.createdAt || absence.startsAt || absence.status || 'absence'}`,
        guild_id: guildId,
        discord_user_id: userId,
        member_id: member?.id || null,
        member_name: absence.name || member?.global_name || member?.display_name || member?.username || userId,
        username: member?.username || null,
        avatar_url: member?.avatar_url || null,
        status: String(absence.status || 'pending'),
        reason: absence.reason || null,
        starts_at: startsAt,
        started_at: firstIso(absence.startedAt),
        ends_at: endsAt,
        created_at: firstIso(absence.createdAt),
        approved_at: approvedAt,
        approved_by_id: approvedBy,
        approved_by_name: personName(membersByUser, guildId, approvedBy),
        rejected_at: rejectedAt,
        rejected_by_id: rejectedBy,
        rejected_by_name: personName(membersByUser, guildId, rejectedBy),
        removed_at: firstIso(absence.removedAt),
        removed_by_id: removedBy,
        removed_by_name: personName(membersByUser, guildId, removedBy),
        finished_at: firstIso(absence.finishedAt),
        updated_at: firstIso(absence.updatedAt),
        updated_by_id: updatedBy,
        updated_by_name: personName(membersByUser, guildId, updatedBy),
        decided_at: approvedAt || rejectedAt,
        decided_by_id: approvedBy || rejectedBy,
        decided_by_name: personName(membersByUser, guildId, approvedBy || rejectedBy),
        request_channel_id: absence.requestChannelId || null,
        role_id: absence.roleId || null,
        period_days: periodDays(startsAt, endsAt)
    };
}
export async function listAbsences(params = {}) {
    const data = await readAbsenceData();
    const requestedGuildId = normalizeDiscordId(params.guildId);
    const raw = flattenAbsences(data)
        .filter((absence) => !requestedGuildId || absence.guildId === requestedGuildId)
        .filter((absence) => statusMatches(absence.status, String(params.status || 'all')))
        .filter((absence) => overlapsRange(absence, params.from || '', params.to || ''))
        .sort((a, b) => relevantTime(b) - relevantTime(a));
    const membersByUser = await loadMemberMap(raw);
    const records = raw
        .map((absence) => toRecord(absence, membersByUser))
        .filter((record) => searchMatches(record, params.search || ''));
    const limit = Math.min(Math.max(Number(params.limit || 200), 1), 500);
    const active = records.filter((record) => record.status === 'active');
    const scheduled = records.filter((record) => record.status === 'scheduled');
    const pending = records.filter((record) => record.status === 'pending');
    return {
        metrics: {
            total: records.length,
            active: active.length,
            scheduled: scheduled.length,
            pending: pending.length,
            approved: records.filter((record) => Boolean(record.approved_at)).length
        },
        active: [...active, ...scheduled].sort((a, b) => String(a.ends_at || '').localeCompare(String(b.ends_at || ''))),
        records: records.slice(0, limit)
    };
}
