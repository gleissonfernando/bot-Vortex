const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { AuditLogEvent, ChannelType, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { formatDate } = require('./dateTime');
const { logger } = require('./logger');
const { getLogChannelId } = require('./notifications');

const CONFIG_PATH = path.join(__dirname, '..', 'commands', 'config.json');
const AUDIT_LOOKBACK_MS = 12_000;
const AUDIT_RETRY_DELAYS_MS = [0, 250, 500, 900];
const DUPLICATE_PUNISH_MS = 45_000;
const LOOP_IGNORE_MS = 12_000;
const BULK_WINDOW_MS = 60_000;
const WEBHOOK_SPAM_WINDOW_MS = 10_000;
const WEBHOOK_SPAM_LIMIT = 5;
const CHANNEL_CREATE_LIMIT = 3;
const ROLE_CREATE_LIMIT = 3;
const VOICE_LOCK_REASON = 'Anti-Abuso Vortex: bloquear desconexao/movimento de usuarios em call';

const PUNISHMENT_LABELS = {
  log: 'Apenas Log',
  warn: 'Advertencia',
  kick: 'Kick',
  ban: 'Ban',
};

const PROTECTION_LABELS = {
  antiDisconnect: 'Anti Disconnect de Call',
  antiChannelDelete: 'Anti Exclusao de Canais',
  antiRoleDelete: 'Anti Exclusao de Cargos',
  antiCategoryDelete: 'Anti Exclusao de Categorias',
  antiChannelCreateSpam: 'Anti Criacao Excessiva de Canais',
  antiRoleCreateSpam: 'Anti Criacao Excessiva de Cargos',
  antiPermissionChange: 'Anti Alteracao de Permissoes',
  antiRoleChange: 'Anti Alteracao de Cargos',
  antiChannelUpdate: 'Anti Alteracao de Canais',
  antiWebhookAbuse: 'Anti Webhook Abuse',
  antiWebhookSpam: 'Anti Spam de Webhooks',
};

const auditCache = new Map();
const duplicatePunishments = new Map();
const loopIgnore = new Map();
const bulkActions = new Map();
const webhookMessages = new Map();

function readConfig() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return {};
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8') || '{}');
  } catch (error) {
    logger.error('Anti-Abuso: erro ao ler config.json:', error);
    return {};
  }
}

function normalizeIds(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((item) => String(item || '').trim())
    .filter((item) => /^\d{15,25}$/.test(item)))];
}

function getAntiAbuseConfig() {
  const raw = readConfig().ANTI_ABUSE || {};
  const protections = {};
  for (const key of Object.keys(PROTECTION_LABELS)) {
    const item = raw.protections?.[key] || {};
    protections[key] = {
      enabled: item.enabled === true,
      punishment: PUNISHMENT_LABELS[item.punishment] ? item.punishment : 'log',
    };
  }

  return {
    enabled: raw.enabled === true,
    shieldedDisconnect: raw.shieldedDisconnect === undefined
      ? protections.antiDisconnect?.enabled === true
      : raw.shieldedDisconnect === true,
    protections,
    whitelist: {
      users: [],
      roles: normalizeIds(raw.whitelist?.roles),
    },
    thresholds: {
      channelCreate: Math.max(1, Number(raw.thresholds?.channelCreate || CHANNEL_CREATE_LIMIT)),
      roleCreate: Math.max(1, Number(raw.thresholds?.roleCreate || ROLE_CREATE_LIMIT)),
      bulkWindowMs: Math.max(10_000, Number(raw.thresholds?.bulkWindowMs || BULK_WINDOW_MS)),
      webhookSpam: Math.max(2, Number(raw.thresholds?.webhookSpam || WEBHOOK_SPAM_LIMIT)),
      webhookWindowMs: Math.max(5_000, Number(raw.thresholds?.webhookWindowMs || WEBHOOK_SPAM_WINDOW_MS)),
    },
  };
}

function isEnabled(settings, protectionKey) {
  return Boolean(settings.enabled && settings.protections?.[protectionKey]?.enabled);
}

function isShieldedDisconnectEnabled(settings) {
  return Boolean(isEnabled(settings, 'antiDisconnect') && settings.shieldedDisconnect);
}

function getPunishment(settings, protectionKey) {
  return settings.protections?.[protectionKey]?.punishment || 'log';
}

function hasAdministratorPermission(role) {
  return role?.permissions?.has?.(PermissionFlagsBits.Administrator, false) === true;
}

function hasExplicitMoveMembersPermission(role) {
  return role?.permissions?.has?.(PermissionFlagsBits.MoveMembers, false) === true;
}

function getConfiguredAdminRoleIds() {
  const config = readConfig();
  return new Set(normalizeIds([
    ...(Array.isArray(config.VORTEX_ACCESS_ROLES?.admin) ? config.VORTEX_ACCESS_ROLES.admin : []),
    ...(Array.isArray(config.VORTEX_ROLE_LEVELS?.admin) ? config.VORTEX_ROLE_LEVELS.admin : []),
  ]));
}

