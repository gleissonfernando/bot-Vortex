const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');
const { formatDate, formatDuration } = require('./dateTime');
const { logger } = require('./logger');
const { deleteApprovedSetChannel, syncApprovedSetChannel } = require('./approvedSetChannels');
const { applyApprovedHierarchy, resetToPendingHierarchy } = require('./vortexHierarchy');
const { isPrimaryGuild, isPrimaryGuildChannel } = require('./guildScope');
const { isSilentLogUser } = require('./notifications');
const { refreshMongoJsonKeys } = require('./mongoJsonStore');
const { queueMemberSync, queuePointSnapshotSync } = require('./frequencyDashboardSync');
const { cleanupDeletedUserDatabaseData, cleanupLocalJsonUserData } = require('./userDataCleanup');

const PROFILES_PATH = path.join(__dirname, '..', 'commands', 'perfis.json');
const PROFILE_CONFIG_PATH = path.join(__dirname, '..', 'commands', 'perfisConfig.json');
const PANEL_CONFIG_PATH = path.join(__dirname, '..', 'commands', 'config.json');
const APPROVED_SET_CHANNELS_PATH = path.join(__dirname, '..', 'commands', 'approvedSetChannels.json');
const PROFILE_UPDATE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const PROFILE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const PROFILE_REMINDER_HOUR = 19;
const MISSING_PROFILE_ALERT_HOUR = 22;
const MISSING_PROFILE_ALERT_CHANNEL_ID = '1504613042351116288';
const PROFILE_TIME_ZONE = 'America/Sao_Paulo';
const PROFILE_ALERT_ROLE_IDS = [
  '1201235607549124639',
];
const MASTER_ROLE_ID = '1497703127074345040';
const DEFAULT_PROFILE_MANAGEMENT_CHANNEL_ID = '1499178753207701677';
const PROFILE_ACCESS_REVIEW_ENABLED = process.env.PROFILE_ACCESS_REVIEW_ENABLED !== 'false';
const PROFILE_SYNC_CHANNELS_ON_STARTUP = process.env.PROFILE_SYNC_CHANNELS_ON_STARTUP !== 'false';
let interval = null;

function queueFrequencyDashboardRefresh(guild) {
  if (!guild?.client) return;
  queueMemberSync(guild.client);
  queuePointSnapshotSync(guild.client);
}

async function syncApprovedHierarchyForMember(guild, userId, reason = 'Hierarquia Vortex: perfil aprovado sincronizado') {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member?.roles?.cache) {
    return { ok: false, reason: 'member_not_found' };
  }

  const result = await applyApprovedHierarchy(member, reason);
  if (result.removedPending.failed.length || result.addedApproved.failed.length) {
    logger.error('Falha parcial ao aplicar hierarquia aprovada:', {
      userId: member.id,
      removedPending: result.removedPending,
      addedApproved: result.addedApproved,
    });
  }

  return { ok: true, result };
}

function ensureFile() {
  if (!fs.existsSync(PROFILES_PATH)) {
    fs.writeFileSync(PROFILES_PATH, `${JSON.stringify({}, null, 2)}\n`, 'utf8');
  }
}

function readProfiles() {
  ensureFile();
  try {
    return JSON.parse(fs.readFileSync(PROFILES_PATH, 'utf8') || '{}');
  } catch (error) {
    logger.error('Erro ao ler perfis.json:', error);
    return {};
  }
}

