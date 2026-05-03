const { ActivityType, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { openPoint, closePoint, getUserPoint, listGuildPoints, formatDate, formatDuration } = require('./pontoManager');
const { getPointAllowedRoleIds } = require('./pointRoleConfig');

const CONFIG_PATH = path.join(__dirname, '..', 'commands', 'config.json');
const FALLBACK_ALERT_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID || '1202251715865489459';
const FIVEM_ALERT_CHANNEL_ID = process.env.FIVEM_GTA_ALERT_CHANNEL_ID || '1498895777790038116';
const TARGET_SERVER_NAME = process.env.FIVEM_POINT_SERVER_NAME || 'Metrópole RP - Season 2!';
const TARGET_SERVER_ALIASES = [
  'metropole.gg',
  'Metrópole RP - Season 2!',
  'Metrópole RP',
  'Metrópole GG',
];
const AUTO_POINT_SOURCE = 'fivem_metropole_auto';
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

function getFiveMActivity(presence) {
  return presence?.activities?.find(isFiveMActivity) || null;
}

function activityText(activity) {
  return [
    activity?.name,
    activity?.details,
    activity?.state,
    activity?.assets?.largeText,
    activity?.assets?.smallText,
  ].map(normalizeText).join(' ');
}

function isTargetFiveMActivity(activity) {
  if (!activity || activity.type !== ActivityType.Playing) return false;
  const haystack = normalizeComparableText(activityText(activity));
  const targets = [TARGET_SERVER_NAME, ...TARGET_SERVER_ALIASES].map(normalizeComparableText);
  const hasTargetServer = targets.some((target) => target && haystack.includes(target));
  return hasTargetServer;
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

async function hasPointRole(guild, member, userId) {
  const roleIds = getPointAllowedRoleIds();
  const resolvedMember = member || await guild.members.fetch(userId).catch(() => null);
  return Boolean(resolvedMember?.roles?.cache && roleIds.some((roleId) => resolvedMember.roles.cache.has(roleId)));
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
    const match = candidate.match(/(?:cidade|city|servidor|server|cidade\/servidor)\s*[:|\-]\s*([^|•\n\r]+)/i);
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

function buildAutoPointProfile(user, member, activity, cityName) {
  return {
    userName: member?.displayName || user.username,
    userMention: `<@${user.id}>`,
    registro: user.id,
    pointSource: AUTO_POINT_SOURCE,
    pointReason: `Detectado no FiveM: ${TARGET_SERVER_NAME}`,
    serverName: cityName || TARGET_SERVER_NAME,
    activityName: activity?.name || null,
    activityDetails: activity?.details || null,
    activityState: activity?.state || null,
  };
}

async function handleTargetFiveMAutoPoint({ guild, user, member, oldPresence, newPresence }) {
  const oldTargetActivity = getTargetFiveMActivity(oldPresence);
  const newTargetActivity = getTargetFiveMActivity(newPresence);
  const point = await getUserPoint(guild.id, user.id).catch(() => null);

  if (newTargetActivity) {
    if (point?.activePointStartedAt) return;
    if (!await hasPointRole(guild, member, user.id)) return;
    const cityName = extractCityName(newTargetActivity);
    const result = await openPoint(guild.id, user.id, buildAutoPointProfile(user, member, newTargetActivity, cityName));
    if (result.action !== 'opened') return;

    await user.send({
      embeds: [
        new EmbedBuilder()
          .setColor('#57F287')
          .setTitle('Ponto aberto automaticamente')
          .setDescription([
            `Detectei você na cidade **${cityName || TARGET_SERVER_NAME}** e abri seu ponto.`,
            '',
            `Entrada: **${formatDate(result.data.activePointStartedAt)}**`,
            'Quando o Discord parar de detectar essa cidade, o ponto será fechado automaticamente.',
          ].join('\n'))
          .setTimestamp(),
      ],
    }).catch(() => null);
    return;
  }

  if (!point?.activePointStartedAt || point.activePointSource !== AUTO_POINT_SOURCE) return;

  const result = await closePoint(guild.id, user.id, {
    pointSource: AUTO_POINT_SOURCE,
    pointReason: `Saiu do FiveM: ${TARGET_SERVER_NAME}`,
    serverName: point.activePointServerName || TARGET_SERVER_NAME,
    activityName: oldTargetActivity?.name || point.activePointActivityName || null,
    activityDetails: oldTargetActivity?.details || point.activePointActivityDetails || null,
    activityState: oldTargetActivity?.state || point.activePointActivityState || null,
  });
  if (result.action !== 'closed') return;

  await user.send({
    embeds: [
      new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle('Ponto fechado automaticamente')
        .setDescription([
          `Não detectei mais você na cidade **${point.activePointServerName || TARGET_SERVER_NAME}** e fechei seu ponto.`,
          '',
          `Saída: **${formatDate(result.data.lastPointCloseAt)}**`,
          `Tempo online: **${formatDuration(result.durationMs)}**`,
        ].join('\n'))
        .setTimestamp(),
    ],
  }).catch(() => null);
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
      `Usuário: **${displayName}**`,
      '',
      `**Cidade/servidor:** ${cityName}`,
      `**Atividade:** ${details}`,
    ].join('\n'))
    .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 256 }))
    .setFooter({ text: 'Vortex FiveM/GTA Activity Alerts' })
    .setTimestamp();
}