function isProtectedAdminRole(role, configuredAdminRoleIds = getConfiguredAdminRoleIds()) {
  if (!role?.id) return false;
  return hasAdministratorPermission(role) || configuredAdminRoleIds.has(String(role.id));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanupMap(map, ttlMs) {
  const now = Date.now();
  for (const [key, value] of map.entries()) {
    const ts = typeof value === 'number' ? value : value?.ts || value?.createdAt || 0;
    if (!Number.isFinite(ts) || now - ts > ttlMs) map.delete(key);
  }
}

function cacheAuditEntry(entry, guild) {
  if (!entry || !guild?.id) return;
  const item = {
    entry,
    action: entry.action,
    guildId: guild.id,
    targetId: entry.target?.id ? String(entry.target.id) : null,
    executorId: entry.executor?.id ? String(entry.executor.id) : null,
    extraChannelId: entry.extra?.channel?.id || entry.extra?.channelId || null,
    createdTimestamp: entry.createdTimestamp || Date.now(),
    ts: Date.now(),
  };

  const keys = [
    `${guild.id}:${entry.action}:latest`,
    item.targetId ? `${guild.id}:${entry.action}:target:${item.targetId}` : null,
    item.extraChannelId ? `${guild.id}:${entry.action}:channel:${item.extraChannelId}` : null,
  ].filter(Boolean);

  for (const key of keys) auditCache.set(key, item);
  cleanupMap(auditCache, 60_000);
}

function matchesAuditEntry(item, { targetId = null, channelId = null, maxAgeMs = AUDIT_LOOKBACK_MS } = {}) {
  if (!item?.entry) return false;
  const created = item.createdTimestamp || 0;
  if (created && Date.now() - created > maxAgeMs) return false;
  if (targetId && String(item.targetId || '') !== String(targetId)) return false;
  if (channelId && String(item.extraChannelId || '') && String(item.extraChannelId) !== String(channelId)) return false;
  return true;
}

async function findRecentAuditEntry(guild, action, options = {}) {
  const cachedKeys = [
    options.targetId ? `${guild.id}:${action}:target:${options.targetId}` : null,
    options.channelId ? `${guild.id}:${action}:channel:${options.channelId}` : null,
    `${guild.id}:${action}:latest`,
  ].filter(Boolean);

  for (const key of cachedKeys) {
    const cached = auditCache.get(key);
    if (matchesAuditEntry(cached, options)) return cached.entry;
  }

  for (const delay of AUDIT_RETRY_DELAYS_MS) {
    await sleep(delay);
    const logs = await guild.fetchAuditLogs({ type: action, limit: 6 }).catch(() => null);
    const entry = logs?.entries?.find((item) => {
      cacheAuditEntry(item, guild);
      return matchesAuditEntry({
        entry: item,
        targetId: item.target?.id ? String(item.target.id) : null,
        extraChannelId: item.extra?.channel?.id || item.extra?.channelId || null,
        createdTimestamp: item.createdTimestamp || Date.now(),
      }, options);
    });
    if (entry) return entry;
  }

  return null;
}

function markLoop(guildId, action, targetId) {
  cleanupMap(loopIgnore, 60_000);
  loopIgnore.set(`${guildId}:${action}:${targetId}`, Date.now());
}

function isLoop(guildId, action, targetId) {
  cleanupMap(loopIgnore, 60_000);
  const ts = loopIgnore.get(`${guildId}:${action}:${targetId}`);
  return Number.isFinite(ts) && Date.now() - ts < LOOP_IGNORE_MS;
}

async function isWhitelisted(guild, executorId, settings) {
  if (!executorId || !guild) return true;
  const id = String(executorId);
  if (id === String(guild.client.user?.id || '')) return true;

  const member = await guild.members.fetch(id).catch(() => null);
  if (!member?.roles?.cache) return false;
  // Humanos so passam pelo Anti-Abuso quando possuem um cargo liberado na whitelist.
  return settings.whitelist.roles.some((roleId) => member.roles.cache.has(roleId));
}

function formatUser(userOrId) {
  const id = typeof userOrId === 'string' ? userOrId : userOrId?.id;
  const tag = typeof userOrId === 'string' ? userOrId : (userOrId?.tag || userOrId?.username || id);
  if (!id) return 'Desconhecido';
  return `<@${id}> (${tag} | ${id})`;
}

function formatTarget(target) {
  if (!target) return 'N/A';
  if (target.id && target.name) return `${target.name} (${target.id})`;
  if (target.id) return String(target.id);
  return String(target);
}

async function sendAntiAbuseLog(guild, {
  color = '#FF0055',
  title,
  protectionKey,
  executor = null,
  target = null,
  action = null,
  punishment = 'log',
  details = [],
}) {
  const fields = [
    { name: 'Usuario responsavel', value: formatUser(executor), inline: false },
    { name: 'Acao executada', value: action || PROTECTION_LABELS[protectionKey] || 'Acao protegida', inline: true },
    { name: 'Punicao aplicada', value: PUNISHMENT_LABELS[punishment] || punishment, inline: true },
    { name: 'Servidor', value: `${guild.name} (${guild.id})`, inline: false },
    { name: 'Alvo afetado', value: formatTarget(target), inline: false },
  ];

  if (Array.isArray(details) && details.length) {
    fields.push({ name: 'Detalhes', value: details.join('\n').slice(0, 1024), inline: false });
  }

  fields.push({ name: 'Data e hora', value: formatDate(new Date()), inline: true });

  const embed = new EmbedBuilder()
    .setColor(color)
    .setAuthor({
      name: 'VORTEX | ANTI-ABUSO',
      iconURL: guild.client.user?.displayAvatarURL?.() || undefined,
    })
    .setTitle(String(title || 'Acao protegida detectada').slice(0, 256))
    .addFields(fields)
    .setTimestamp()
    .setFooter({ text: 'Vortex Management System - Anti-Abuso' });

  const logChannelId = getLogChannelId();
  const logChannel = logChannelId
    ? await guild.client.channels.fetch(logChannelId).catch(() => null)
    : null;
  const fallback = guild.systemChannelId
    ? await guild.channels.fetch(guild.systemChannelId).catch(() => null)
    : null;
  const channel = logChannel?.guildId === guild.id ? logChannel : fallback;
  if (!channel?.isTextBased?.()) return false;
  return channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).then(() => true).catch(() => false);
}

