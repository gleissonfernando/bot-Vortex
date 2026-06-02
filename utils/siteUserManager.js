const { randomUUID } = require('node:crypto');
const { connectDatabase } = require('./database');
const mongoose = require('mongoose');

const VALID_ROLES = new Set(['admin', 'manager', 'viewer']);
const VALID_STATUS = new Set(['active', 'suspended', 'banned']);

function normalizeSystemRole(value) {
  const role = String(value || '').trim().toLowerCase();
  return VALID_ROLES.has(role) ? role : 'viewer';
}

function normalizeStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  return VALID_STATUS.has(status) ? status : 'active';
}

async function siteUsersCollection() {
  const connected = await connectDatabase();
  if (!connected || !mongoose.connection.db) throw new Error('MongoDB indisponivel para cadastro do site.');
  return mongoose.connection.db.collection('site_users');
}

async function siteAuditCollection() {
  const connected = await connectDatabase();
  if (!connected || !mongoose.connection.db) throw new Error('MongoDB indisponivel para auditoria do site.');
  return mongoose.connection.db.collection('site_user_audit_logs');
}

async function upsertSiteUser(input) {
  const users = await siteUsersCollection();
  const now = new Date();
  const discordId = String(input.discordId || '').trim();
  const guildId = String(input.guildId || '').trim();
  if (!/^\d{15,25}$/.test(discordId)) throw new Error('Discord ID invalido.');

  const user = {
    id: input.id || randomUUID(),
    guild_id: guildId,
    discord_id: discordId,
    discord_name: String(input.discordName || discordId).slice(0, 120),
    discord_avatar_url: input.discordAvatarUrl || null,
    system_role: normalizeSystemRole(input.systemRole),
    permission_level: Number.isFinite(Number(input.permissionLevel)) ? Number(input.permissionLevel) : 1,
    status: normalizeStatus(input.status),
    discord_roles: Array.isArray(input.discordRoles) ? input.discordRoles.map(String) : [],
    registered_by: input.registeredBy || null,
    registered_by_name: input.registeredByName || null,
    registered_at: now,
    updated_at: now,
  };

  await users.updateOne(
    { guild_id: guildId, discord_id: discordId },
    {
      $set: {
        discord_name: user.discord_name,
        discord_avatar_url: user.discord_avatar_url,
        system_role: user.system_role,
        permission_level: user.permission_level,
        status: user.status,
        discord_roles: user.discord_roles,
        updated_at: now,
      },
      $setOnInsert: {
        id: user.id,
        guild_id: guildId,
        discord_id: discordId,
        registered_by: user.registered_by,
        registered_by_name: user.registered_by_name,
        registered_at: now,
      },
    },
    { upsert: true }
  );

  await auditSiteUser({
    action: 'site_user.registered',
    actorId: input.registeredBy,
    actorName: input.registeredByName,
    guildId,
    targetDiscordId: discordId,
    metadata: {
      system_role: user.system_role,
      permission_level: user.permission_level,
      status: user.status,
    },
  });

  return users.findOne({ guild_id: guildId, discord_id: discordId });
}

async function auditSiteUser(input) {
  const logs = await siteAuditCollection();
  await logs.insertOne({
    action: input.action,
    guild_id: String(input.guildId || ''),
    target_discord_id: String(input.targetDiscordId || ''),
    actor_id: input.actorId ? String(input.actorId) : null,
    actor_name: input.actorName ? String(input.actorName) : null,
    metadata: input.metadata || {},
    created_at: new Date(),
  });
}

module.exports = {
  upsertSiteUser,
  auditSiteUser,
  normalizeSystemRole,
  normalizeStatus,
};