function writeProfiles(data) {
  ensureFile();
  fs.writeFileSync(PROFILES_PATH, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function readApprovedSetChannels() {
  if (!fs.existsSync(APPROVED_SET_CHANNELS_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(APPROVED_SET_CHANNELS_PATH, 'utf8') || '{}');
  } catch (error) {
    logger.error('Erro ao ler approvedSetChannels.json para sincronizar perfis:', error);
    return {};
  }
}

function readProfileConfig() {
  if (!fs.existsSync(PROFILE_CONFIG_PATH)) {
    fs.writeFileSync(PROFILE_CONFIG_PATH, `${JSON.stringify({ billingDmEnabled: true, profileUpdateNotificationsEnabled: true, billingExemptUserIds: [] }, null, 2)}\n`, 'utf8');
  }
  try {
    return {
      billingDmEnabled: true,
      profileUpdateNotificationsEnabled: true,
      billingExemptUserIds: [],
      ...(JSON.parse(fs.readFileSync(PROFILE_CONFIG_PATH, 'utf8') || '{}')),
    };
  } catch {
    return { billingDmEnabled: true, profileUpdateNotificationsEnabled: true, billingExemptUserIds: [] };
  }
}

function writeProfileConfig(data) {
  fs.writeFileSync(PROFILE_CONFIG_PATH, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function readPanelConfig() {
  try {
    return JSON.parse(fs.readFileSync(PANEL_CONFIG_PATH, 'utf8') || '{}');
  } catch {
    return {};
  }
}

function getProfileManagementRoleIds() {
  const levels = readPanelConfig().VORTEX_ROLE_LEVELS || {};
  return [
    MASTER_ROLE_ID,
    ...(Array.isArray(levels.admin) ? levels.admin : []),
    ...(Array.isArray(levels.medio) ? levels.medio : []),
  ].map(String).filter(Boolean).filter((roleId, index, list) => list.indexOf(roleId) === index);
}

function getProfileManagementChannelId() {
  return DEFAULT_PROFILE_MANAGEMENT_CHANNEL_ID;
}

async function ensureProfileChannelAccess(guild, channelId, userId = null) {
  if (!channelId) return;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.permissionOverwrites?.edit) return;

  const botId = guild.client.user.id;
  await channel.permissionOverwrites.edit(botId, {
    ViewChannel: true,
    SendMessages: true,
    ReadMessageHistory: true,
    ManageChannels: true,
  }, { reason: 'Garantir acesso do bot Vortex ao canal privado do perfil' }).catch(() => null);

  if (userId) {
    await channel.permissionOverwrites.edit(userId, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
    }, { reason: 'Garantir acesso do dono ao canal privado do perfil' }).catch(() => null);
  }

  for (const roleId of getProfileManagementRoleIds()) {
    await channel.permissionOverwrites.edit(roleId, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
    }, { reason: 'Garantir acesso da gerência ao canal privado do perfil' }).catch(() => null);
  }
}

function setProfileBillingEnabled(enabled) {
  const next = { ...readProfileConfig(), billingDmEnabled: Boolean(enabled), updatedAt: new Date().toISOString() };
  writeProfileConfig(next);
  return next;
}

function toggleProfileBilling() {
  const current = readProfileConfig();
  return setProfileBillingEnabled(!current.billingDmEnabled);
}

function setProfileUpdateNotificationsEnabled(enabled) {
  const next = { ...readProfileConfig(), profileUpdateNotificationsEnabled: Boolean(enabled), updatedAt: new Date().toISOString() };
  writeProfileConfig(next);
  return next;
}

function toggleProfileUpdateNotifications() {
  const current = readProfileConfig();
  return setProfileUpdateNotificationsEnabled(!current.profileUpdateNotificationsEnabled);
}

function normalizeUserIds(userIds) {
  return [...new Set((Array.isArray(userIds) ? userIds : [])
    .map((userId) => String(userId || '').trim())
    .filter((userId) => /^\d{15,25}$/.test(userId)))];
}

function getBillingExemptUserIds() {
  return normalizeUserIds(readProfileConfig().billingExemptUserIds);
}

function addBillingExemptUserId(userId, updatedBy = null) {
  const normalizedUserId = String(userId || '').trim();
  if (!/^\d{15,25}$/.test(normalizedUserId)) {
    return { ok: false, message: 'ID de usuário inválido.' };
  }

  const config = readProfileConfig();
  const billingExemptUserIds = normalizeUserIds([
    ...normalizeUserIds(config.billingExemptUserIds),
    normalizedUserId,
  ]);
  const next = {
    ...config,
    billingExemptUserIds,
    billingExemptUpdatedAt: new Date().toISOString(),
    billingExemptUpdatedBy: updatedBy ? String(updatedBy) : null,
  };
  writeProfileConfig(next);
  return { ok: true, config: next, userId: normalizedUserId };
}

function getGuildProfiles(guildId) {
  const data = readProfiles();
  return data[guildId] || {};
}

function getUserProfile(guildId, userId) {
  const normalizedGuildId = String(guildId || '');
  const normalizedUserId = String(userId || '');
  const data = readProfiles();
  const guildProfiles = data[normalizedGuildId] || {};

  if (guildProfiles[normalizedUserId]) return guildProfiles[normalizedUserId];

  const nestedMatch = Object.values(guildProfiles).find((profile) => String(profile?.userId || '') === normalizedUserId);
  if (nestedMatch) return nestedMatch;

  const directProfile = data[normalizedUserId];
  if (directProfile?.userId || directProfile?.discordTag || directProfile?.registeredManually || directProfile?.approvedAt) {
    if (!directProfile.guildId || String(directProfile.guildId) === normalizedGuildId) return directProfile;
  }

  for (const [currentGuildId, profiles] of Object.entries(data)) {
    if (!profiles || typeof profiles !== 'object' || currentGuildId === normalizedUserId) continue;
    const profile = profiles[normalizedUserId]
      || Object.values(profiles).find((item) => String(item?.userId || '') === normalizedUserId);
    if (profile && (!profile.guildId || String(profile.guildId) === normalizedGuildId)) return profile;
  }

  return null;
}

function hasApprovedProfileData(profile) {
  return Boolean(profile && (
    profile.approvedAt
    || profile.registeredManually
    || profile.registeredBy
    || profile.createdAt
    || profile.nomeGame
    || profile.idGame
  ));
}

function normalizeProfileUrl(input) {
  const value = String(input || '').trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function isLikelyImageUrl(value) {
  const text = String(value || '').toLowerCase();
  return /\.(png|jpe?g|gif|webp|bmp|avif)(\?.*)?$/.test(text);
}

function isLikelyVideoUrl(value) {
  const text = String(value || '').toLowerCase();
  return /\.(mp4|webm|mov|m4v|avi|mkv)(\?.*)?$/.test(text);
}

function inferProfileMediaType(url, contentType = null) {
  const type = String(contentType || '').toLowerCase();
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (isLikelyImageUrl(url)) return 'image';
  if (isLikelyVideoUrl(url)) return 'video';
  return 'link';
}

function addPhotoLink(existingLinks, link, addedBy = null) {
  const links = Array.isArray(existingLinks) ? existingLinks.slice() : [];
  if (!link) return links;
  links.push({
    url: link,
    addedAt: new Date().toISOString(),
    addedBy: addedBy ? String(addedBy) : null,
  });
  return links.slice(-100);
}

function normalizeProfileLevel(input) {
  const value = String(input || '').trim();
  if (!/^\d{1,6}$/.test(value)) return null;
  return value;
}

function formatProfileDisplayName(profile = {}, fallback = 'N/A') {
  const value = String(profile.nomeGame || profile.displayName || fallback || '').trim();
  return value.replace(/\s*\|\s*\d{1,25}\s*$/g, '').trim() || value || fallback;
}

function getSaoPauloDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: PROFILE_TIME_ZONE,
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(date);

  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function getSaoPauloDateKey(date = new Date()) {
  const parts = getSaoPauloDateParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function canSendScheduledProfileReminder(date = new Date()) {
  const parts = getSaoPauloDateParts(date);
  const hour = Number(parts.hour);
  return String(parts.weekday || '').toLowerCase() === 'segunda-feira' && Number.isFinite(hour) && hour >= PROFILE_REMINDER_HOUR;
}

function canSendMissingProfileAlert(date = new Date()) {
  const hour = Number(getSaoPauloDateParts(date).hour);
  return Number.isFinite(hour) && hour >= MISSING_PROFILE_ALERT_HOUR;
}

async function getUserImages(user) {
  const fetched = await user.fetch?.(true).catch(() => user) || user;
  return {
    avatarUrl: fetched.displayAvatarURL?.({ dynamic: true, size: 1024 }) || null,
    bannerUrl: fetched.bannerURL?.({ dynamic: true, size: 1024 }) || null,
  };
}

async function registerApprovedProfile(guild, member, {
  tipo = null,
  nomeGame = null,
  idGame = null,
  numeroGame = null,
  nivelGame = null,
  callChannelId = null,
  approvedBy = null,
} = {}) {
  const data = readProfiles();
  if (!data[guild.id]) data[guild.id] = {};

  const now = new Date();
  const existing = data[guild.id][member.id] || {};
  const images = await getUserImages(member.user);
  const profile = {
    ...existing,
    guildId: guild.id,
    userId: member.id,
    discordTag: member.user.tag,
    displayName: member.displayName || member.user.username,
    tipo: tipo || existing.tipo || null,
    nomeGame: nomeGame || existing.nomeGame || null,
    idGame: idGame || existing.idGame || null,
    numeroGame: numeroGame || existing.numeroGame || null,
    nivelGame: nivelGame || existing.nivelGame || null,
    avatarUrl: images.avatarUrl || existing.avatarUrl || null,
    bannerUrl: images.bannerUrl || existing.bannerUrl || null,
    profileImageUrl: existing.profileImageUrl || images.avatarUrl || null,
    photoLinks: existing.photoLinks || [],
    callChannelId: callChannelId ? String(callChannelId) : existing.callChannelId || null,
    approvedBy: approvedBy ? String(approvedBy) : existing.approvedBy || null,
    approvedAt: existing.approvedAt || now.toISOString(),
    lastProfileUpdateAt: existing.lastProfileUpdateAt || now.toISOString(),
    lastAutoSyncAt: now.toISOString(),
    lastReminderAt: existing.lastReminderAt || null,
    updatedAt: now.toISOString(),
  };

  data[guild.id][member.id] = profile;
  writeProfiles(data);
  queueFrequencyDashboardRefresh(guild);
  await syncApprovedHierarchyForMember(guild, member.id, 'Hierarquia Vortex: perfil aprovado registrado').catch((error) => {
    logger.error('Erro ao aplicar hierarquia em perfil aprovado:', error);
  });
  await ensureProfileChannelAccess(guild, profile.callChannelId, member.id).catch(() => null);
  await syncApprovedSetChannel(guild, profile, { reason: 'registerApprovedProfile' }).catch(() => null);
  return profile;
}

async function updateProfileLink(guild, user, link, updatedBy, mediaType = null) {
  const profileUrl = normalizeProfileUrl(link);
  if (!profileUrl) {
    return { ok: false, message: 'Link inválido. Use um link http/https válido.' };
  }

  const data = readProfiles();
  if (!data[guild.id]) data[guild.id] = {};

  const now = new Date();
  const existing = getUserProfile(guild.id, user.id) || data[guild.id][user.id] || {};
  if (!hasApprovedProfileData(existing)) {
    return { ok: false, message: 'Este usuário ainda não possui perfil aprovado salvo pelo /set.' };
  }

  const images = await getUserImages(user);
  const profile = {
    ...existing,
    guildId: guild.id,
    userId: user.id,
    discordTag: user.tag,
    displayName: existing.displayName || user.username,
    avatarUrl: images.avatarUrl || existing.avatarUrl || null,
    bannerUrl: images.bannerUrl || existing.bannerUrl || null,
    profileImageUrl: profileUrl,
    profileMediaType: mediaType || inferProfileMediaType(profileUrl),
    photoLinks: addPhotoLink(existing.photoLinks, profileUrl, updatedBy || user.id),
    lastProfileUpdateAt: now.toISOString(),
    lastReminderAt: null,
    updatedBy: updatedBy ? String(updatedBy) : user.id,
    updatedAt: now.toISOString(),
  };

  data[guild.id][user.id] = profile;
  writeProfiles(data);
  await ensureProfileChannelAccess(guild, profile.callChannelId, user.id).catch(() => null);
  await syncApprovedSetChannel(guild, profile, { reason: 'updateProfileLink' }).catch(() => null);
  await sendProfileUpdateNotice(guild, profile, {
    userId: user.id,
    updatedBy,
    changes: [
      `Mídia do perfil atualizada: ${profileUrl}`,
      `Tipo de mídia: ${profile.profileMediaType || 'link'}`,
    ],
  }).catch(() => null);
  return { ok: true, profile };
}

async function updateProfileLevel(guild, user, nivelGame, updatedBy) {
  const normalizedLevel = normalizeProfileLevel(nivelGame);
  if (!normalizedLevel) {
    return { ok: false, message: 'Nível inválido. Use apenas números, exemplo: 12.' };
  }

  const data = readProfiles();
  if (!data[guild.id]) data[guild.id] = {};

  const now = new Date();
  const existing = getUserProfile(guild.id, user.id) || data[guild.id][user.id] || {};
  if (!hasApprovedProfileData(existing)) {
    return { ok: false, message: 'Este usuário ainda não possui perfil aprovado salvo pelo /set.' };
  }

  const images = await getUserImages(user);
  const profile = {
    ...existing,
    guildId: guild.id,
    userId: user.id,
    discordTag: user.tag,
    displayName: existing.displayName || user.username,
    avatarUrl: images.avatarUrl || existing.avatarUrl || null,
    bannerUrl: images.bannerUrl || existing.bannerUrl || null,
    nivelGame: normalizedLevel,
    lastProfileUpdateAt: now.toISOString(),
    lastReminderAt: null,
    updatedBy: updatedBy ? String(updatedBy) : user.id,
    updatedAt: now.toISOString(),
  };

  data[guild.id][user.id] = profile;
  writeProfiles(data);
  await syncApprovedSetChannel(guild, profile, { reason: 'updateProfileLevel' }).catch(() => null);
  await sendProfileUpdateNotice(guild, profile, {
    userId: user.id,
    updatedBy,
    changes: [
      `Nível em game atualizado para: ${normalizedLevel}`,
    ],
  }).catch(() => null);
  return { ok: true, profile };
}

async function registerManualProfile(guild, user, {
  name,
  callChannelId = null,
  photoLink = null,
  photoMediaType = null,
  nivelGame = null,
  registeredBy = null,
} = {}) {
  const profileUrl = photoLink ? normalizeProfileUrl(photoLink) : null;
  if (photoLink && !profileUrl) {
    return { ok: false, message: 'Link da mídia inválido. Use um link http/https.' };
  }
  const normalizedLevel = nivelGame ? normalizeProfileLevel(nivelGame) : null;
  if (nivelGame && !normalizedLevel) {
    return { ok: false, message: 'Nível inválido. Use apenas números, exemplo: 12.' };
  }

  const member = await guild.members.fetch(user.id).catch(() => null);
  const images = await getUserImages(user);
  const data = readProfiles();
  if (!data[guild.id]) data[guild.id] = {};

  const now = new Date();
  const existing = data[guild.id][user.id] || {};
  const profile = {
    ...existing,
    guildId: guild.id,
    userId: user.id,
    discordTag: user.tag,
    displayName: name || member?.displayName || user.username,
    nomeGame: name || existing.nomeGame || member?.displayName || user.username,
    idGame: existing.idGame || user.id,
    nivelGame: normalizedLevel || existing.nivelGame || null,
    avatarUrl: images.avatarUrl || existing.avatarUrl || null,
    bannerUrl: images.bannerUrl || existing.bannerUrl || null,
    profileImageUrl: profileUrl || existing.profileImageUrl || images.avatarUrl || null,
    profileMediaType: profileUrl ? (photoMediaType || inferProfileMediaType(profileUrl)) : (existing.profileMediaType || null),
    photoLinks: profileUrl ? addPhotoLink(existing.photoLinks, profileUrl, registeredBy) : (existing.photoLinks || []),
    callChannelId: callChannelId ? String(callChannelId) : existing.callChannelId || null,
    approvedAt: existing.approvedAt || now.toISOString(),
    registeredManually: true,
    registeredBy: registeredBy ? String(registeredBy) : existing.registeredBy || null,
    lastProfileUpdateAt: profileUrl ? now.toISOString() : existing.lastProfileUpdateAt || now.toISOString(),
    lastReminderAt: null,
    updatedAt: now.toISOString(),
  };

  data[guild.id][user.id] = profile;
  writeProfiles(data);
  queueFrequencyDashboardRefresh(guild);
  await syncApprovedHierarchyForMember(guild, user.id, 'Hierarquia Vortex: perfil manual registrado').catch((error) => {
    logger.error('Erro ao aplicar hierarquia em perfil manual:', error);
  });
  await syncApprovedSetChannel(guild, profile, { reason: 'registerManualProfile' }).catch(() => null);
  await sendProfileUpdateNotice(guild, profile, {
    userId: user.id,
    updatedBy: registeredBy,
    changes: [
      `Perfil cadastrado/atualizado por: ${registeredBy ? `<@${registeredBy}>` : 'sistema'}`,
      `Nome salvo: ${formatProfileDisplayName(profile)}`,
      `Nível em game: ${profile.nivelGame || 'N/A'}`,
      `Canal de texto vinculado: ${profile.callChannelId ? `<#${profile.callChannelId}>` : 'N/A'}`,
      profileUrl ? `Mídia salva: ${profileUrl}` : null,
    ].filter(Boolean),
  }).catch(() => null);
  return { ok: true, profile };
}

async function sendProfileUpdateNotice(guild, profile, { userId, updatedBy = null, changes = [] } = {}) {
  const config = readProfileConfig();
  if (!config.profileUpdateNotificationsEnabled) return false;
  if (isSilentLogUser(updatedBy) || isSilentLogUser(userId)) return false;
  if (!profile?.callChannelId) return false;
  const channel = await guild.channels.fetch(profile.callChannelId).catch(() => null);
  if (!channel?.isTextBased?.()) return false;

  const targetUserId = String(userId || profile.userId);
  const embed = new EmbedBuilder()
    .setColor('#00D9FF')
    .setTitle('Perfil atualizado')
    .setDescription([
      `Perfil de <@${targetUserId}> atualizado no sistema Vortex.`,
      updatedBy ? `Atualizado por: <@${updatedBy}>` : null,
      '',
      changes.length ? changes.map((item) => `• ${item}`).join('\n') : 'Dados do perfil foram atualizados.',
      '',
      `Data/hora real: ${formatDate(new Date())}`,
    ].filter(Boolean).join('\n'))
    .setTimestamp();

  await channel.send({
    content: `<@${targetUserId}>`,
    embeds: [embed],
    allowedMentions: { users: [targetUserId, updatedBy ? String(updatedBy) : null].filter(Boolean) },
  });
  return true;
}

function normalizeRemovalReason(reason) {
  const value = String(reason || '').trim();
  if (!value) return 'Cadastro removido pela equipe Vortex.';
  return value.length > 900 ? `${value.slice(0, 897)}...` : value;
}

async function sendProfileRemovalDm(guild, user, profile, {
  removedBy = null,
  reason = null,
  approvedRoleRemoved = false,
  pendingRoleAdded = false,
  channelDeleted = false,
  hadProfile = false,
} = {}) {
  if (!user?.send) return { sent: false, reason: 'missing_user' };

  const profileName = profile ? formatProfileDisplayName(profile, user.username) : null;
  const embed = new EmbedBuilder()
    .setColor('#FF0055')
    .setTitle('Cadastro removido')
    .setDescription([
      `Seu cadastro no sistema Vortex do servidor **${guild.name}** foi removido${hadProfile ? '' : ' ou nao foi encontrado'}.`,
      '',
      'A partir de agora voce nao possui mais cadastro aprovado no sistema.',
      profileName ? `Nome que estava salvo: **${profileName}**` : null,
      '',
      approvedRoleRemoved ? 'O cargo de aprovado foi removido.' : 'O cargo de aprovado foi revisado.',
      pendingRoleAdded ? 'O cargo de liberacao/pendente foi aplicado.' : 'O cargo de liberacao/pendente foi revisado.',
      channelDeleted ? 'O canal/call vinculado ao perfil foi removido.' : null,
      '',
      `Motivo: ${normalizeRemovalReason(reason)}`,
      removedBy ? `Removido por: <@${removedBy}>` : null,
      '',
      'Para recuperar o acesso, solicite um novo /set ou procure a gerencia.',
      `Data/hora real: ${formatDate(new Date())}`,
    ].filter(Boolean).join('\n'))
    .setTimestamp();

  return user.send({
    embeds: [embed],
    allowedMentions: { parse: [], users: removedBy ? [String(removedBy)] : [] },
  }).then(() => ({ sent: true })).catch((error) => ({
    sent: false,
    reason: error?.message || 'send_failed',
  }));
}

function buildProfileEmbed({ guild, user, member, profile }) {
  const now = Date.now();
  const lastUpdate = profile?.lastProfileUpdateAt ? new Date(profile.lastProfileUpdateAt).getTime() : 0;
  const elapsed = lastUpdate ? now - lastUpdate : 0;
  const nextUpdateAt = lastUpdate ? new Date(lastUpdate + PROFILE_UPDATE_INTERVAL_MS) : null;
  const mediaUrl = profile?.profileImageUrl || user.displayAvatarURL({ dynamic: true, size: 1024 });
  const mediaType = String(profile?.profileMediaType || (isLikelyImageUrl(mediaUrl) ? 'image' : isLikelyVideoUrl(mediaUrl) ? 'video' : 'link')).toLowerCase();
  const canPreviewImage = mediaType === 'image';
  const photoLinks = Array.isArray(profile?.photoLinks) ? profile.photoLinks : [];
  const latestPhotos = photoLinks.slice(-5).reverse().map((item, index) => `${index + 1}. ${item.url}`).join('\n') || 'N/A';
  const displayName = formatProfileDisplayName(profile, member?.displayName || user.username);

  const embed = new EmbedBuilder()
    .setColor('#7000FF')
    .setAuthor({ name: 'VORTEX | Perfil', iconURL: guild.client.user?.displayAvatarURL?.() || undefined })
    .setTitle(`Perfil de ${displayName}`)
    .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 256 }))
    .addFields(
      { name: 'Usuário', value: `<@${user.id}>`, inline: true },
      { name: 'Status', value: profile ? (profile.registeredManually ? 'Cadastrado manualmente' : 'Aprovado no /set') : 'Sem perfil aprovado salvo', inline: true },
      { name: 'Nome em game', value: displayName, inline: true },
      { name: 'Nível em game', value: profile?.nivelGame || 'N/A', inline: true },
      { name: 'Canal de texto', value: profile?.callChannelId ? `<#${profile.callChannelId}>` : 'N/A', inline: true },
      { name: 'Tipo', value: profile?.tipo || 'N/A', inline: true },
      { name: 'Cargo mais alto', value: member?.roles?.highest ? `<@&${member.roles.highest.id}>` : 'N/A', inline: true },
      { name: 'Links de mídias salvos', value: latestPhotos.slice(0, 1024), inline: false },
      { name: 'Última atualização', value: profile?.lastProfileUpdateAt ? formatDate(profile.lastProfileUpdateAt) : 'N/A', inline: false },
      { name: 'Tempo desde atualização', value: lastUpdate ? formatDuration(elapsed) : 'N/A', inline: true },
      { name: 'Próxima atualização', value: nextUpdateAt ? formatDate(nextUpdateAt) : 'N/A', inline: true }
    )
    .setFooter({ text: `Vortex - Perfil • ${formatDate(new Date())}` })
    .setTimestamp();

  if (canPreviewImage && mediaUrl) {
    embed.setImage(mediaUrl);
  } else if (mediaUrl) {
    embed.addFields({
      name: 'Mídia do perfil',
      value: `[Abrir mídia](${mediaUrl})`,
      inline: false,
    });
  }
  return embed;
}

