const { ActivityType, EmbedBuilder } = require('discord.js');
const { openPoint, closePoint, getUserPoint, formatDate, formatDuration } = require('./pontoManager');

const FALLBACK_ALERT_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID || '1202251715865489459';
const FIVEM_ALERT_CHANNEL_ID = process.env.FIVEM_GTA_ALERT_CHANNEL_ID || '1498895777790038116';
const TARGET_SERVER_NAME = process.env.FIVEM_POINT_SERVER_NAME || 'Metrópole RP - Season 2!';
const AUTO_POINT_SOURCE = 'fivem_metropole_auto';
const activeFiveMPlayers = new Map();

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
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
  if (!isFiveMActivity(activity)) return false;
  const haystack = activityText(activity);
  const normalizedTarget = normalizeText(TARGET_SERVER_NAME);
  return haystack.includes(normalizedTarget)
    || (haystack.includes('metropole rp') && haystack.includes('season 2'));
}

function getTargetFiveMActivity(presence) {
  return presence?.activities?.find(isTargetFiveMActivity) || null;
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
    const cityName = extractCityName(newTargetActivity);
    const result = await openPoint(guild.id, user.id, buildAutoPointProfile(user, member, newTargetActivity, cityName));
    if (result.action !== 'opened') return;

    await user.send({
      embeds: [
        new EmbedBuilder()
          .setColor('#57F287')
          .setTitle('Ponto aberto automaticamente')
          .setDescription([
            `Detectei você no **${TARGET_SERVER_NAME}** e abri seu ponto.`,
            '',
            `Entrada: **${formatDate(result.data.activePointStartedAt)}**`,
            'Quando o Discord parar de detectar essa cidade, o ponto será fechado automaticamente.',
          ].join('\n'))
          .setTimestamp(),
      ],
    }).catch(() => null);
    return;
  }

  if (!oldTargetActivity || !point?.activePointStartedAt || point.activePointSource !== AUTO_POINT_SOURCE) return;

  const result = await closePoint(guild.id, user.id, {
    pointSource: AUTO_POINT_SOURCE,
    pointReason: `Saiu do FiveM: ${TARGET_SERVER_NAME}`,
    serverName: point.activePointServerName || TARGET_SERVER_NAME,
    activityName: oldTargetActivity?.name || null,
    activityDetails: oldTargetActivity?.details || null,
    activityState: oldTargetActivity?.state || null,
  });
  if (result.action !== 'closed') return;

  await user.send({
    embeds: [
      new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle('Ponto fechado automaticamente')
        .setDescription([
          `Não detectei mais você no **${TARGET_SERVER_NAME}** e fechei seu ponto.`,
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
      `<@${user.id}> começou a jogar **${activity?.name || 'FiveM/GTA'}**.`,
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
  const oldActivity = getFiveMActivity(oldPresence);
  const newActivity = getFiveMActivity(newPresence);

  await handleTargetFiveMAutoPoint({ guild, user, member, oldPresence, newPresence });

  if (!newActivity) {
    activeFiveMPlayers.delete(key);
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
    content: `<@${user.id}> começou a jogar FiveM/GTA - cidade: **${cityName}**`,
    embeds: [buildFiveMEmbed({ member, user, activity: newActivity, cityName })],
    allowedMentions: { users: [user.id] },
  }).catch((error) => {
    console.warn(`[FIVEM ALERT] Falha ao enviar alerta de ${user.id}: ${error.message}`);
    return null;
  });

  activeFiveMPlayers.set(key, activityKey);
}

module.exports = {
  handleFiveMActivityAlert,
  TARGET_SERVER_NAME,
  AUTO_POINT_SOURCE,
};
