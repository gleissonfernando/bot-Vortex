import { collection, dateKey, toDate } from '../db.js';
import { ensureRegisteredMembers } from './members.js';
import { buildRegisteredMemberFilter } from './profileRegistry.js';
function monthStart() {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
function thirtyDaysAgo() {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - 30);
    return date;
}
function cityPresenceFreshSince() {
    const staleSeconds = Math.max(60, Number(process.env.CITY_PRESENCE_STALE_SECONDS || 180) || 180);
    return new Date(Date.now() - staleSeconds * 1000);
}
export async function dashboardMetrics() {
    const members = await collection('discord_members');
    const sessions = await collection('attendance_sessions');
    const cityPresence = await collection('city_presence');
    await ensureRegisteredMembers();
    const registeredMemberFilter = await buildRegisteredMemberFilter();
    const registeredMembers = await members
        .find(registeredMemberFilter, {
        projection: {
            id: 1,
            guild_id: 1,
            discord_user_id: 1,
            username: 1,
            global_name: 1,
            display_name: 1,
            avatar_url: 1,
            banner_url: 1,
            highest_role_name: 1
        }
    })
        .toArray();
    const registeredMemberIds = registeredMembers
        .map((member) => String(member.id || ''))
        .filter(Boolean);
    const registeredDiscordUserIds = registeredMembers
        .map((member) => String(member.discord_user_id || ''))
        .filter(Boolean);
    const memberByDiscordKey = new Map(registeredMembers.map((member) => [`${member.guild_id}:${member.discord_user_id}`, member]));
    const registeredSessionFilter = { member_id: { $in: registeredMemberIds } };
    const cityPresenceFilter = {
        city_online: true,
        seen_at: { $gte: cityPresenceFreshSince() },
        discord_user_id: { $in: registeredDiscordUserIds }
    };
    const [cityOnlineDocs, openPointMemberIds, monthSessions, trendSessions] = await Promise.all([
        cityPresence.find(cityPresenceFilter).sort({ city_started_at: -1, seen_at: -1 }).toArray(),
        sessions.distinct('member_id', { closed_at: null, ...registeredSessionFilter }),
        sessions.find({ opened_at: { $gte: monthStart() }, ...registeredSessionFilter }).toArray(),
        sessions.find({ opened_at: { $gte: thirtyDaysAgo() }, ...registeredSessionFilter }).sort({ opened_at: 1 }).toArray()
    ]);
    const cityMemberIds = new Set();
    const trendMap = new Map();
    for (const session of trendSessions) {
        const key = dateKey(session.opened_at);
        const item = trendMap.get(key) || { date_key: key, points: 0, total_seconds: 0 };
        item.points += 1;
        item.total_seconds += Number(session.total_seconds || 0);
        trendMap.set(key, item);
    }
    const activity = cityOnlineDocs
        .map((item) => {
        const member = memberByDiscordKey.get(`${item.guild_id}:${item.discord_user_id}`);
        if (!member)
            return null;
        cityMemberIds.add(String(member.id));
        const startedAt = item.city_started_at instanceof Date ? item.city_started_at : toDate(item.city_started_at);
        const seenAt = item.seen_at instanceof Date ? item.seen_at : toDate(item.seen_at);
        const elapsedSeconds = startedAt ? Math.max(0, Math.floor((Date.now() - startedAt.getTime()) / 1000)) : 0;
        return {
            id: String(`${item.guild_id}:${item.discord_user_id}`),
            type: 'city.online',
            title: 'Na cidade agora',
            member_name: member.global_name || member.display_name || member.username || 'Membro',
            global_name: member.global_name || null,
            username: member.username || null,
            avatar_url: member.avatar_url || null,
            banner_url: member.banner_url || null,
            discord_user_id: member.discord_user_id || item.discord_user_id || null,
            at: startedAt ? startedAt.toISOString() : seenAt ? seenAt.toISOString() : null,
            total_seconds: elapsedSeconds,
            source: 'fivem',
            role: member.highest_role_name || null,
            city: item.city_name || 'FiveM'
        };
    })
        .filter((item) => Boolean(item?.at))
        .sort((a, b) => String(b.at).localeCompare(String(a.at)))
        .slice(0, 10);
    return {
        metrics: {
            total_members: registeredMembers.length,
            active_members: cityMemberIds.size,
            open_points: openPointMemberIds.length,
            month_seconds: monthSessions.reduce((sum, session) => sum + Number(session.total_seconds || 0), 0)
        },
        trend: [...trendMap.values()].sort((a, b) => a.date_key.localeCompare(b.date_key)),
        activity
    };
}