async function sendProfileReminder(client, guild, profile, thresholdMs = PROFILE_UPDATE_INTERVAL_MS, force = false) {
  const config = readProfileConfig();
  if (!config.billingDmEnabled) return { sent: false, reason: 'billing_disabled' };
  if (!profile?.userId || !hasApprovedProfileData(profile)) return { sent: false, reason: 'not_registered' };
  if (!force && !canSendScheduledProfileReminder(new Date())) {
    return { sent: false, reason: 'not_monday_or_before_19h' };
  }

  const now = Date.now();
  const lastUpdateMs = profile.lastProfileUpdateAt ? new Date(profile.lastProfileUpdateAt).getTime() : 0;
  const lastReminderMs = profile.lastReminderAt ? new Date(profile.lastReminderAt).getTime() : 0;
  const todayKey = getSaoPauloDateKey(new Date());
  const lastReminderDateKey = lastReminderMs ? getSaoPauloDateKey(new Date(lastReminderMs)) : null;
  const effectiveThresholdMs = Math.max(Number(thresholdMs) || 0, PROFILE_UPDATE_INTERVAL_MS);
  if (!lastUpdateMs) return { sent: false, reason: 'missing_update' };
  if (now - lastUpdateMs < effectiveThresholdMs) return { sent: false, reason: 'not_due' };
  if (!force && lastReminderDateKey === todayKey) {
    return { sent: false, reason: 'already_reminded_this_monday' };
  }

  const user = await client.users.fetch(profile.userId).catch(() => null);
  if (!user) return { sent: false, reason: 'missing_user' };

  const embed = new EmbedBuilder()
    .setColor('#FEE75C')
    .setTitle('Perfil precisa ser atualizado')
    .setDescription([
      `O usuário <@${profile.userId}> precisa atualizar o perfil do /set.`,
      '',
      `**Última atualização:** ${formatDate(profile.lastProfileUpdateAt)}`,
      `**Tempo sem atualizar:** ${formatDuration(now - lastUpdateMs)}`,
      `**Horário do aviso:** ${formatDate(new Date())}`,
      '**Cobrança automática:** toda segunda-feira a partir das 19:00',
      '',
      'Use `/perfil link:<link da mídia> nivel:<numero>` para atualizar.',
      'O prazo para atualizar o nível após o /set é de 1 semana.',
    ].join('\n'))
    .setTimestamp();

  await user.send({ embeds: [embed] }).catch(() => null);

  if (profile.callChannelId) {
    const userChannel = await client.channels.fetch(profile.callChannelId).catch(() => null);
    if (isPrimaryGuildChannel(userChannel) && userChannel?.isTextBased?.()) {
      await userChannel.send({
        content: `<@${profile.userId}> atualize seu /perfil com foto e nível.`,
        embeds: [embed],
        allowedMentions: { users: [profile.userId] },
      }).catch(() => null);
    }
  }

  const data = readProfiles();
  if (data[profile.guildId]?.[profile.userId]) {
    data[profile.guildId][profile.userId].lastReminderAt = new Date().toISOString();
    data[profile.guildId][profile.userId].updatedAt = new Date().toISOString();
    writeProfiles(data);
  }

  return { sent: true };
}

