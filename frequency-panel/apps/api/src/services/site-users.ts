import { randomUUID } from 'node:crypto';
import { collection, serializeDoc, serializeDocs } from '../db.js';
import { env } from '../env.js';

export type SiteUserStatus = 'active' | 'suspended' | 'banned';
export type SiteUserRole = 'admin' | 'manager' | 'viewer';

export type SiteUser = {
  id: string;
  guild_id: string;
  discord_id: string;
  discord_name: string;
  discord_email?: string | null;
  discord_avatar_url?: string | null;
  system_role: SiteUserRole;
  permission_level: number;
  status: SiteUserStatus;
  discord_roles: string[];
  discord_guilds?: string[];
  registered_by?: string | null;
  registered_by_name?: string | null;
  registered_at: Date;
  updated_at: Date;
  last_login_at?: Date | null;
};

const validRoles = new Set(['admin', 'manager', 'viewer']);
const validStatuses = new Set(['active', 'suspended', 'banned']);

export function normalizeSiteRole(value: unknown): SiteUserRole {
  const role = String(value || '').toLowerCase();
  return validRoles.has(role) ? role as SiteUserRole : 'viewer';
}

export function normalizeSiteStatus(value: unknown): SiteUserStatus {
  const status = String(value || '').toLowerCase();
  return validStatuses.has(status) ? status as SiteUserStatus : 'active';
}

export async function findSiteUser(guildId: string, discordId: string) {
  const users = await collection<SiteUser>('site_users');
  return serializeDoc(await users.findOne({ guild_id: guildId, discord_id: discordId }));
}

export async function listSiteUsers(search = '') {
  const users = await collection<SiteUser>('site_users');
  const query = search
    ? {
        $or: [
          { discord_id: { $regex: search, $options: 'i' } },
          { discord_name: { $regex: search, $options: 'i' } },
          { system_role: { $regex: search, $options: 'i' } }
        ]
      }
    : {};
  return serializeDocs(await users.find(query).sort({ updated_at: -1 }).limit(250).toArray());
}

export async function upsertSiteUser(input: {
  guildId?: string;
  discordId: string;
  discordName: string;
  discordEmail?: string | null;
  discordAvatarUrl?: string | null;
  systemRole: string;
  permissionLevel: number;
  status?: string;
  actorId?: string;
  actorName?: string;
  discordRoles?: string[];
  discordGuilds?: string[];
}) {
  const users = await collection<SiteUser>('site_users');
  const now = new Date();
  const guildId = input.guildId || env.discordGuildId;
  const discordId = String(input.discordId || '').trim();
  if (!/^\d{15,25}$/.test(discordId)) throw new Error('Discord ID invalido');

  await users.updateOne(
    { guild_id: guildId, discord_id: discordId },
    {
      $set: {
        discord_name: String(input.discordName || discordId).slice(0, 120),
        discord_email: input.discordEmail || null,
        discord_avatar_url: input.discordAvatarUrl || null,
        system_role: normalizeSiteRole(input.systemRole),
        permission_level: Math.max(1, Math.min(100, Math.floor(Number(input.permissionLevel) || 1))),
        status: normalizeSiteStatus(input.status),
        discord_roles: Array.isArray(input.discordRoles) ? input.discordRoles.map(String) : [],
        discord_guilds: Array.isArray(input.discordGuilds) ? input.discordGuilds.map(String) : [],
        updated_at: now
      },
      $setOnInsert: {
        id: randomUUID(),
        guild_id: guildId,
        discord_id: discordId,
        registered_by: input.actorId || null,
        registered_by_name: input.actorName || null,
        registered_at: now
      }
    },
    { upsert: true }
  );

  return findSiteUser(guildId, discordId);
}

export async function updateSiteUser(discordId: string, patch: Partial<SiteUser>, guildId = env.discordGuildId) {
  const users = await collection<SiteUser>('site_users');
  const cleanPatch: Record<string, unknown> = { updated_at: new Date() };
  if (patch.system_role) cleanPatch.system_role = normalizeSiteRole(patch.system_role);
  if (patch.status) cleanPatch.status = normalizeSiteStatus(patch.status);
  if (patch.permission_level !== undefined) cleanPatch.permission_level = Math.max(1, Math.min(100, Math.floor(Number(patch.permission_level) || 1)));
  if (patch.discord_name) cleanPatch.discord_name = String(patch.discord_name).slice(0, 120);
  if (Object.prototype.hasOwnProperty.call(patch, 'discord_email')) cleanPatch.discord_email = patch.discord_email || null;
  if (Object.prototype.hasOwnProperty.call(patch, 'discord_avatar_url')) cleanPatch.discord_avatar_url = patch.discord_avatar_url || null;
  if (Array.isArray(patch.discord_roles)) cleanPatch.discord_roles = patch.discord_roles.map(String);
  if (Array.isArray(patch.discord_guilds)) cleanPatch.discord_guilds = patch.discord_guilds.map(String);

  await users.updateOne({ guild_id: guildId, discord_id: discordId }, { $set: cleanPatch });
  return findSiteUser(guildId, discordId);
}

export async function removeSiteUser(discordId: string, guildId = env.discordGuildId) {
  const users = await collection<SiteUser>('site_users');
  await users.deleteOne({ guild_id: guildId, discord_id: discordId });
}

export async function markSiteUserLogin(discordId: string, guildId = env.discordGuildId) {
  const users = await collection<SiteUser>('site_users');
  await users.updateOne({ guild_id: guildId, discord_id: discordId }, { $set: { last_login_at: new Date() } });
}

export async function siteUserHistory(discordId: string, guildId = env.discordGuildId) {
  const logs = await collection('site_user_audit_logs');
  return serializeDocs(await logs.find({ guild_id: guildId, target_discord_id: discordId }).sort({ created_at: -1 }).limit(80).toArray());
}