async function applyPunishment(guild, executorId, protectionKey, targetId, settings) {
  const punishment = getPunishment(settings, protectionKey);
  if (!executorId || punishment === 'log') return { punishment, applied: 'log_only' };

  cleanupMap(duplicatePunishments, 120_000);
  const duplicateKey = `${guild.id}:${executorId}:${protectionKey}:${targetId || 'none'}`;
  const duplicateTs = duplicatePunishments.get(duplicateKey);
  if (Number.isFinite(duplicateTs) && Date.now() - duplicateTs < DUPLICATE_PUNISH_MS) {
    return { punishment, applied: 'duplicate_ignored' };
  }
  duplicatePunishments.set(duplicateKey, Date.now());

  const member = await guild.members.fetch(executorId).catch(() => null);
  if (!member) return { punishment, applied: 'member_not_found' };

  if (punishment === 'warn') {
    await member.send([
      'Voce executou uma acao bloqueada pelo Anti-Abuso Vortex.',
      `Protecao: ${PROTECTION_LABELS[protectionKey] || protectionKey}`,
      `Servidor: ${guild.name}`,
    ].join('\n')).catch(() => null);
    return { punishment, applied: 'warned' };
  }

  if (punishment === 'kick') {
    if (!member.kickable) return { punishment, applied: 'not_kickable' };
    await member.kick(`Anti-Abuso Vortex: ${PROTECTION_LABELS[protectionKey] || protectionKey}`).catch(() => null);
    return { punishment, applied: 'kicked' };
  }

  if (punishment === 'ban') {
    if (!member.bannable) return { punishment, applied: 'not_bannable' };
    await member.ban({ reason: `Anti-Abuso Vortex: ${PROTECTION_LABELS[protectionKey] || protectionKey}` }).catch(() => null);
    return { punishment, applied: 'banned' };
  }

  return { punishment, applied: 'unknown_punishment' };
}

async function removeVoiceControlRoles(guild, executorId) {
  if (!executorId) return { applied: 'executor_not_found', removed: 0 };
  const member = await guild.members.fetch(executorId).catch(() => null);
  if (!member?.roles?.cache) return { applied: 'member_not_found', removed: 0 };

  const configuredAdminRoleIds = getConfiguredAdminRoleIds();
  const removable = member.roles.cache.filter((role) => {
    if (role.id === guild.id || role.managed || !role.editable) return false;
    if (isProtectedAdminRole(role, configuredAdminRoleIds)) return false;
    return hasExplicitMoveMembersPermission(role);
  });

  if (!removable.size) return { applied: 'no_voice_control_roles', removed: 0 };

  await member.roles.remove(removable, 'Anti-Abuso Vortex: desconectar/mover usuarios em call e proibido para humanos');
  return { applied: `removed_voice_control_roles:${removable.size}`, removed: removable.size };
}

function isVoiceLockTarget(channel) {
  return channel?.type === ChannelType.GuildVoice
    || channel?.type === ChannelType.GuildStageVoice
    || channel?.type === ChannelType.GuildCategory;
}

async function lockAntiDisconnectChannel(channel) {
  if (!isVoiceLockTarget(channel) || !channel.guild || !channel.permissionOverwrites?.edit) {
    return { ok: false, updated: false, reason: 'not_voice_lock_target' };
  }
  const settings = getAntiAbuseConfig();
  if (!isShieldedDisconnectEnabled(settings)) {
    return { ok: false, updated: false, reason: 'shielded_disconnect_disabled' };
  }

  await channel.permissionOverwrites.edit(channel.guild.id, {
    MoveMembers: false,
  }, { reason: VOICE_LOCK_REASON });

  return { ok: true, updated: true, channelId: channel.id };
}

async function removeMoveMembersFromRoles(guild) {
  const roles = await guild.roles.fetch().catch(() => guild.roles.cache);
  const summary = { checked: 0, updated: 0, removedAdministrator: 0, skippedAdministrator: 0, removedMoveMembers: 0, failed: 0 };
  const configuredAdminRoleIds = getConfiguredAdminRoleIds();

  for (const role of roles.values()) {
    if (!role || role.id === guild.id || role.managed || !role.editable) continue;
    summary.checked += 1;

    const hasAdministrator = isProtectedAdminRole(role, configuredAdminRoleIds);
    const hasMoveMembers = hasExplicitMoveMembersPermission(role);
    if (!hasMoveMembers) continue;
    if (hasAdministrator) {
      summary.skippedAdministrator += 1;
      continue;
    }

    const permissions = role.permissions.remove(PermissionFlagsBits.MoveMembers);
    await role.edit({ permissions }, VOICE_LOCK_REASON).then(() => {
      summary.updated += 1;
      if (hasMoveMembers) summary.removedMoveMembers += 1;
    }).catch((error) => {
      summary.failed += 1;
      logger.warn(`Anti-Abuso: nao foi possivel remover MoveMembers do cargo ${role.name} (${role.id}): ${error.message}`);
    });
  }

  return summary;
}

