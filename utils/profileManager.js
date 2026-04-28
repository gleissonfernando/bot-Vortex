const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');
const { formatDate, formatDuration } = require('./pontoManager');
const { logger } = require('./logger');

const PROFILES_PATH = path.join(__dirname, '..', 'commands', 'perfis.json');
const PROFILE_CONFIG_PATH = path.join(__dirname, '..', 'commands', 'perfisConfig.json');
const PANEL_CONFIG_PATH = path.join(__dirname, '..', 'commands', 'config.json');
const PROFILE_UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const PROFILE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const PROFILE_REMINDER_HOUR = 19;
const PROFILE_TIME_ZONE = 'America/Sao_Paulo';
const PROFILE_ALERT_ROLE_IDS = ['1201238413676924979', '1201238799494152344', '1212944805055692840'];
const MASTER_ROLE_ID = '1497703127074345040';
const DEFAULT_PROFILE_MANAGEMENT_CHANNEL_ID = '1483169256727122050';

let interval = null;

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

function readProfileConfig() {
  if (!fs.existsSync(PROFILE_CONFIG_PATH)) {
    fs.writeFileSync(PROFILE_CONFIG_PATH, `${JSON.stringify({ billingDmEnabled: true }, null, 2)}\n`, 'utf8');
  }
  try {
    return {
      billingDmEnabled: true,
      ...(JSON.parse(fs.readFileSync(PROFILE_CONFIG_PATH, 'utf8') || '{}')),
    };
  } catch {
    return { billingDmEnabled: true };
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
  const config = readPanelConfig();
  return String(config.POINT_PENALTY_CHANNEL_ID || DEFAULT_PROFILE_MANAGEMENT_CHANNEL_ID);
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
    }, { reason: 'Garantir acesso da gerencia ao canal privado do perfil' }).catch(() => null);
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

function getGuildProfiles(guildId) {
  const data = readProfiles();
  return data[guildId] || {};
}

