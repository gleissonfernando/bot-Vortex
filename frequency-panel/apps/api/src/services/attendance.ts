import { randomUUID } from 'node:crypto';
import { collection, dateKey, serializeDoc, serializeDocs, toDate } from '../db.js';
import { getMemberByDiscord, upsertMember, type MemberInput } from './members.js';

export type AttendanceAction = 'open' | 'close';

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
  if (!member) throw new Error('Unable to create or load member');

  const sessions = await collection('attendance_sessions');
  const members = await collection('discord_members');
  const now = new Date();

  if (input.action === 'open') {
    const open = serializeDoc(await sessions.findOne(
      { member_id: member.id, closed_at: null },
      { sort: { opened_at: -1 } }
    ));
    if (open) return { action: 'already_open', session: open };

    const session = {
      id: randomUUID(),
      guild_id: input.guildId,
      member_id: member.id,
      opened_at: now,
      closed_at: null,
      total_seconds: 0,
      source: 'discord',
      opened_by: input.actorId || input.discordUserId,
      closed_by: null,
      note: input.note || null,
      created_at: now,
      updated_at: now
    };
    await sessions.insertOne(session);
    await members.updateOne({ id: member.id }, { $set: { last_seen_at: now, updated_at: now } });
    return { action: 'opened', session: serializeDoc(session) };
  }

  const open = await sessions.findOne(
    { member_id: member.id, closed_at: null },
    { sort: { opened_at: -1 } }
  );
  if (!open) {
    await members.updateOne({ id: member.id }, { $set: { last_seen_at: now, updated_at: now } });
    return { action: 'already_closed', session: null };
  }

  const totalSeconds = Math.max(0, Math.floor((now.getTime() - new Date(open.opened_at).getTime()) / 1000));
  await sessions.updateOne(
    { id: open.id },
    {
      $set: {
        closed_at: now,
        total_seconds: totalSeconds,
        closed_by: input.actorId || input.discordUserId,
        updated_at: now
      }
    }
  );
  await members.updateOne({ id: member.id }, { $set: { last_seen_at: now, updated_at: now } });
  return {
    action: 'closed',
    session: serializeDoc({
      ...open,
      closed_at: now,
      total_seconds: totalSeconds,
      closed_by: input.actorId || input.discordUserId,
      updated_at: now
    })
  };
}

export async function getMemberAttendance(memberId: string, from?: string, to?: string) {
  const sessions = await collection('attendance_sessions');
  return serializeDocs(
    await sessions.find({
      member_id: memberId,
      ...rangeFilter('opened_at', from, to)
    }).sort({ opened_at: -1 }).toArray()
  );
}

export async function getFrequency(memberId: string, from?: string, to?: string) {
  const sessions = await collection('attendance_sessions');
  const docs = await sessions.find({
    member_id: memberId,
    ...rangeFilter('opened_at', from, to)
  }).sort({ opened_at: 1 }).toArray();
  const grouped = new Map<string, { date_key: string; points: number; total_seconds: number }>();

  for (const session of docs as any[]) {
    const key = dateKey(session.opened_at);
    const item = grouped.get(key) || { date_key: key, points: 0, total_seconds: 0 };
    item.points += 1;
    item.total_seconds += Number(session.total_seconds || 0);
    grouped.set(key, item);
  }

  return [...grouped.values()].sort((a, b) => a.date_key.localeCompare(b.date_key));
}

export async function getAbsences(memberId: string, from?: string, to?: string) {
  const absences = await collection('absence_records');
  const filter: Record<string, any> = { member_id: memberId };
  if (from || to) {
    filter.date_key = {};
    if (from) filter.date_key.$gte = from;
    if (to) filter.date_key.$lte = to;
  }
  return serializeDocs(await absences.find(filter).sort({ date_key: -1 }).toArray());
}