async function syncAntiDisconnectLockdown(guild) {
  if (!guild) return false;
  const settings = getAntiAbuseConfig();
  if (!isShieldedDisconnectEnabled(settings)) return false;

  const summary = {
    channels: 0,
    channelUpdated: 0,
    channelFailed: 0,
    roles: await removeMoveMembersFromRoles(guild),
  };

  const fetched = await guild.channels.fetch().catch(() => null);
  const channels = fetched || guild.channels.cache;
  for (const channel of channels.values()) {
    if (!isVoiceLockTarget(channel)) continue;
    summary.channels += 1;
    await lockAntiDisconnectChannel(channel).then(() => {
      summary.channelUpdated += 1;
    }).catch((error) => {
      summary.channelFailed += 1;
      logger.warn(`Anti-Abuso: nao foi possivel travar MoveMembers em ${channel.name} (${channel.id}): ${error.message}`);
    });
  }

  logger.info(`Anti-Abuso: trava de disconnect sincronizada em ${guild.name} (${guild.id}) - ${summary.channelUpdated}/${summary.channels} canais, ${summary.roles.updated} cargo(s).`);
  return summary;
}

async function recordAntiAbuseHistory(guild, {
  executor,
  target,
  oldChannel,
  newChannel,
  action,
  restored,
  voiceRoleResult,
  punishmentResult,
}) {
  if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) return false;

  const doc = {
    guild_id: String(guild.id),
    actor_id: executor?.id ? String(executor.id) : null,
    target_id: target?.id ? String(target.id) : null,
    action: 'anti_abuse.voice_disconnect_blocked',
    payload: {
      author: executor?.id ? {
        id: String(executor.id),
        tag: executor.tag || executor.username || null,
      } : null,
      victim: target?.id ? {
        id: String(target.id),
        name: target.name || null,
      } : null,
      voice_action: action,
      channel: oldChannel ? {
        id: String(oldChannel.id),
        name: oldChannel.name || String(oldChannel.id),
      } : null,
      destination_channel: newChannel ? {
        id: String(newChannel.id),
        name: newChannel.name || String(newChannel.id),
      } : null,
      status: 'blocked_by_anti_abuse',
      restored: Boolean(restored),
      voice_roles: voiceRoleResult || null,
      punishment: punishmentResult || null,
    },
    created_at: new Date(),
  };

  await mongoose.connection.db.collection('audit_events').insertOne(doc);
  return true;
}

function overwriteSnapshot(channel) {
  return channel.permissionOverwrites?.cache?.map((overwrite) => ({
    id: overwrite.id,
    type: overwrite.type,
    allow: overwrite.allow.bitfield,
    deny: overwrite.deny.bitfield,
  })) || [];
}

function permissionBitfieldKey(value) {
  if (typeof value === 'bigint') return value.toString();
  if (value === null || value === undefined) return '0';
  return String(value);
}

function comparableOverwriteSnapshot(channel) {
  return overwriteSnapshot(channel)
    .map((overwrite) => ({
      ...overwrite,
      allow: permissionBitfieldKey(overwrite.allow),
      deny: permissionBitfieldKey(overwrite.deny),
    }))
    .sort((x, y) => String(x.id).localeCompare(String(y.id)));
}

function sameOverwrites(a, b) {
  return JSON.stringify(comparableOverwriteSnapshot(a))
    === JSON.stringify(comparableOverwriteSnapshot(b));
}

async function restoreChannel(channel) {
  const guild = channel.guild;
  const options = {
    name: channel.name,
    type: channel.type,
    permissionOverwrites: overwriteSnapshot(channel),
    reason: 'Anti-Abuso Vortex: restaurar canal apagado',
  };

  if (channel.parentId && guild.channels.cache.has(channel.parentId)) options.parent = channel.parentId;
  if (Number.isFinite(channel.position)) options.position = channel.position;

  if ('topic' in channel && channel.topic) options.topic = channel.topic;
  if ('nsfw' in channel) options.nsfw = Boolean(channel.nsfw);
  if ('rateLimitPerUser' in channel) options.rateLimitPerUser = Number(channel.rateLimitPerUser || 0);
  if ('bitrate' in channel && channel.bitrate) options.bitrate = channel.bitrate;
  if ('userLimit' in channel) options.userLimit = Number(channel.userLimit || 0);

  const restored = await guild.channels.create(options);
  if (Number.isFinite(channel.position)) {
    await restored.setPosition(channel.position, { reason: 'Anti-Abuso Vortex: restaurar posicao do canal' }).catch(() => null);
  }
  markLoop(guild.id, 'channelRestore', restored.id);
  return restored;
}