function getUserProfile(guildId, userId) {
  return getGuildProfiles(guildId)[userId] || null;
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

function getSaoPauloDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: PROFILE_TIME_ZONE,
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

function canSendScheduledProfileReminder(date = new Date()) {
  const hour = Number(getSaoPauloDateParts(date).hour);
  return Number.isFinite(hour) && hour >= PROFILE_REMINDER_HOUR;
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
  await ensureProfileChannelAccess(guild, profile.callChannelId, member.id).catch(() => null);
  return profile;
}

async function updateProfileLink(guild, user, link, updatedBy) {
  const profileUrl = normalizeProfileUrl(link);
  if (!profileUrl) {
    return { ok: false, message: 'Link invalido. Use um link http/https do Discord ou de imagem.' };
  }

  const data = readProfiles();
  if (!data[guild.id]) data[guild.id] = {};

  const now = new Date();
  const existing = data[guild.id][user.id] || {};
  if (!existing.approvedAt) {
    return { ok: false, message: 'Este usuario ainda nao possui perfil aprovado salvo pelo /set.' };
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
    photoLinks: addPhotoLink(existing.photoLinks, profileUrl, updatedBy || user.id),
    lastProfileUpdateAt: now.toISOString(),
    lastReminderAt: null,
    updatedBy: updatedBy ? String(updatedBy) : user.id,
    updatedAt: now.toISOString(),
  };

  data[guild.id][user.id] = profile;
  writeProfiles(data);
  await ensureProfileChannelAccess(guild, profile.callChannelId, user.id).catch(() => null);
  return { ok: true, profile };
}

async function updateProfileLevel(guild, user, nivelGame, updatedBy) {
  const normalizedLevel = normalizeProfileLevel(nivelGame);
  if (!normalizedLevel) {
    return { ok: false, message: 'Nivel invalido. Use apenas numeros, exemplo: 12.' };
  }

  const data = readProfiles();
  if (!data[guild.id]) data[guild.id] = {};

  const now = new Date();
  const existing = data[guild.id][user.id] || {};
  if (!existing.approvedAt) {
    return { ok: false, message: 'Este usuario ainda nao possui perfil aprovado salvo pelo /set.' };
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
  return { ok: true, profile };
}

async function registerManualProfile(guild, user, {
  name,
  callChannelId = null,
  photoLink = null,
  nivelGame = null,
  registeredBy = null,
} = {}) {
  const profileUrl = photoLink ? normalizeProfileUrl(photoLink) : null;
  if (photoLink && !profileUrl) {
    return { ok: false, message: 'Link da foto invalido. Use um link http/https.' };
  }
  const normalizedLevel = nivelGame ? normalizeProfileLevel(nivelGame) : null;
  if (nivelGame && !normalizedLevel) {
    return { ok: false, message: 'Nivel invalido. Use apenas numeros, exemplo: 12.' };
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
  return { ok: true, profile };
}

function buildProfileEmbed({ guild, user, member, profile }) {
  const now = Date.now();
  const lastUpdate = profile?.lastProfileUpdateAt ? new Date(profile.lastProfileUpdateAt).getTime() : 0;
  const elapsed = lastUpdate ? now - lastUpdate : 0;
  const nextUpdateAt = lastUpdate ? new Date(lastUpdate + PROFILE_UPDATE_INTERVAL_MS) : null;
  const imageUrl = profile?.profileImageUrl || user.displayAvatarURL({ dynamic: true, size: 1024 });
  const photoLinks = Array.isArray(profile?.photoLinks) ? profile.photoLinks : [];
  const latestPhotos = photoLinks.slice(-5).reverse().map((item, index) => `${index + 1}. ${item.url}`).join('\n') || 'N/A';

  const embed = new EmbedBuilder()
    .setColor('#7000FF')
    .setAuthor({ name: 'VORTEX | Perfil', iconURL: guild.client.user?.displayAvatarURL?.() || undefined })
    .setTitle(`Perfil de ${member?.displayName || user.username}`)
    .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 256 }))
    .setImage(imageUrl)
    .addFields(
      { name: 'Usuario', value: `<@${user.id}>`, inline: true },
      { name: 'Discord ID', value: `\`${user.id}\``, inline: true },
      { name: 'Status', value: profile ? (profile.registeredManually ? 'Cadastrado manualmente' : 'Aprovado no /set') : 'Sem perfil aprovado salvo', inline: true },
      { name: 'Nome em game', value: profile?.nomeGame || 'N/A', inline: true },
      { name: 'ID em game', value: profile?.idGame || 'N/A', inline: true },
      { name: 'Numero', value: profile?.numeroGame || 'N/A', inline: true },
      { name: 'Nivel em game', value: profile?.nivelGame || 'N/A', inline: true },
      { name: 'Call/Canal', value: profile?.callChannelId ? `<#${profile.callChannelId}>` : 'N/A', inline: true },
      { name: 'Tipo', value: profile?.tipo || 'N/A', inline: true },
      { name: 'Cargo mais alto', value: member?.roles?.highest ? `<@&${member.roles.highest.id}>` : 'N/A', inline: true },
      { name: 'Links de fotos salvos', value: latestPhotos.slice(0, 1024), inline: false },
      { name: 'Ultima atualizacao', value: profile?.lastProfileUpdateAt ? formatDate(profile.lastProfileUpdateAt) : 'N/A', inline: false },
      { name: 'Tempo desde atualização', value: lastUpdate ? formatDuration(elapsed) : 'N/A', inline: true },
      { name: 'Proxima atualização', value: nextUpdateAt ? formatDate(nextUpdateAt) : 'N/A', inline: true }
    )
    .setFooter({ text: `Vortex - Perfil • ${formatDate(new Date())}` })
    .setTimestamp();

  if (profile?.bannerUrl) embed.setImage(profile.profileImageUrl || profile.bannerUrl);
  return embed;
}