async function sendProfileManagementSummary(client, guild, dueProfiles) {
  if (!dueProfiles.length) return false;
  if (!isPrimaryGuild(guild.id)) return false;

  const channel = await client.channels.fetch(getProfileManagementChannelId()).catch(() => null);
  if (!isPrimaryGuildChannel(channel)) return false;
  if (!channel?.isTextBased?.()) return false;

  const roleMentions = PROFILE_ALERT_ROLE_IDS.map((id) => `<@&${id}>`).join(' ');
  const chunks = chunkArray(dueProfiles, 40);

  for (const [chunkIndex, profiles] of chunks.entries()) {
    const userMentions = profiles.map((profile) => `<@${profile.userId}>`);
    const lines = userMentions.map((mention, index) => `${chunkIndex * 40 + index + 1}. ${mention}`);

    await channel.send({
      content: `${roleMentions} ${userMentions.join(' ')}`,
      embeds: [
        new EmbedBuilder()
          .setColor('#FEE75C')
          .setTitle('Perfis para atualizar')
          .setDescription([
            'Os usuários abaixo não atualizaram o /perfil dentro de 7 dias.',
            '',
            lines.join('\n'),
            '',
            'Cobrança automática: toda segunda-feira a partir das 19:00.',
            `Horário da cobrança: ${formatDate(new Date())}`,
          ].join('\n'))
          .setTimestamp(),
      ],
      allowedMentions: {
        users: profiles.map((profile) => String(profile.userId)),
        roles: PROFILE_ALERT_ROLE_IDS,
      },
    }).catch(() => null);
  }

  return true;
}