async function restoreChannelUpdate(oldChannel, newChannel, { restorePermissions = false, restoreChannel = false } = {}) {
  const patch = {};
  if (restoreChannel) {
    if ('name' in oldChannel && oldChannel.name !== newChannel.name) patch.name = oldChannel.name;
    if ('topic' in oldChannel && oldChannel.topic !== newChannel.topic) patch.topic = oldChannel.topic || null;
    if ('nsfw' in oldChannel && oldChannel.nsfw !== newChannel.nsfw) patch.nsfw = Boolean(oldChannel.nsfw);
    if ('rateLimitPerUser' in oldChannel && oldChannel.rateLimitPerUser !== newChannel.rateLimitPerUser) {
      patch.rateLimitPerUser = Number(oldChannel.rateLimitPerUser || 0);
    }
    if ('userLimit' in oldChannel && oldChannel.userLimit !== newChannel.userLimit) patch.userLimit = Number(oldChannel.userLimit || 0);
    if ('bitrate' in oldChannel && oldChannel.bitrate !== newChannel.bitrate) patch.bitrate = oldChannel.bitrate;
    if (oldChannel.parentId !== newChannel.parentId) patch.parent = oldChannel.parentId || null;
  }
  if (restorePermissions) patch.permissionOverwrites = overwriteSnapshot(oldChannel);
  if (!Object.keys(patch).length) return null;

  markLoop(newChannel.guild.id, 'channelUpdate', newChannel.id);
  return newChannel.edit(patch, 'Anti-Abuso Vortex: reverter alteracao protegida').catch(() => null);
}

async function restoreRole(role) {
  const created = await role.guild.roles.create({
    name: role.name,
    color: role.color,
    hoist: role.hoist,
    mentionable: role.mentionable,
    permissions: role.permissions.bitfield,
    reason: 'Anti-Abuso Vortex: restaurar cargo apagado',
  });
  if (Number.isFinite(role.position)) {
    await created.setPosition(role.position, { reason: 'Anti-Abuso Vortex: restaurar posicao do cargo' }).catch(() => null);
  }
  markLoop(role.guild.id, 'roleRestore', created.id);
  return created;
}

async function restoreRoleUpdate(oldRole, newRole) {
  const patch = {};
  if (oldRole.name !== newRole.name) patch.name = oldRole.name;
  if (oldRole.color !== newRole.color) patch.color = oldRole.color;
  if (oldRole.hoist !== newRole.hoist) patch.hoist = oldRole.hoist;
  if (oldRole.mentionable !== newRole.mentionable) patch.mentionable = oldRole.mentionable;
  if (oldRole.permissions.bitfield !== newRole.permissions.bitfield) patch.permissions = oldRole.permissions.bitfield;
  if (!Object.keys(patch).length) return null;

  markLoop(newRole.guild.id, 'roleUpdate', newRole.id);
  const restored = await newRole.edit(patch, 'Anti-Abuso Vortex: reverter alteracao de cargo').catch(() => null);
  if (Number.isFinite(oldRole.position) && oldRole.position !== newRole.position) {
    await newRole.setPosition(oldRole.position, { reason: 'Anti-Abuso Vortex: restaurar posicao do cargo' }).catch(() => null);
  }
  return restored;
}

function recordBulkAction(guildId, executorId, key, limit, windowMs) {
  cleanupMap(bulkActions, Math.max(windowMs * 2, 120_000));
  const mapKey = `${guildId}:${executorId}:${key}`;
  const now = Date.now();
  const current = (bulkActions.get(mapKey)?.items || []).filter((ts) => now - ts < windowMs);
  current.push(now);
  bulkActions.set(mapKey, { items: current, ts: now });
  return current.length > limit;
}

async function handleProtectedAction(guild, {
  protectionKey,
  executor,
  target,
  action,
  details = [],
  afterRestore = null,
}) {
  const settings = getAntiAbuseConfig();
  if (!isEnabled(settings, protectionKey)) return false;
  const executorId = executor?.id || executor;
  if (await isWhitelisted(guild, executorId, settings)) return false;

  const punishmentResult = await applyPunishment(guild, executorId, protectionKey, target?.id || target, settings);
  await sendAntiAbuseLog(guild, {
    color: '#FF0055',
    title: `${PROTECTION_LABELS[protectionKey] || 'Protecao'} acionado`,
    protectionKey,
    executor,
    target,
    action,
    punishment: punishmentResult.punishment,
    details: [
      ...details,
      `Resultado da punicao: ${punishmentResult.applied}`,
    ],
  });

  if (afterRestore) {
    await sendAntiAbuseLog(guild, {
      color: '#57F287',
      title: 'Restauracao concluida',
      protectionKey,
      executor: guild.client.user,
      target: afterRestore,
      action: 'Reversao automatica do Anti-Abuso',
      punishment: 'log',
      details: [`Alvo restaurado: ${formatTarget(afterRestore)}`],
    });
  }

  return true;
}