async function handleFiveMActivityAlert(oldPresence, newPresence) {
  if (!newPresence?.guild || !newPresence.user || newPresence.user.bot) return;

  const guild = newPresence.guild;
  const user = newPresence.user;
  const member = newPresence.member;
  const key = `${guild.id}:${user.id}`;
  const oldActivity = getTargetFiveMActivity(oldPresence);
  const newActivity = getTargetFiveMActivity(newPresence);

  await handleTargetFiveMAutoPoint({ guild, user, member, oldPresence, newPresence });

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
  const results = [];

  for (const guild of client.guilds.cache.values()) {
    const presenceFetchOk = await guild.members.fetch({ withPresences: true })
      .then(() => true)
      .catch(() => false);
    const presences = guild.presences?.cache;
    if (!presenceFetchOk && !presences?.size) continue;

    const detectedUserIds = new Set();

    for (const presence of presences?.values?.() || []) {
      if (!presence?.user || presence.user.bot) continue;
      const activity = getTargetFiveMActivity(presence);
      if (!activity) continue;
      detectedUserIds.add(String(presence.user.id));

      const member = presence.member || await guild.members.fetch(presence.user.id).catch(() => null);
      if (!await hasPointRole(guild, member, presence.user.id)) continue;

      const point = await getUserPoint(guild.id, presence.user.id).catch(() => null);
      if (point?.activePointStartedAt) continue;

      const cityName = extractCityName(activity);
      const result = await openPoint(guild.id, presence.user.id, buildAutoPointProfile(presence.user, member, activity, cityName)).catch(() => null);
      if (result?.action === 'opened') {
        results.push({ guildId: guild.id, userId: presence.user.id });
        await presence.user.send({
          embeds: [
            new EmbedBuilder()
              .setColor('#57F287')
              .setTitle('Ponto aberto automaticamente')
              .setDescription([
                `Detectei você no **${cityName || TARGET_SERVER_NAME}** quando o bot iniciou e abri seu ponto.`,
                '',
                `Entrada: **${formatDate(result.data.activePointStartedAt)}**`,
              ].join('\n'))
              .setTimestamp(),
          ],
        }).catch(() => null);
      }
    }

    const points = await listGuildPoints(guild.id).catch(() => []);
    for (const point of points) {
      if (!point?.activePointStartedAt || point.activePointSource !== AUTO_POINT_SOURCE) continue;
      if (detectedUserIds.has(String(point.userId))) continue;

      const result = await closePoint(guild.id, point.userId, {
        pointSource: AUTO_POINT_SOURCE,
        pointReason: `Nao detectado no FiveM apos reinicio: ${TARGET_SERVER_NAME}`,
        serverName: point.activePointServerName || TARGET_SERVER_NAME,
      }).catch(() => null);

      if (result?.action !== 'closed') continue;
      results.push({ guildId: guild.id, userId: point.userId, action: 'closed_not_detected' });

      const user = await client.users.fetch(point.userId).catch(() => null);
      await user?.send({
        embeds: [
          new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle('Ponto fechado automaticamente')
            .setDescription([
              `Não detectei mais você na cidade **${point.activePointServerName || TARGET_SERVER_NAME}** após o bot iniciar e fechei seu ponto.`,
              '',
              `Saída: **${formatDate(result.data.lastPointCloseAt)}**`,
              `Tempo online: **${formatDuration(result.durationMs)}**`,
            ].join('\n'))
            .setTimestamp(),
        ],
      }).catch(() => null);
    }
  }

  return results;
}

module.exports = {
  handleFiveMActivityAlert,
  scanCurrentFiveMActivities,
  TARGET_SERVER_NAME,
  AUTO_POINT_SOURCE,
};