async function checkProfileUpdates(client, { guildId = null, userId = null, thresholdMs = PROFILE_UPDATE_INTERVAL_MS, force = false } = {}) {
  const data = readProfiles();
  const results = [];
  const exemptUserIds = new Set(getBillingExemptUserIds());

  for (const [currentGuildId, guildProfiles] of Object.entries(data)) {
    if (guildId && currentGuildId !== String(guildId)) continue;
    if (!isPrimaryGuild(currentGuildId)) continue;
    const guild = await client.guilds.fetch(currentGuildId).catch(() => null);
    if (!guild) continue;
    const dueProfiles = [];

    for (const profile of Object.values(guildProfiles || {})) {
      if (userId && profile.userId !== String(userId)) continue;
      if (!profile?.userId || !hasApprovedProfileData(profile)) {
        results.push({ userId: profile?.userId || userId || null, sent: false, reason: 'not_registered' });
        continue;
      }
      if (exemptUserIds.has(String(profile.userId))) {
        results.push({ userId: profile.userId, sent: false, reason: 'billing_exempt' });
        continue;
      }
      const result = await sendProfileReminder(client, guild, profile, thresholdMs, force).catch((error) => {
        logger.error('Erro ao enviar lembrete de perfil:', error);
        return { sent: false, reason: error.message };
      });
      results.push({ userId: profile.userId, ...result });
      if (result.sent) {
        dueProfiles.push(profile);
      }
    }

    await sendProfileManagementSummary(client, guild, dueProfiles).catch((error) => {
      logger.error('Erro ao enviar resumo de cobrança de perfil:', error);
    });
  }

  return results;
}

