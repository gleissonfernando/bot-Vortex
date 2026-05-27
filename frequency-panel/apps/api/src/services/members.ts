import { randomUUID } from 'node:crypto';
import { collection, serializeDoc, serializeDocs, toDate } from '../db.js';
import {
  buildRegisteredMemberFilter,
  getRegisteredProfileMemberInputs,
  isRegisteredProfile
} from './profileRegistry.js';

export type MemberInput = {
  guildId: string;
  discordUserId: string;
  username: string;
  globalName?: string | null;
  displayName: string;
  avatarUrl?: string | null;
  bannerUrl?: string | null;
  highestRoleId?: string | null;
  highestRoleName?: string | null;
  roles?: Array<{ id: string; name: string }>;
  joinedAt?: string | null;
  status?: 'active' | 'inactive';
  lastSeenAt?: string | null;
};

export async function upsertMember(input: MemberInput) {
  const members = await collection('discord_members');
  const now = new Date();
  const existing = await members.findOne({
    guild_id: input.guildId,
    discord_user_id: input.discordUserId
  });

  const joinedAt = toDate(input.joinedAt) || existing?.joined_at || null;
  const lastSeenAt = toDate(input.lastSeenAt) || existing?.last_seen_at || null;
  const id = existing?.id || randomUUID();

  await members.updateOne(
    { guild_id: input.guildId, discord_user_id: input.discordUserId },
    {
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
    },
    { upsert: true }
  );

  return getMemberByDiscord(input.guildId, input.discordUserId);
}

export async function listMembers(params: {
  guildId?: string;
  search?: string;
  role?: string;
  status?: string;
  limit?: number;
}) {
  const members = await collection('discord_members');
  const sessions = await collection('attendance_sessions');
  await ensureRegisteredMembers(params.guildId);
  const filter: Record<string, any> = {};

  if (params.guildId) filter.guild_id = params.guildId;
  if (params.status) filter.status = params.status;
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
  const docs = serializeDocs(
    await members.find(filter).sort({ display_name: 1 }).limit(limit).toArray()
  );
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
  const statsByMemberId = new Map(sessionStats.map((item: any) => [item._id, item]));

  return docs.map((member) => {
    const stats = statsByMemberId.get(member.id) as any;
    return {
      ...member,
      total_seconds: Number(stats?.total_seconds || 0),
      session_count: Number(stats?.session_count || 0),
      last_point_at: stats?.last_point_at ? stats.last_point_at.toISOString() : null
    };
  });
}

export async function ensureRegisteredMembers(guildId?: string) {
  const profileMembers = await getRegisteredProfileMemberInputs(guildId);
  if (!profileMembers.length) return;

  const members = await collection('discord_members');
  const existing = await members.find({
    $or: profileMembers.map((member: any) => ({
      guild_id: member.guildId,
      discord_user_id: member.discordUserId
    }))
  }, { projection: { guild_id: 1, discord_user_id: 1 } }).toArray();
  const existingKeys = new Set(existing.map((member: any) => `${member.guild_id}:${member.discord_user_id}`));

  for (const member of profileMembers as MemberInput[]) {
    if (existingKeys.has(`${member.guildId}:${member.discordUserId}`)) continue;
    await upsertMember(member);
  }
}

export async function getMember(memberId: string) {
  const members = await collection('discord_members');
  const sessions = await collection('attendance_sessions');
  const absences = await collection('absence_records');
  const member = serializeDoc(await members.findOne({ id: memberId }));
  if (!member) return null;
  if (!(await isRegisteredProfile(member.guild_id, member.discord_user_id))) return null;

  const related = await sessions.find({ member_id: memberId }).toArray();
  const total_seconds = related.reduce((sum, session: any) => sum + Number(session.total_seconds || 0), 0);
  const last = related
    .map((session: any) => session.closed_at || session.opened_at)
    .filter(Boolean)
    .sort((a: Date, b: Date) => b.getTime() - a.getTime())[0] || null;
  const absence_count = await absences.countDocuments({ member_id: memberId });

  return {
    ...member,
    total_seconds,
    session_count: related.length,
    last_point_at: last ? last.toISOString() : null,
    absence_count
  };
}

export async function getMemberByDiscord(guildId: string, discordUserId: string) {
  const members = await collection('discord_members');
  return serializeDoc(await members.findOne({ guild_id: guildId, discord_user_id: discordUserId }));
}