async function handleVoiceStateUpdate(oldState, newState) {
  if (!oldState?.guild || !oldState.channelId || oldState.channelId === newState.channelId) return false;
  const guild = oldState.guild;
  const settings = getAntiAbuseConfig();
  if (!isShieldedDisconnectEnabled(settings)) return false;
  const disconnected = !newState.channelId;
  const auditAction = disconnected ? AuditLogEvent.MemberDisconnect : AuditLogEvent.MemberMove;

  const entry = await findRecentAuditEntry(guild, auditAction, {
    channelId: disconnected ? oldState.channelId : newState.channelId,
    maxAgeMs: AUDIT_LOOKBACK_MS,
  }) || (!disconnected ? await findRecentAuditEntry(guild, auditAction, {
    channelId: oldState.channelId,
    maxAgeMs: AUDIT_LOOKBACK_MS,
  }) : null);
  const executor = entry?.executor || null;
  if (!executor?.id || executor.id === oldState.id || executor.id === guild.client.user?.id) return false;

  let restored = false;
  if (oldState.channel && oldState.member?.voice?.channelId !== oldState.channelId) {
    await oldState.member.voice.setChannel(oldState.channel, 'Anti-Abuso Vortex: reconectar usuario desconectado').then(() => {
      restored = true;
    }).catch(() => null);
  }

  const voiceRoleResult = await removeVoiceControlRoles(guild, executor.id).catch((error) => {
    logger.error('Anti-Abuso: erro ao remover cargos de controle de call:', error);
    return { applied: 'remove_voice_control_roles_failed', removed: 0 };
  });
  const punishmentResult = await applyPunishment(guild, executor.id, 'antiDisconnect', oldState.id, settings);
  await sendAntiAbuseLog(guild, {
    color: '#FF0055',
    title: 'Tentativa de desconectar usuario bloqueada',
    protectionKey: 'antiDisconnect',
    executor,
    target: { id: oldState.id, name: oldState.member?.displayName || oldState.id },
    action: `${disconnected ? 'Desconectou' : 'Moveu'} usuario da call ${oldState.channel?.name || oldState.channelId}`,
    punishment: punishmentResult.punishment,
    details: [
      `Canal anterior: ${oldState.channel ? `${oldState.channel.name} (${oldState.channel.id})` : oldState.channelId}`,
      `Canal atual: ${newState.channel ? `${newState.channel.name} (${newState.channel.id})` : 'desconectado'}`,
      `Reconectado automaticamente: ${restored ? 'sim' : 'nao'}`,
      `Cargos de mover/desconectar removidos: ${voiceRoleResult.removed ? 'sim' : 'nao'} (${voiceRoleResult.applied})`,
      `Resultado da punicao: ${punishmentResult.applied}`,
    ],
  });

  await recordAntiAbuseHistory(guild, {
    executor,
    target: { id: oldState.id, name: oldState.member?.displayName || oldState.id },
    oldChannel: oldState.channel,
    newChannel: newState.channel,
    action: disconnected ? 'disconnect' : 'move',
    restored,
    voiceRoleResult,
    punishmentResult,
  }).catch((error) => {
    logger.warn(`Anti-Abuso: nao foi possivel gravar historico da tentativa de disconnect: ${error.message}`);
  });

  if (restored) {
    await sendAntiAbuseLog(guild, {
      color: '#57F287',
      title: 'Usuario reconectado com sucesso',
      protectionKey: 'antiDisconnect',
      executor: guild.client.user,
      target: { id: oldState.id, name: oldState.member?.displayName || oldState.id },
      action: 'Reconexao automatica',
      punishment: 'log',
      details: [`Canal restaurado: ${oldState.channel?.name || oldState.channelId}`],
    });
  }

  return true;
}

async function handleChannelDelete(channel) {
  if (!channel?.guild) return false;
  const protectionKey = channel.type === ChannelType.GuildCategory ? 'antiCategoryDelete' : 'antiChannelDelete';
  const settings = getAntiAbuseConfig();
  if (!isEnabled(settings, protectionKey)) return false;

  const entry = await findRecentAuditEntry(channel.guild, AuditLogEvent.ChannelDelete, {
    targetId: channel.id,
    maxAgeMs: AUDIT_LOOKBACK_MS,
  });
  const executor = entry?.executor || null;
  if (!executor?.id) return false;
  if (await isWhitelisted(channel.guild, executor.id, settings)) return false;

  const restored = await restoreChannel(channel).catch((error) => {
    logger.error('Anti-Abuso: erro ao restaurar canal:', error);
    return null;
  });

  return handleProtectedAction(channel.guild, {
    protectionKey,
    executor,
    target: { id: channel.id, name: channel.name },
    action: `Apagou ${channel.type === ChannelType.GuildCategory ? 'categoria' : 'canal'}`,
    details: [
      `Tipo: ${channel.type}`,
      `Categoria anterior: ${channel.parentId || 'N/A'}`,
      `Posicao anterior: ${Number.isFinite(channel.position) ? channel.position : 'N/A'}`,
    ],
    afterRestore: restored,
  });
}

async function handleChannelCreate(channel) {
  if (!channel?.guild) return false;
  // A restauracao automatica cria um canal novo; isso nao pode silenciar deletes futuros.
  if (isLoop(channel.guild.id, 'channelRestore', channel.id)) return false;
  const settings = getAntiAbuseConfig();
  if (!isEnabled(settings, 'antiChannelCreateSpam')) return false;

  const entry = await findRecentAuditEntry(channel.guild, AuditLogEvent.ChannelCreate, {
    targetId: channel.id,
    maxAgeMs: AUDIT_LOOKBACK_MS,
  });
  const executor = entry?.executor || null;
  if (!executor?.id) return false;
  if (await isWhitelisted(channel.guild, executor.id, settings)) return false;

  const overLimit = recordBulkAction(
    channel.guild.id,
    executor.id,
    'channel_create',
    settings.thresholds.channelCreate,
    settings.thresholds.bulkWindowMs,
  );
  if (!overLimit) return false;

  await channel.delete('Anti-Abuso Vortex: criacao excessiva de canais').catch(() => null);
  return handleProtectedAction(channel.guild, {
    protectionKey: 'antiChannelCreateSpam',
    executor,
    target: { id: channel.id, name: channel.name },
    action: 'Criacao excessiva de canais',
    details: [`Limite: ${settings.thresholds.channelCreate} canal(is) em ${Math.round(settings.thresholds.bulkWindowMs / 1000)}s`],
  });
}