async function sendMissingProfileDailyAlert(client, { force = false } = {}) {
  return { sent: false, reason: 'missing_profile_messages_disabled' };
}

async function ensureAllProfileChannelAccess(client) {
  const data = readProfiles();
  for (const [guildId, guildProfiles] of Object.entries(data)) {
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) continue;

    for (const profile of Object.values(guildProfiles || {})) {
      if (profile?.userId) {
        await syncApprovedHierarchyForMember(guild, profile.userId, 'Hierarquia Vortex: sincronizacao periodica de perfil').catch((error) => {
          logger.error('Erro ao revisar hierarquia aprovada do perfil:', error);
        });
      }
      if (!profile?.callChannelId) continue;
      await ensureProfileChannelAccess(guild, profile.callChannelId, profile.userId).catch((error) => {
        logger.error('Erro ao garantir acesso ao canal privado do perfil:', error);
      });
      await syncApprovedSetChannel(guild, profile, { reason: 'startup' }).catch((error) => {
        logger.error('Erro ao sincronizar nome da call do perfil no startup:', error);
      });
    }
  }
}

async function syncProfilesFromApprovedSetChannels(client = null, { dryRun = false, syncChannels = false, refreshFromMongo = false } = {}) {
  if (refreshFromMongo) {
    await refreshMongoJsonKeys([
      'commands/perfis.json',
      'commands/approvedSetChannels.json',
    ]).catch((error) => {
      logger.error('Erro ao atualizar perfis pelo Mongo:', error);
    });
  }

  const profiles = readProfiles();
  const approvedChannels = readApprovedSetChannels();
  const now = new Date().toISOString();
  const results = {
    created: [],
    updated: [],
    unchanged: [],
    skipped: [],
  };

  for (const [guildId, records] of Object.entries(approvedChannels)) {
    if (!records || typeof records !== 'object') continue;
    if (!profiles[guildId]) profiles[guildId] = {};
    const guild = client ? await client.guilds.fetch(guildId).catch(() => null) : null;

    for (const [recordUserId, record] of Object.entries(records)) {
      const userId = String(record?.userId || recordUserId || '').trim();
      const callChannelId = String(record?.channelId || record?.callChannelId || '').trim();
      if (!/^\d{15,25}$/.test(userId) || !callChannelId) {
        results.skipped.push({ guildId, userId: userId || recordUserId, reason: 'invalid_record' });
        continue;
      }

      const existing = profiles[guildId][userId] || {};
      const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;
      const user = member?.user || null;
      const images = user ? await getUserImages(user).catch(() => ({})) : {};
      const nomeGame = record.nomeGame || existing.nomeGame || member?.displayName || user?.username || existing.displayName || 'usuario';
      const nivelGame = record.nivelGame || existing.nivelGame || null;
      const nextProfile = {
        ...existing,
        guildId,
        userId,
        discordTag: existing.discordTag || user?.tag || null,
        displayName: existing.displayName || member?.displayName || user?.username || nomeGame,
        tipo: existing.tipo || null,
        nomeGame,
        idGame: existing.idGame || null,
        numeroGame: existing.numeroGame || null,
        nivelGame,
        avatarUrl: existing.avatarUrl || images.avatarUrl || null,
        bannerUrl: existing.bannerUrl || images.bannerUrl || null,
        profileImageUrl: existing.profileImageUrl || images.avatarUrl || null,
        profileMediaType: existing.profileMediaType || null,
        photoLinks: existing.photoLinks || [],
        callChannelId,
        approvedBy: existing.approvedBy || record.createdBy || null,
        approvedAt: existing.approvedAt || record.createdAt || record.updatedAt || now,
        registeredManually: existing.registeredManually !== undefined ? existing.registeredManually : true,
        registeredBy: existing.registeredBy || record.createdBy || 'sistema',
        lastProfileUpdateAt: existing.lastProfileUpdateAt || record.updatedAt || now,
        lastReminderAt: existing.lastReminderAt || null,
        updatedAt: now,
      };

      const existed = Boolean(profiles[guildId][userId]);
      const changed = !existed
        || String(existing.callChannelId || '') !== callChannelId
        || String(existing.nivelGame || '') !== String(nivelGame || '')
        || String(existing.nomeGame || '') !== String(nomeGame || '');

      if (!changed) {
        if (!dryRun && guild && member) {
          await syncApprovedHierarchyForMember(guild, userId, 'Hierarquia Vortex: perfil aprovado ja sincronizado').catch((error) => {
            logger.error('Erro ao revisar hierarquia de perfil aprovado:', error);
          });
        }
        results.unchanged.push({ guildId, userId, callChannelId });
        continue;
      }

      if (!dryRun) {
        profiles[guildId][userId] = nextProfile;
        if (guild && member) {
          await syncApprovedHierarchyForMember(guild, userId, 'Hierarquia Vortex: perfil aprovado sincronizado').catch((error) => {
            logger.error('Erro ao aplicar hierarquia durante sync de perfis:', error);
          });
        }
        if (guild && syncChannels) {
          await ensureProfileChannelAccess(guild, callChannelId, userId).catch((error) => {
            logger.error('Erro ao garantir acesso ao canal privado durante sync de perfis:', error);
          });
          await syncApprovedSetChannel(guild, nextProfile, { reason: 'syncProfilesFromApprovedSetChannels' }).catch((error) => {
            logger.error('Erro ao sincronizar canal durante sync de perfis:', error);
          });
        }
      }

      results[existed ? 'updated' : 'created'].push({ guildId, userId, callChannelId, nomeGame, nivelGame });
    }
  }

  if (!dryRun && (results.created.length || results.updated.length)) {
    writeProfiles(profiles);
  }

  return results;
}

