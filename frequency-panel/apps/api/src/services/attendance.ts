import { one, query } from '../db.js';
import { getMemberByDiscord, upsertMember, type MemberInput } from './members.js';

export type AttendanceAction = 'open' | 'close';

export async function registerPoint(input: {
  action: AttendanceAction;
  guildId: string;
  discordUserId: string;
  actorId?: string | null;
  note?: string | null;
  member?: Partial<MemberInput>;
}) {
  let member = await getMemberByDiscord(input.guildId, input.discordUserId);
  if (!member) {
    member = await upsertMember({
      guildId: input.guildId,
      discordUserId: input.discordUserId,
      username: input.member?.username || input.discordUserId,
      displayName: input.member?.displayName || input.member?.username || input.discordUserId,
      avatarUrl: input.member?.avatarUrl || null,
      highestRoleId: input.member?.highestRoleId || null,
      highestRoleName: input.member?.highestRoleName || null,
      roles: input.member?.roles || [],
      joinedAt: input.member?.joinedAt || null,
      lastSeenAt: new Date().toISOString()
    });
  }

  if (input.action === 'open') {
    const open = await one(
      `SELECT id FROM attendance_sessions WHERE member_id = $1 AND closed_at IS NULL ORDER BY opened_at DESC LIMIT 1`,
      [member.id]
    );
    if (open) return { action: 'already_open', session: open };

    const session = await one(
      `INSERT INTO attendance_sessions (guild_id, member_id, opened_at, source, opened_by, note)
       VALUES ($1, $2, now(), 'discord', $3, $4)
       RETURNING *`,
      [input.guildId, member.id, input.actorId || input.discordUserId, input.note || null]
    );
    await query('UPDATE discord_members SET last_seen_at = now(), updated_at = now() WHERE id = $1', [member.id]);
    return { action: 'opened', session };
  }

  const session = await one(
    `UPDATE attendance_sessions
     SET closed_at = now(),
         total_seconds = GREATEST(0, EXTRACT(EPOCH FROM (now() - opened_at))::int),
         closed_by = $2,
         updated_at = now()
     WHERE id = (
       SELECT id FROM attendance_sessions
       WHERE member_id = $1 AND closed_at IS NULL
       ORDER BY opened_at DESC
       LIMIT 1
     )
     RETURNING *`,
    [member.id, input.actorId || input.discordUserId]
  );
  await query('UPDATE discord_members SET last_seen_at = now(), updated_at = now() WHERE id = $1', [member.id]);
  return session ? { action: 'closed', session } : { action: 'already_closed', session: null };
}

export async function getMemberAttendance(memberId: string, from?: string, to?: string) {
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
  return query(
    `SELECT * FROM attendance_sessions
     WHERE ${where.join(' AND ')}
     ORDER BY opened_at DESC`,
    values
  );
}

export async function getFrequency(memberId: string, from?: string, to?: string) {
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

  return query(
    `SELECT
      opened_at::date AS date_key,
      COUNT(*)::int AS points,
      SUM(total_seconds)::int AS total_seconds
    FROM attendance_sessions
    WHERE ${where.join(' AND ')}
    GROUP BY opened_at::date
    ORDER BY date_key ASC`,
    values
  );
}

export async function getAbsences(memberId: string, from?: string, to?: string) {
  const values: unknown[] = [memberId];
  const where = ['member_id = $1'];
  if (from) {
    values.push(from);
    where.push(`date_key >= $${values.length}`);
  }
  if (to) {
    values.push(to);
    where.push(`date_key <= $${values.length}`);
  }
  return query(`SELECT * FROM absence_records WHERE ${where.join(' AND ')} ORDER BY date_key DESC`, values);
}