async function handleChannelUpdate(oldChannel, newChannel) {
  if (!newChannel?.guild) return false;
  if (isLoop(newChannel.guild.id, 'channelUpdate', newChannel.id)) return false;
  const settings = getAntiAbuseConfig();
  const permissionChanged = !sameOverwrites(oldChannel, newChannel);
  const protectionKey = permissionChanged ? 'antiPermissionChange' : 'antiChannelUpdate';
  if (!isEnabled(settings, protectionKey)) return false;

  const entry = await findRecentAuditEntry(newChannel.guild, permissionChanged ? AuditLogEvent.ChannelOverwriteUpdate : AuditLogEvent.ChannelUpdate, {
    targetId: newChannel.id,
    maxAgeMs: AUDIT_LOOKBACK_MS,
  }) || (permissionChanged
    ? await findRecentAuditEntry(newChannel.guild, AuditLogEvent.ChannelOverwriteCreate, { targetId: newChannel.id, maxAgeMs: AUDIT_LOOKBACK_MS })
      || await findRecentAuditEntry(newChannel.guild, AuditLogEvent.ChannelOverwriteDelete, { targetId: newChannel.id, maxAgeMs: AUDIT_LOOKBACK_MS })
    : null);
  const executor = entry?.executor || null;
  if (!executor?.id) return false;
  if (await isWhitelisted(newChannel.guild, executor.id, settings)) return false;

  const restored = await restoreChannelUpdate(oldChannel, newChannel, {
    restorePermissions: permissionChanged,
    restoreChannel: !permissionChanged,
  });

  return handleProtectedAction(newChannel.guild, {
    protectionKey,
    executor,
    target: { id: newChannel.id, name: newChannel.name },
    action: permissionChanged ? 'Alterou permissoes de canal' : 'Alterou configuracoes de canal',
    details: [`Reversao automatica: ${restored ? 'sim' : 'nao'}`],
    afterRestore: restored ? { id: newChannel.id, name: newChannel.name } : null,
  });
}

async function handleRoleDelete(role) {
  if (!role?.guild) return false;
  const settings = getAntiAbuseConfig();
  if (!isEnabled(settings, 'antiRoleDelete')) return false;

  const entry = await findRecentAuditEntry(role.guild, AuditLogEvent.RoleDelete, {
    targetId: role.id,
    maxAgeMs: AUDIT_LOOKBACK_MS,
  });
  const executor = entry?.executor || null;
  if (!executor?.id) return false;
  if (await isWhitelisted(role.guild, executor.id, settings)) return false;

  const restored = await restoreRole(role).catch((error) => {
    logger.error('Anti-Abuso: erro ao restaurar cargo:', error);
    return null;
  });

  return handleProtectedAction(role.guild, {
    protectionKey: 'antiRoleDelete',
    executor,
    target: { id: role.id, name: role.name },
    action: 'Apagou cargo',
    details: [`Permissoes restauradas: ${restored ? 'sim' : 'nao'}`],
    afterRestore: restored,
  });
}

async function handleRoleCreate(role) {
  if (!role?.guild) return false;
  // A restauracao automatica cria um cargo novo; deletes desse cargo ainda devem ser protegidos.
  if (isLoop(role.guild.id, 'roleRestore', role.id)) return false;
  const settings = getAntiAbuseConfig();
  if (!isEnabled(settings, 'antiRoleCreateSpam')) return false;

  const entry = await findRecentAuditEntry(role.guild, AuditLogEvent.RoleCreate, {
    targetId: role.id,
    maxAgeMs: AUDIT_LOOKBACK_MS,
  });
  const executor = entry?.executor || null;
  if (!executor?.id) return false;
  if (await isWhitelisted(role.guild, executor.id, settings)) return false;

  const overLimit = recordBulkAction(
    role.guild.id,
    executor.id,
    'role_create',
    settings.thresholds.roleCreate,
    settings.thresholds.bulkWindowMs,
  );
  if (!overLimit) return false;

  await role.delete('Anti-Abuso Vortex: criacao excessiva de cargos').catch(() => null);
  return handleProtectedAction(role.guild, {
    protectionKey: 'antiRoleCreateSpam',
    executor,
    target: { id: role.id, name: role.name },
    action: 'Criacao excessiva de cargos',
    details: [`Limite: ${settings.thresholds.roleCreate} cargo(s) em ${Math.round(settings.thresholds.bulkWindowMs / 1000)}s`],
  });
}

async function handleRoleUpdate(oldRole, newRole) {
  if (!newRole?.guild) return false;
  if (isLoop(newRole.guild.id, 'roleUpdate', newRole.id)) return false;
  const settings = getAntiAbuseConfig();
  if (!isEnabled(settings, 'antiRoleChange')) return false;

  const entry = await findRecentAuditEntry(newRole.guild, AuditLogEvent.RoleUpdate, {
    targetId: newRole.id,
    maxAgeMs: AUDIT_LOOKBACK_MS,
  });
  const executor = entry?.executor || null;
  if (!executor?.id) return false;
  if (await isWhitelisted(newRole.guild, executor.id, settings)) return false;

  const restored = await restoreRoleUpdate(oldRole, newRole);
  return handleProtectedAction(newRole.guild, {
    protectionKey: 'antiRoleChange',
    executor,
    target: { id: newRole.id, name: newRole.name },
    action: 'Alterou cargo',
    details: [`Reversao automatica: ${restored ? 'sim' : 'nao'}`],
    afterRestore: restored ? { id: newRole.id, name: newRole.name } : null,
  });
}