function removeUserProfileData(guildId, userId) {
  const normalizedUserId = String(userId || '').trim();
  const data = readProfiles();
  const profile = data[guildId]?.[normalizedUserId] || null;
  if (!profile) return { ok: true, deleted: false, profile: null };

  delete data[guildId][normalizedUserId];
  if (Object.keys(data[guildId]).length === 0) delete data[guildId];
  writeProfiles(data);

  return { ok: true, deleted: true, profile };
}

async function deleteUserProfile(guild, userId, reason = 'Usuário saiu do servidor', options = {}) {
  const data = readProfiles();
  const normalizedGuildId = String(guild.id);
  const normalizedUserId = String(userId || '').trim();
  const profile = getUserProfile(normalizedGuildId, normalizedUserId);
  const member = await guild.members.fetch(normalizedUserId).catch(() => null);
  let approvedRoleRemoved = false;
  let pendingRoleAdded = false;
  if (member?.roles?.cache) {
    await resetToPendingHierarchy(member, reason).then((result) => {
      approvedRoleRemoved = result.removedApproved.removed.length > 0;
      pendingRoleAdded = result.addedPending.added.length > 0;
      if (result.removedApproved.failed.length || result.addedPending.failed.length) {
        logger.error('Falha parcial ao sincronizar hierarquia do perfil:', result);
      }
    }).catch((error) => {
      logger.error('Erro ao sincronizar hierarquia do perfil:', error);
    });
  }

  let channelDeleted = false;
  const approvedChannelResult = await deleteApprovedSetChannel(guild, normalizedUserId, reason).catch((error) => {
    logger.error('Erro ao remover registro/canal aprovado do perfil:', error);
    return null;
  });
  if (approvedChannelResult?.deleted) channelDeleted = true;

  if (profile?.callChannelId) {
    const channel = await guild.channels.fetch(profile.callChannelId).catch(() => null);
    if (channel) {
      await channel.delete(reason).catch((error) => {
        logger.error('Erro ao deletar canal/call do perfil:', error);
      });
      channelDeleted = true;
    }
  }

  let deletedCount = 0;
  for (const [currentGuildId, profiles] of Object.entries(data)) {
    if (!profiles || typeof profiles !== 'object') continue;

    if (currentGuildId === normalizedUserId) {
      const isSameGuild = !profiles.guildId || String(profiles.guildId) === normalizedGuildId;
      const isSameUser = String(profiles.userId || currentGuildId) === normalizedUserId;
      if (isSameGuild && isSameUser) {
        delete data[currentGuildId];
        deletedCount += 1;
      }
      continue;
    }

    for (const [profileKey, currentProfile] of Object.entries(profiles)) {
      const isSameUser = profileKey === normalizedUserId || String(currentProfile?.userId || '') === normalizedUserId;
      const isSameGuild = currentGuildId === normalizedGuildId || String(currentProfile?.guildId || '') === normalizedGuildId;
      if (isSameUser && isSameGuild) {
        delete profiles[profileKey];
        deletedCount += 1;
      }
    }

    if (currentGuildId !== normalizedUserId && Object.keys(profiles).length === 0) {
      delete data[currentGuildId];
    }
  }

  writeProfiles(data);
  const localCleanup = await cleanupLocalJsonUserData(normalizedGuildId, normalizedUserId).catch((error) => {
    logger.error('Erro ao limpar dados locais do usuario removido:', error);
    return { cleanedFiles: 0, files: [], error: error.message };
  });
  const databaseCleanup = await cleanupDeletedUserDatabaseData(normalizedGuildId, normalizedUserId).catch((error) => {
    logger.error('Erro ao limpar dados do usuario removido no banco:', error);
    return { ok: false, reason: error.message };
  });
  queueFrequencyDashboardRefresh(guild);

  let dmSent = false;
  let dmError = null;
  const notifyUser = options.notifyUser === true || options.notifyUser === 'force';
  const targetUser = member?.user || (options.notifyUser === 'force'
    ? await guild.client.users.fetch(normalizedUserId).catch(() => null)
    : null);
  if (notifyUser && targetUser) {
    const dmResult = await sendProfileRemovalDm(guild, targetUser, profile, {
      removedBy: options.removedBy || options.deletedBy || null,
      reason,
      approvedRoleRemoved,
      pendingRoleAdded,
      channelDeleted,
      hadProfile: Boolean(profile),
    });
    dmSent = Boolean(dmResult.sent);
    dmError = dmResult.sent ? null : dmResult.reason;
  } else if (notifyUser) {
    dmError = 'usuario_nao_esta_no_servidor';
  }

  return {
    ok: true,
    deleted: deletedCount > 0,
    deletedCount,
    channelDeleted,
    approvedRoleRemoved,
    pendingRoleAdded,
    dmSent,
    dmError,
    hadProfile: Boolean(profile),
    localCleanup,
    databaseCleanup,
  };
}

