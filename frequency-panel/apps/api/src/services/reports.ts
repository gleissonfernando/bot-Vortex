import { collection, dateKey, toDate } from '../db.js';
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

function cityOnlineFilter() {
  return {
    closed_at: null,
    $or: [
      { source: /fivem/i },
      { note: /fivem|metropole|metropole rp|cidade/i }
    ]
  };
}

function rangeFilter(field: string, from?: string, to?: string) {
  const range: Record<string, Date> = {};
  const fromDate = toDate(from);
  const toDateValue = toDate(to);
  if (fromDate) range.$gte = fromDate;
  if (toDateValue) {
    const nextDay = new Date(toDateValue);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    range.$lt = nextDay;
  }
  return Object.keys(range).length ? { [field]: range } : {};
}

export async function dashboardMetrics() {
  const members = await collection('discord_members');
  const sessions = await collection('attendance_sessions');
  const registeredMembers = await members
    .find(buildRegisteredMemberFilter(), { projection: { id: 1 } })
    .toArray();
  const registeredMemberIds = registeredMembers
    .map((member: any) => String(member.id || ''))
    .filter(Boolean);
  const registeredSessionFilter = { member_id: { $in: registeredMemberIds } };
  const onlineFilter = {
    ...cityOnlineFilter(),
    ...registeredSessionFilter
  };

  const [activeMemberIds, openPoints, monthSessions, trendSessions, cityOnlineSessions] = await Promise.all([
    sessions.distinct('member_id', onlineFilter),
    sessions.countDocuments({ closed_at: null, ...registeredSessionFilter }),
    sessions.find({ opened_at: { $gte: monthStart() }, ...registeredSessionFilter }).toArray(),
    sessions.find({ opened_at: { $gte: thirtyDaysAgo() }, ...registeredSessionFilter }).sort({ opened_at: 1 }).toArray(),
    sessions.aggregate([
      { $match: onlineFilter },
      { $sort: { opened_at: -1 } },
      { $limit: 12 },
      {
        $lookup: {
          from: 'discord_members',
          localField: 'member_id',
          foreignField: 'id',
          as: 'member'
        }
      },
      { $unwind: { path: '$member', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          id: 1,
          action: { $cond: [{ $ifNull: ['$closed_at', false] }, 'closed', 'opened'] },
          at: { $ifNull: ['$closed_at', '$opened_at'] },
          opened_at: 1,
          closed_at: 1,
          total_seconds: 1,
          source: 1,
          note: 1,
          member_name: '$member.display_name',
          username: '$member.username',
          avatar_url: '$member.avatar_url',
          discord_user_id: '$member.discord_user_id',
          role: '$member.highest_role_name'
        }
      }
    ]).toArray()
  ]);

  const trendMap = new Map<string, { date_key: string; points: number; total_seconds: number }>();
  for (const session of trendSessions as any[]) {
    const key = dateKey(session.opened_at);
    const item = trendMap.get(key) || { date_key: key, points: 0, total_seconds: 0 };
    item.points += 1;
    item.total_seconds += Number(session.total_seconds || 0);
    trendMap.set(key, item);
  }

  return {
    metrics: {
      total_members: registeredMembers.length,
      active_members: activeMemberIds.length,
      open_points: openPoints,
      month_seconds: (monthSessions as any[]).reduce((sum, session) => sum + Number(session.total_seconds || 0), 0)
    },
    trend: [...trendMap.values()].sort((a, b) => a.date_key.localeCompare(b.date_key)),
    activity: [
      ...(cityOnlineSessions as any[]).map((item) => {
        const openedAt = item.opened_at instanceof Date ? item.opened_at : toDate(item.opened_at);
        const elapsedSeconds = openedAt ? Math.max(0, Math.floor((Date.now() - openedAt.getTime()) / 1000)) : 0;
        return {
          id: String(item.id || `${item.member_id || item.discord_user_id}:${item.at}`),
          type: 'city.online',
          title: 'Na cidade agora',
          member_name: item.member_name || item.username || 'Membro',
          username: item.username || null,
          avatar_url: item.avatar_url || null,
          discord_user_id: item.discord_user_id || null,
          at: openedAt ? openedAt.toISOString() : null,
          total_seconds: elapsedSeconds,
          source: item.source || 'fivem',
          role: item.role || null,
          city: item.note || 'FiveM'
        };
      })
    ]
      .filter((item) => item.at)
      .sort((a, b) => String(b.at).localeCompare(String(a.at)))
      .slice(0, 10)
  };
}

export async function memberReport(memberId: string, from?: string, to?: string) {
  const sessions = await collection('attendance_sessions');
  const docs = await sessions.find({
    member_id: memberId,
    ...rangeFilter('opened_at', from, to)
  }).sort({ opened_at: 1 }).toArray();

  const daysMap = new Map<string, { date_key: string; sessions: number; total_seconds: number }>();
  let lastActivity: Date | null = null;
  let openSessions = 0;
  let totalSeconds = 0;

  for (const session of docs as any[]) {
    const key = dateKey(session.opened_at);
    const day = daysMap.get(key) || { date_key: key, sessions: 0, total_seconds: 0 };
    const seconds = Number(session.total_seconds || 0);
    day.sessions += 1;
    day.total_seconds += seconds;
    totalSeconds += seconds;
    if (!session.closed_at) openSessions += 1;

    const activity = session.closed_at || session.opened_at;
    if (activity && (!lastActivity || activity > lastActivity)) lastActivity = activity;
    daysMap.set(key, day);
  }

  return {
    summary: {
      total_sessions: docs.length,
      open_sessions: openSessions,
      total_seconds: totalSeconds,
      active_days: daysMap.size,
      last_activity_at: lastActivity ? lastActivity.toISOString() : null
    },
    days: [...daysMap.values()].sort((a, b) => a.date_key.localeCompare(b.date_key))
  };
}

export function secondsToLabel(seconds: number) {
  const totalMinutes = Math.max(0, Math.round(Number(seconds || 0) / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (!hours) return `${minutes}min`;
  if (!minutes) return `${hours}h`;
  return `${hours}h ${minutes}min`;
}

export function toCsv(rows: Record<string, unknown>[]) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((key) => JSON.stringify(row[key] ?? '')).join(','));
  }
  return lines.join('\n');
}