async function revertMemberRoleUpdate(guild, auditLogEntry) {
  const member = auditLogEntry.target?.id
    ? await guild.members.fetch(auditLogEntry.target.id).catch(() => null)
    : null;
  if (!member?.roles?.cache) return false;

  for (const change of auditLogEntry.changes || []) {
    if (change.key === '$add' && Array.isArray(change.new)) {
      const roleIds = change.new.map((item) => item.id).filter(Boolean);
      await member.roles.remove(roleIds, 'Anti-Abuso Vortex: reverter cargo adicionado').catch(() => null);
    }
    if (change.key === '$remove' && Array.isArray(change.new)) {
      const roleIds = change.new.map((item) => item.id).filter((roleId) => guild.roles.cache.has(roleId));
      await member.roles.add(roleIds, 'Anti-Abuso Vortex: reverter cargo removido').catch(() => null);
    }
  }

  return true;
}

async function handleAuditLogEntry(auditLogEntry, guild) {
  if (!auditLogEntry || !guild) return false;
  cacheAuditEntry(auditLogEntry, guild);

  const settings = getAntiAbuseConfig();
  const action = auditLogEntry.action;
  const executor = auditLogEntry.executor || null;
  if (!executor?.id) return false;
  if (await isWhitelisted(guild, executor.id, settings)) return false;

  if ([AuditLogEvent.WebhookCreate, AuditLogEvent.WebhookUpdate, AuditLogEvent.WebhookDelete].includes(action)) {
    if (!isEnabled(settings, 'antiWebhookAbuse')) return false;
    const target = auditLogEntry.target || { id: auditLogEntry.targetId || 'webhook', name: 'Webhook' };
    return handleProtectedAction(guild, {
      protectionKey: 'antiWebhookAbuse',
      executor,
      target,
      action: `Acao em webhook (${action})`,
      details: [`Webhook ID: ${target?.id || 'N/A'}`],
    });
  }

  if (action === AuditLogEvent.MemberRoleUpdate) {
    if (!isEnabled(settings, 'antiRoleChange')) return false;
    const reverted = await revertMemberRoleUpdate(guild, auditLogEntry);
    return handleProtectedAction(guild, {
      protectionKey: 'antiRoleChange',
      executor,
      target: auditLogEntry.target,
      action: 'Alterou cargos de membro',
      details: [`Reversao automatica: ${reverted ? 'sim' : 'nao'}`],
      afterRestore: reverted ? auditLogEntry.target : null,
    });
  }

  if ([AuditLogEvent.ChannelOverwriteCreate, AuditLogEvent.ChannelOverwriteUpdate, AuditLogEvent.ChannelOverwriteDelete].includes(action)) {
    if (!isEnabled(settings, 'antiPermissionChange')) return false;
    return handleProtectedAction(guild, {
      protectionKey: 'antiPermissionChange',
      executor,
      target: auditLogEntry.target,
      action: 'Alterou permissoes de canal',
      details: ['Evento detectado pelo Audit Log. A reversao completa ocorre quando o gateway entrega channelUpdate.'],
    });
  }

  return false;
}

async function handleWebhookMessage(message) {
  if (!message?.guild || !message.webhookId) return false;
  const settings = getAntiAbuseConfig();
  if (!isEnabled(settings, 'antiWebhookSpam')) return false;

  cleanupMap(webhookMessages, 60_000);
  const key = `${message.guild.id}:${message.webhookId}:${message.channelId}`;
  const now = Date.now();
  const current = (webhookMessages.get(key)?.items || []).filter((ts) => now - ts < settings.thresholds.webhookWindowMs);
  current.push(now);
  webhookMessages.set(key, { items: current, ts: now });
  if (current.length <= settings.thresholds.webhookSpam) return false;

  await message.delete().catch(() => null);
  const webhook = await message.fetchWebhook().catch(() => null);
  if (webhook?.delete) {
    await webhook.delete('Anti-Abuso Vortex: spam de webhook').catch(() => null);
  }

  await sendAntiAbuseLog(message.guild, {
    color: '#FF0055',
    title: 'Spam de webhook bloqueado',
    protectionKey: 'antiWebhookSpam',
    executor: webhook?.owner || { id: message.webhookId, username: 'Webhook' },
    target: { id: message.channelId, name: message.channel?.name || message.channelId },
    action: 'Spam de webhook',
    punishment: 'log',
    details: [
      `Webhook ID: ${message.webhookId}`,
      `Limite: ${settings.thresholds.webhookSpam} mensagens em ${Math.round(settings.thresholds.webhookWindowMs / 1000)}s`,
      `Webhook removido: ${webhook ? 'sim' : 'nao'}`,
    ],
  });

  return true;
}

module.exports = {
  PROTECTION_LABELS,
  PUNISHMENT_LABELS,
  getAntiAbuseConfig,
  handleAuditLogEntry,
  handleChannelCreate,
  handleChannelDelete,
  handleChannelUpdate,
  handleRoleCreate,
  handleRoleDelete,
  handleRoleUpdate,
  handleVoiceStateUpdate,
  handleWebhookMessage,
  lockAntiDisconnectChannel,
  syncAntiDisconnectLockdown,
};