function parseTestPeriod(amountInput, unitInput) {
  const amount = Number(amountInput);
  const unit = String(unitInput || '').trim().toLowerCase();
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (['minuto', 'minutos', 'm'].includes(unit)) return amount * 60 * 1000;
  if (['hora', 'horas', 'h'].includes(unit)) return amount * 60 * 60 * 1000;
  if (['dia', 'dias', 'd'].includes(unit)) return amount * 24 * 60 * 60 * 1000;
  return null;
}

function initProfileManager(client) {
  if (interval) clearInterval(interval);
  syncProfilesFromApprovedSetChannels(client, { syncChannels: PROFILE_SYNC_CHANNELS_ON_STARTUP }).catch((error) => logger.error('Erro ao sincronizar perfis pelos canais aprovados:', error));
  if (PROFILE_ACCESS_REVIEW_ENABLED) {
    ensureAllProfileChannelAccess(client).catch((error) => logger.error('Erro ao revisar canais privados de perfil:', error));
  }
  checkProfileUpdates(client).catch((error) => logger.error('Erro ao checar perfis no início:', error));
  sendMissingProfileDailyAlert(client).catch((error) => logger.error('Erro ao enviar alerta diario de cadastros:', error));
  interval = setInterval(() => {
    if (PROFILE_ACCESS_REVIEW_ENABLED) {
      ensureAllProfileChannelAccess(client).catch((error) => logger.error('Erro ao revisar canais privados de perfil:', error));
    }
    checkProfileUpdates(client).catch((error) => logger.error('Erro ao checar perfis:', error));
    sendMissingProfileDailyAlert(client).catch((error) => logger.error('Erro ao enviar alerta diario de cadastros:', error));
  }, PROFILE_CHECK_INTERVAL_MS);
}

module.exports = {
  PROFILE_ALERT_ROLE_IDS,
  PROFILE_UPDATE_INTERVAL_MS,
  readProfileConfig,
  setProfileBillingEnabled,
  toggleProfileBilling,
  setProfileUpdateNotificationsEnabled,
  toggleProfileUpdateNotifications,
  getBillingExemptUserIds,
  addBillingExemptUserId,
  getUserProfile,
  getGuildProfiles,
  registerApprovedProfile,
  registerManualProfile,
  removeUserProfileData,
  deleteUserProfile,
  updateProfileLink,
  updateProfileLevel,
  buildProfileEmbed,
  checkProfileUpdates,
  sendMissingProfileDailyAlert,
  parseTestPeriod,
  syncProfilesFromApprovedSetChannels,
  ensureProfileChannelAccess,
  ensureAllProfileChannelAccess,
  initProfileManager,
};

