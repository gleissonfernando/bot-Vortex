import { query } from '../db.js';

export async function dashboardMetrics() {
  const rows = await query<{
    total_members: number;
    active_members: number;
    open_points: number;
    month_seconds: number;
  }>(
    `SELECT
      (SELECT COUNT(*) FROM discord_members)::int AS total_members,
      (SELECT COUNT(*) FROM discord_members WHERE status = 'active')::int AS active_members,
      (SELECT COUNT(*) FROM attendance_sessions WHERE closed_at IS NULL)::int AS open_points,
      (SELECT COALESCE(SUM(total_seconds), 0)::int FROM attendance_sessions WHERE opened_at >= date_trunc('month', now())) AS month_seconds`
  );

  const trend = await query(
    `SELECT
      opened_at::date AS date_key,
      COUNT(*)::int AS points,
      COALESCE(SUM(total_seconds), 0)::int AS total_seconds
    FROM attendance_sessions
    WHERE opened_at >= (now() - interval '30 days')
    GROUP BY opened_at::date
    ORDER BY date_key ASC`
  );

  return { metrics: rows[0], trend };
}

export async function memberReport(memberId: string, from?: string, to?: string) {
  const values: unknown[] = [memberId];
  const where = ['member_id = $1'];
  if (from) {
    values.push(from);
    where.push(`opened_at >= $${values.length}`);
  }
  if (to) {
    values.push(to);
    where.push(`opened_at < ($${values.length}::date + interval '1 day')`);
  }

  const summary = await query(
    `SELECT
      COUNT(*)::int AS total_sessions,
      COUNT(*) FILTER (WHERE closed_at IS NULL)::int AS open_sessions,
      COALESCE(SUM(total_seconds), 0)::int AS total_seconds,
      COUNT(DISTINCT opened_at::date)::int AS active_days,
      MAX(COALESCE(closed_at, opened_at)) AS last_activity_at
    FROM attendance_sessions
    WHERE ${where.join(' AND ')}`,
    values
  );

  const days = await query(
    `SELECT
      opened_at::date AS date_key,
      COUNT(*)::int AS sessions,
      COALESCE(SUM(total_seconds), 0)::int AS total_seconds
    FROM attendance_sessions
    WHERE ${where.join(' AND ')}
    GROUP BY opened_at::date
    ORDER BY date_key ASC`,
    values
  );

  return { summary: summary[0], days };
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
