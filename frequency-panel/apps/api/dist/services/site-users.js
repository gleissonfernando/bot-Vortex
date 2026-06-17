import { randomUUID } from 'node:crypto';
import { collection, serializeDoc, serializeDocs } from '../db.js';
import { env } from '../env.js';
const validRoles = new Set(['admin', 'manager', 'viewer']);
const validStatuses = new Set(['active', 'suspended', 'banned']);
export function normalizeSiteRole(value) {
    const role = String(value || '').toLowerCase();
    return validRoles.has(role) ? role : 'viewer';
}
export function normalizeSiteStatus(value) {
    const status = String(value || '').toLowerCase();
    return validStatuses.has(status) ? status : 'active';
}
export async function findSiteUser(guildId, discordId) {
    const users = await collection('site_users');
    return serializeDoc(await users.findOne({ guild_id: guildId, discord_id: discordId }));
}
export async function listSiteUsers(search = '') {
    const users = await collection('site_users');
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
export async function upsertSiteUser(input) {
    const users = await collection('site_users');
    const now = new Date();
    const guildId = input.guildId || env.discordGuildId;
    const discordId = String(input.discordId || '').trim();
    if (!/^\d{15,25}$/.test(discordId))
        throw new Error('Discord ID invalido');
    await users.updateOne({ guild_id: guildId, discord_id: discordId }, {
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
    }, { upsert: true });
    return findSiteUser(guildId, discordId);
}
export async function updateSiteUser(discordId, patch, guildId = env.discordGuildId) {
    const users = await collection('site_users');
    const cleanPatch = { updated_at: new Date() };
    if (patch.system_role)
        cleanPatch.system_role = normalizeSiteRole(patch.system_role);
    if (patch.status)
        cleanPatch.status = normalizeSiteStatus(patch.status);
    if (patch.permission_level !== undefined)
        cleanPatch.permission_level = Math.max(1, Math.min(100, Math.floor(Number(patch.permission_level) || 1)));
    if (patch.discord_name)
        cleanPatch.discord_name = String(patch.discord_name).slice(0, 120);
    if (Object.prototype.hasOwnProperty.call(patch, 'discord_email'))
        cleanPatch.discord_email = patch.discord_email || null;
    if (Object.prototype.hasOwnProperty.call(patch, 'discord_avatar_url'))
        cleanPatch.discord_avatar_url = patch.discord_avatar_url || null;
    if (Array.isArray(patch.discord_roles))
        cleanPatch.discord_roles = patch.discord_roles.map(String);
    if (Array.isArray(patch.discord_guilds))
        cleanPatch.discord_guilds = patch.discord_guilds.map(String);
    await users.updateOne({ guild_id: guildId, discord_id: discordId }, { $set: cleanPatch });
    return findSiteUser(guildId, discordId);
}
export async function removeSiteUser(discordId, guildId = env.discordGuildId) {
    const users = await collection('site_users');
    await users.deleteOne({ guild_id: guildId, discord_id: discordId });
}
export async function markSiteUserLogin(discordId, guildId = env.discordGuildId) {
    const users = await collection('site_users');
    await users.updateOne({ guild_id: guildId, discord_id: discordId }, { $set: { last_login_at: new Date() } });
}
export async function siteUserHistory(discordId, guildId = env.discordGuildId) {
    const logs = await collection('site_user_audit_logs');
    return serializeDocs(await logs.find({ guild_id: guildId, target_discord_id: discordId }).sort({ created_at: -1 }).limit(80).toArray());
}
