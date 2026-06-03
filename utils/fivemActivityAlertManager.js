const { ActivityType, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { isPrimaryGuild } = require('./guildScope');
const { isMaintenanceMode } = require('./maintenanceMode');

const CONFIG_PATH = path.join(__dirname, '..', 'commands', 'config.json');
const FALLBACK_ALERT_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID || '1202251715865489459';
const FIVEM_ALERT_CHANNEL_ID = process.env.FIVEM_GTA_ALERT_CHANNEL_ID || '1498895777790038116';
const TARGET_SERVER_NAME = process.env.FIVEM_SERVER_NAME || 'Metropole RP - Season 2!';
const TARGET_SERVER_ALIASES = [
  'metropole.gg',
  'Metropole RP - Season 2!',
  'Metropole RP',
  'Jogando Metropole RP',
  'Jogando Metropole GG',
  ...String(process.env.FIVEM_SERVER_ALIASES || '')
    .split(',')
    .map((alias) => alias.trim())
    .filter(Boolean),
];
const FIVEM_STARTUP_FETCH_PRESENCES = process.env.FIVEM_STARTUP_FETCH_PRESENCES !== 'false';
const activeFiveMPlayers = new Map();
const loggedFiveMPlayers = new Set();

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function normalizeComparableText(value) {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isFiveMActivity(activity) {
  if (!activity || activity.type !== ActivityType.Playing) return false;
  const haystack = [
    activity.name,
    activity.details,
    activity.state,
    activity.assets?.largeText,
    activity.assets?.smallText,
  ].map(normalizeText).join(' ');

  return /\bfivem\b/.test(haystack)
    || /\bgta\s*v?\b/.test(haystack)
    || /grand theft auto/.test(haystack);
}

function targetActivityText(activity) {
  return [
    activity?.details,
    activity?.state,
    activity?.assets?.largeText,
    activity?.assets?.smallText,
  ].map(normalizeText).join(' ');
}

function containsTargetServer(value) {
  const haystack = normalizeComparableText(value);
  const targets = [TARGET_SERVER_NAME, ...TARGET_SERVER_ALIASES].map(normalizeComparableText);
  return targets.some((target) => target && haystack.includes(target));
}

function isTargetFiveMActivity(activity) {
  if (!isFiveMActivity(activity)) return false;
  return containsTargetServer(targetActivityText(activity));
}

function getTargetFiveMActivity(presence) {
  return presence?.activities?.find(isTargetFiveMActivity) || null;
}

function readConfig() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return {};
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8') || '{}');
  } catch {
    return {};
  }
}

function areActivityLogsDisabled() {
  return readConfig().DISABLE_ACTIVITY_LOGS === true;
}

function cleanCityName(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/^[|:>\-\s]+|[|:>\-\s]+$/g, '')
    .slice(0, 90)
    .trim();
}

function extractCityName(activity) {
  const candidates = [
    activity?.state,
    activity?.details,
    activity?.assets?.largeText,
    activity?.assets?.smallText,
  ].filter(Boolean).map(String);

  for (const candidate of candidates) {
    const match = candidate.match(/(?:cidade|city|servidor|server|cidade\/servidor)\s*[:|\-]\s*([^|\n\r]+)/i);
    if (match?.[1]) return cleanCityName(match[1]);
  }

  for (const candidate of candidates) {
    const cleaned = cleanCityName(
      candidate
        .replace(/FiveM/gi, '')
        .replace(/Grand Theft Auto V/gi, '')
        .replace(/\bGTA\s*V?\b/gi, '')
        .replace(/playing/gi, '')
    );
    if (cleaned && cleaned.length >= 3) return cleaned;
  }

  return 'Nao informado pelo Discord';
}

function buildActivityKey(activity) {
  return [
    activity?.name,
    activity?.details,
    activity?.state,
    activity?.assets?.largeText,
    activity?.assets?.smallText,
  ].filter(Boolean).join('|').slice(0, 250);
}

