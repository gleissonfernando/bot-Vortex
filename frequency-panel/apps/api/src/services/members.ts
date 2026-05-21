import { one, query } from '../db.js';

export type MemberInput = {
  guildId: string;
  discordUserId: string;
  username: string;
  displayName: string;
  avatarUrl?: string | null;
  highestRoleId?: string | null;
  highestRoleName?: string | null;
  roles?: Array<{ id: string; name: string }>;
  joinedAt?: string | null;
  status?: 'active' | 'inactive';
  lastSeenAt?: string | null;
};

export async function upsertMember(input: MemberInput) {
  return one(
    `INSERT INTO discord_members (
      guild_id, discord_user_id, username, display_name, avatar_url,
      highest_role_id, highest_role_name, roles, joined_at, status, last_seen_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now())
    ON CONFLICT (guild_id, discord_user_id) DO UPDATE SET
      username = excluded.username,
      display_name = excluded.display_name,
      avatar_url = excluded.avatar_url,
      highest_role_id = excluded.highest_role_id,
      highest_role_name = excluded.highest_role_name,
      roles = excluded.roles,
      joined_at = COALESCE(excluded.joined_at, discord_members.joined_at),
      status = excluded.status,
      last_seen_at = COALESCE(excluded.last_seen_at, discord_members.last_seen_at),
      updated_at = now()
    RETURNING *`,
    [
      input.guildId,
      input.discordUserId,
      input.username,
      input.displayName,
      input.avatarUrl || null,
      input.highestRoleId || null,
      input.highestRoleName || null,
      JSON.stringify(input.roles || []),
      input.joinedAt || null,
      input.status || 'active',
      input.lastSeenAt || null
    ]
  );
}

export async function listMembers(params: {
  guildId?: string;
  search?: string;
  role?: string;
  status?: string;
  limit?: number;
}) {
  const values: unknown[] = [];
  const where: string[] = [];

  if (params.guildId) {
    values.push(params.guildId);
    where.push(`guild_id = $${values.length}`);
  }

  if (params.search) {
    values.push(`%${params.search.toLowerCase()}%`);
    where.push(`(lower(display_name) LIKE $${values.length} OR lower(username) LIKE $${values.length} OR discord_user_id LIKE $${values.length})`);
  }

  if (params.role) {
    values.push(params.role);
    where.push(`(highest_role_id = $${values.length} OR highest_role_name = $${values.length} OR roles @> jsonb_build_array(jsonb_build_object('id', $${values.length}::text)))`);
  }

  if (params.status) {
    values.push(params.status);
    where.push(`status = $${values.length}`);
  }

  values.push(Math.min(Math.max(Number(params.limit || 80), 1), 200));
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  return query(
    `SELECT
      m.*,
      COALESCE(SUM(s.total_seconds), 0)::int AS total_seconds,
      COUNT(s.id)::int AS session_count,
      MAX(COALESCE(s.closed_at, s.opened_at)) AS last_point_at
    FROM discord_members m
    LEFT JOIN attendance_sessions s ON s.member_id = m.id
    ${whereSql}
    GROUP BY m.id
    ORDER BY m.display_name ASC
    LIMIT $${values.length}`,
    values
  );
}

export async function getMember(memberId: string) {
  return one(
    `SELECT
      m.*,
      COALESCE(SUM(s.total_seconds), 0)::int AS total_seconds,
      COUNT(s.id)::int AS session_count,
      MAX(COALESCE(s.closed_at, s.opened_at)) AS last_point_at,
      COUNT(a.id)::int AS absence_count
    FROM discord_members m
    LEFT JOIN attendance_sessions s ON s.member_id = m.id
    LEFT JOIN absence_records a ON a.member_id = m.id
    WHERE m.id = $1
    GROUP BY m.id`,
    [memberId]
  );
}

export async function getMemberByDiscord(guildId: string, discordUserId: string) {
  return one('SELECT * FROM discord_members WHERE guild_id = $1 AND discord_user_id = $2', [guildId, discordUserId]);
}