async function sendProfileReminder(client, guild, profile, thresholdMs = PROFILE_UPDATE_INTERVAL_MS, force = false) {
  const config = readProfileConfig();
  if (!config.billingDmEnabled) return { sent: false, reason: 'billing_disabled' };
  if (!force && !canSendScheduledProfileReminder(new Date())) {
    return { sent: false, reason: 'before_19h' };
  }

  const now = Date.now();
  const lastUpdateMs = profile.lastProfileUpdateAt ? new Date(profile.lastProfileUpdateAt).getTime() : 0;
  const lastReminderMs = profile.lastReminderAt ? new Date(profile.lastReminderAt).getTime() : 0;
  if (!lastUpdateMs) return { sent: false, reason: 'missing_update' };
  if (!force && now - lastUpdateMs < thresholdMs) return { sent: false, reason: 'not_due' };
  if (!force && lastReminderMs && getSaoPauloDateKey(new Date(lastReminderMs)) === getSaoPauloDateKey(new Date())) {
    return { sent: false, reason: 'already_reminded_today' };
  }

  const user = await client.users.fetch(profile.userId).catch(() => null);
  if (!user) return { sent: false, reason: 'missing_user' };

  const embed = new EmbedBuilder()
    .setColor('#FEE75C')
    .setTitle('Perfil precisa ser atualizado')
    .setDescription([
      `O usuario <@${profile.userId}> precisa atualizar o perfil do /set.`,
      '',
      `**Ultima atualizacao:** ${formatDate(profile.lastProfileUpdateAt)}`,
      `**Tempo sem atualizar:** ${formatDuration(now - lastUpdateMs)}`,
      `**Horario do aviso:** ${formatDate(new Date())}`,
      '',
      'Use `/perfil link:<link da imagem> nivel:<numero>` para atualizar.',
    ].join('\n'))
    .setTimestamp();

  await user.send({ embeds: [embed] }).catch(() => null);

  const shouldNotifyManagement = now - lastUpdateMs >= PROFILE_UPDATE_INTERVAL_MS;
  if (shouldNotifyManagement) {
    const channel = await client.channels.fetch(getProfileManagementChannelId()).catch(() => null);
    const roleMentions = PROFILE_ALERT_ROLE_IDS.map((id) => `<@&${id}>`).join(' ');
    if (channel?.isTextBased?.()) {
      await channel.send({
        content: `${roleMentions} <@${profile.userId}>`,
        embeds: [embed],
        allowedMentions: { users: [profile.userId], roles: PROFILE_ALERT_ROLE_IDS },
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

async function checkProfileUpdates(client, { guildId = null, userId = null, thresholdMs = PROFILE_UPDATE_INTERVAL_MS, force = false } = {}) {
  const data = readProfiles();
  const results = [];

  for (const [currentGuildId, guildProfiles] of Object.entries(data)) {
    if (guildId && currentGuildId !== String(guildId)) continue;
    const guild = await client.guilds.fetch(currentGuildId).catch(() => null);
    if (!guild) continue;

    for (const profile of Object.values(guildProfiles || {})) {
      if (userId && profile.userId !== String(userId)) continue;
      const result = await sendProfileReminder(client, guild, profile, thresholdMs, force).catch((error) => {
        logger.error('Erro ao enviar lembrete de perfil:', error);
        return { sent: false, reason: error.message };
      });
      results.push({ userId: profile.userId, ...result });
    }
  }

  return results;
}

async function ensureAllProfileChannelAccess(client) {
  const data = readProfiles();
  for (const [guildId, guildProfiles] of Object.entries(data)) {
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) continue;

    for (const profile of Object.values(guildProfiles || {})) {
      if (!profile?.callChannelId) continue;
      await ensureProfileChannelAccess(guild, profile.callChannelId, profile.userId).catch((error) => {
        logger.error('Erro ao garantir acesso ao canal privado do perfil:', error);
      });
    }
  }
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
  ensureAllProfileChannelAccess(client).catch((error) => logger.error('Erro ao revisar canais privados de perfil:', error));
  checkProfileUpdates(client).catch((error) => logger.error('Erro ao checar perfis no inicio:', error));
  interval = setInterval(() => {
    checkProfileUpdates(client).catch((error) => logger.error('Erro ao checar perfis:', error));
  }, PROFILE_CHECK_INTERVAL_MS);
}

module.exports = {
  PROFILE_ALERT_ROLE_IDS,
  PROFILE_UPDATE_INTERVAL_MS,
  readProfileConfig,
  setProfileBillingEnabled,
  toggleProfileBilling,
  getUserProfile,
  getGuildProfiles,
  registerApprovedProfile,
  registerManualProfile,
  updateProfileLink,
  updateProfileLevel,
  buildProfileEmbed,
  checkProfileUpdates,
  parseTestPeriod,
  ensureProfileChannelAccess,
  ensureAllProfileChannelAccess,
  initProfileManager,
};