async function resolveFiveMAlertChannel(guild) {
  if (FIVEM_ALERT_CHANNEL_ID) {
    const configured = await guild.channels.fetch(FIVEM_ALERT_CHANNEL_ID).catch(() => null);
    if (configured?.isTextBased?.()) return configured;
  }

  const channels = await guild.channels.fetch().catch(() => guild.channels.cache);
  const byName = channels.find((channel) => {
    if (!channel?.isTextBased?.()) return false;
    const name = normalizeText(channel.name).replace(/[^a-z0-9]/g, '');
    return name === 'fivemgta' || name === 'gtafivem' || (name.includes('fivem') && name.includes('gta'));
  });
  if (byName) return byName;

  return guild.channels.fetch(FALLBACK_ALERT_CHANNEL_ID).catch(() => null);
}

function buildFiveMEmbed({ member, user, activity, cityName }) {
  const displayName = member?.displayName || user.username;
  const details = [activity?.details, activity?.state].filter(Boolean).join('\n') || 'Sem detalhes extras.';

  return new EmbedBuilder()
    .setColor('#2ECC71')
    .setTitle(`${displayName} entrou no FiveM/GTA`)
    .setDescription([
      `Usuario: **${displayName}**`,
      '',
      `**Cidade/servidor:** ${cityName}`,
      `**Atividade:** ${details}`,
    ].join('\n'))
    .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 256 }))
    .setFooter({ text: 'Vortex FiveM/GTA Activity Alerts' })
    .setTimestamp();
}

async function handleFiveMActivityAlert(oldPresence, newPresence) {
  if (isMaintenanceMode()) return;
  if (!newPresence?.guild || !newPresence.user || newPresence.user.bot) return;

  const guild = newPresence.guild;
  if (!isPrimaryGuild(guild.id)) return;
  const user = newPresence.user;
  const member = newPresence.member || await guild.members.fetch(user.id).catch(() => null);
  const key = `${guild.id}:${user.id}`;
  const oldActivity = getTargetFiveMActivity(oldPresence);
  const newActivity = getTargetFiveMActivity(newPresence);

  if (!newActivity) {
    activeFiveMPlayers.delete(key);
    return;
  }

  if (areActivityLogsDisabled()) {
    activeFiveMPlayers.delete(key);
    return;
  }

  if (loggedFiveMPlayers.has(key)) {
    activeFiveMPlayers.set(key, buildActivityKey(newActivity));
    return;
  }

  const activityKey = buildActivityKey(newActivity);
  if (oldActivity && activeFiveMPlayers.get(key) === activityKey) return;
  if (activeFiveMPlayers.get(key) === activityKey) return;

  const channel = await resolveFiveMAlertChannel(guild);
  if (!channel?.isTextBased?.()) {
    console.warn('[FIVEM ALERT] Canal de alerta FiveM/GTA nao encontrado.');
    activeFiveMPlayers.set(key, activityKey);
    return;
  }

  const cityName = extractCityName(newActivity);
  await channel.send({
    content: `Alerta de FiveM/GTA detectado - cidade: **${cityName}**`,
    embeds: [buildFiveMEmbed({ member, user, activity: newActivity, cityName })],
    allowedMentions: { parse: [] },
  }).catch((error) => {
    console.warn(`[FIVEM ALERT] Falha ao enviar alerta de ${user.id}: ${error.message}`);
    return null;
  });

  activeFiveMPlayers.set(key, activityKey);
  loggedFiveMPlayers.add(key);
}

async function scanCurrentFiveMActivities(client) {
  if (isMaintenanceMode()) return [];
  const results = [];

  for (const guild of client.guilds.cache.values()) {
    if (!isPrimaryGuild(guild.id)) continue;
    const presenceFetchOk = FIVEM_STARTUP_FETCH_PRESENCES
      ? await guild.members.fetch({ withPresences: true })
        .then(() => true)
        .catch(() => false)
      : false;
    const presences = guild.presences?.cache;
    if (!presenceFetchOk && !presences?.size) continue;

    for (const presence of presences?.values?.() || []) {
      if (!presence?.user || presence.user.bot) continue;
      const activity = getTargetFiveMActivity(presence);
      if (!activity) continue;
      results.push({ guildId: guild.id, userId: presence.user.id, action: 'detected' });
    }
  }

  return results;
}

module.exports = {
  handleFiveMActivityAlert,
  scanCurrentFiveMActivities,
  extractCityName,
  getTargetFiveMActivity,
  isTargetFiveMActivity,
  TARGET_SERVER_NAME,
};
