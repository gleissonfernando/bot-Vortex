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

  const [totalMembers, activeMembers, openPoints, monthSessions, trendSessions] = await Promise.all([
    members.countDocuments({}),
    members.countDocuments({ status: 'active' }),
    sessions.countDocuments({ closed_at: null }),
    sessions.find({ opened_at: { $gte: monthStart() } }).toArray(),
    sessions.find({ opened_at: { $gte: thirtyDaysAgo() } }).sort({ opened_at: 1 }).toArray()
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
    trend: [...trendMap.values()].sort((a, b) => a.date_key.localeCompare(b.date_key))
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
