import { collection, dateKey, toDate } from '../db.js';

function monthStart() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function thirtyDaysAgo() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 30);
  return date;
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

  const [totalMembers, activeMembers, openPoints, monthSessions, trendSessions, recentSessions, recentMembers] = await Promise.all([
    members.countDocuments({}),
    members.countDocuments({ status: 'active' }),
    sessions.countDocuments({ closed_at: null }),
    sessions.find({ opened_at: { $gte: monthStart() } }).toArray(),
    sessions.find({ opened_at: { $gte: thirtyDaysAgo() } }).sort({ opened_at: 1 }).toArray(),
    sessions.aggregate([
      { $sort: { opened_at: -1 } },
      { $limit: 8 },
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
          member_name: '$member.display_name',
          username: '$member.username',
          avatar_url: '$member.avatar_url',
          discord_user_id: '$member.discord_user_id'
        }
      }
    ]).toArray(),
    members.find({ last_seen_at: { $ne: null } }).sort({ last_seen_at: -1 }).limit(6).project({
      id: 1,
      display_name: 1,
      username: 1,
      avatar_url: 1,
      discord_user_id: 1,
      last_seen_at: 1,
      highest_role_name: 1
    }).toArray()
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
      total_members: totalMembers,
      active_members: activeMembers,
      open_points: openPoints,
      month_seconds: (monthSessions as any[]).reduce((sum, session) => sum + Number(session.total_seconds || 0), 0)
    },
    trend: [...trendMap.values()].sort((a, b) => a.date_key.localeCompare(b.date_key)),
    activity: [
      ...(recentSessions as any[]).map((item) => ({
        id: String(item.id || `${item.member_id || item.discord_user_id}:${item.at}`),
        type: item.action === 'closed' ? 'point.closed' : 'point.opened',
        title: item.action === 'closed' ? 'Ponto fechado' : 'Ponto aberto',
        member_name: item.member_name || item.username || 'Membro',
        username: item.username || null,
        avatar_url: item.avatar_url || null,
        discord_user_id: item.discord_user_id || null,
        at: item.at ? item.at.toISOString() : null,
        total_seconds: Number(item.total_seconds || 0),
        source: item.source || 'bot'
      })),
      ...(recentMembers as any[]).map((member) => ({
        id: `presence:${member.id}`,
        type: 'presence.seen',
        title: 'Presenca detectada',
        member_name: member.display_name || member.username || 'Membro',
        username: member.username || null,
        avatar_url: member.avatar_url || null,
        discord_user_id: member.discord_user_id || null,
        at: member.last_seen_at ? member.last_seen_at.toISOString() : null,
        role: member.highest_role_name || null
      }))
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
