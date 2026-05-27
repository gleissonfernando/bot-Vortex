const { ActivityType, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { openPoint, closePoint, getUserPoint, listGuildPoints } = require('./pontoManager');
const { getPointAllowedRoleIds } = require('./pointRoleConfig');
const { isPrimaryGuild } = require('./guildScope');
const { createPointActionTranscriptSummary } = require('./pointTranscriptNotifier');
const { queuePointSnapshotSync } = require('./frequencyDashboardSync');
const { isMaintenanceMode } = require('./maintenanceMode');

const CONFIG_PATH = path.join(__dirname, '..', 'commands', 'config.json');
const FALLBACK_ALERT_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID || '1202251715865489459';
const FIVEM_ALERT_CHANNEL_ID = process.env.FIVEM_GTA_ALERT_CHANNEL_ID || '1498895777790038116';
const TARGET_SERVER_NAME = process.env.FIVEM_POINT_SERVER_NAME || 'Metrópole RP - Season 2!';
const TARGET_SERVER_ALIASES = [
  'metropole.gg',
  'Metropole RP - Season 2!',
  'Metropole RP',
  'Jogando Metropole RP',
  'Jogando Metropole GG',
  ...String(process.env.FIVEM_POINT_SERVER_ALIASES || '')
    .split(',')
    .map((alias) => alias.trim())
    .filter(Boolean),
];
const POINT_AUTO_EXCLUDE_ROLE_ID = '1493989209168543846';
const AUTO_POINT_SOURCE = 'fivem_metropole_auto';
const FIVEM_STARTUP_FETCH_PRESENCES = process.env.FIVEM_STARTUP_FETCH_PRESENCES !== 'false';
const AUTO_POINT_CONFIRM_DELAY_MS = Math.max(
  1000,
  Number(process.env.FIVEM_AUTO_POINT_CONFIRM_DELAY_MS || 40 * 1000) || 40 * 1000
);
const activeFiveMPlayers = new Map();
const loggedFiveMPlayers = new Set();
const pendingAutoPointChecks = new Map();

async function syncPointOnlineChannel(client, guildId, userId, allowed) {
  const { setOnlineChannelAccess, updateStatusPanel } = require('./pontoPanel');
  await setOnlineChannelAccess(client, guildId, userId, allowed).catch(() => null);
  await updateStatusPanel(client, guildId).catch(() => null);
}

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
  if (!activity || activity.type !== ActivityType.Playing) return false;
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

async function hasPointRole(guild, member, userId) {
  const roleIds = getPointAllowedRoleIds();
  const resolvedMember = member || await guild.members.fetch(userId).catch(() => null);
  if (!resolvedMember?.roles?.cache) return false;
  // Verificar se o membro tem o cargo proibido para ponto automático
  if (resolvedMember.roles.cache.has(POINT_AUTO_EXCLUDE_ROLE_ID)) return false;
  return roleIds.some((roleId) => resolvedMember.roles.cache.has(roleId));
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

function cancelPendingAutoPointCheck(guildId, userId) {
  const key = `${guildId}:${userId}`;
  const pending = pendingAutoPointChecks.get(key);
  if (!pending) return;
  clearTimeout(pending.timeout);
  pendingAutoPointChecks.delete(key);
}

function scheduleAutoPointCheck({ guild, user, member }) {
  const key = `${guild.id}:${user.id}`;
  if (pendingAutoPointChecks.has(key)) return;

  const timeout = setTimeout(async () => {
    try {
      pendingAutoPointChecks.delete(key);

      const latestPresence = guild.presences?.cache?.get(user.id) || null;
      const latestActivity = getTargetFiveMActivity(latestPresence);
      const point = await getUserPoint(guild.id, user.id).catch(() => null);

      if (!latestActivity) {
        await syncPointOnlineChannel(guild.client, guild.id, user.id, false);
        if (point?.activePointStartedAt && point.activePointSource === AUTO_POINT_SOURCE) {
          const result = await closePoint(guild.id, user.id, {
            enforceMinimumDuration: false,
            pointSource: AUTO_POINT_SOURCE,
            pointReason: `Nao detectado no FiveM apos ${Math.round(AUTO_POINT_CONFIRM_DELAY_MS / 1000)}s: ${TARGET_SERVER_NAME}`,
            serverName: point.activePointServerName || TARGET_SERVER_NAME,
          }).catch(() => null);
          if (result?.action === 'closed') {
            queuePointSnapshotSync(guild.client);
          }
        }
        return;
      }

      if (point?.activePointStartedAt) {
        await syncPointOnlineChannel(guild.client, guild.id, user.id, true);
        return;
      }

      const resolvedMember = latestPresence?.member || member || await guild.members.fetch(user.id).catch(() => null);
      if (!await hasPointRole(guild, resolvedMember, user.id)) return;

      const cityName = extractCityName(latestActivity);
      const result = await openPoint(guild.id, user.id, buildAutoPointProfile(user, resolvedMember, latestActivity, cityName));
      if (result.action !== 'opened') return;
      await syncPointOnlineChannel(guild.client, guild.id, user.id, true);
      queuePointSnapshotSync(guild.client);

      const summary = await createPointActionTranscriptSummary({
        guild,
        target: user,
        generatedBy: guild.client.user,
        action: 'opened',
        result,
      });
      await user.send({
        content: [
          `Detectei você na cidade **${cityName || TARGET_SERVER_NAME}** por ${Math.round(AUTO_POINT_CONFIRM_DELAY_MS / 1000)} segundos e abri seu ponto automaticamente.`,
          '',
          summary.content,
          '',
          'Quando o Discord parar de detectar essa cidade, o ponto será fechado automaticamente.',
        ].join('\n'),
        allowedMentions: { users: [] },
      }).catch(() => null);
    } catch (error) {
      console.warn(`[FIVEM AUTO POINT] Falha na checagem atrasada de ${user.id}: ${error.message}`);
    }
  }, AUTO_POINT_CONFIRM_DELAY_MS);

  pendingAutoPointChecks.set(key, { timeout });
}

async function handleTargetFiveMAutoPoint({ guild, user, member, oldPresence, newPresence }) {
  const oldTargetActivity = getTargetFiveMActivity(oldPresence);
  const newTargetActivity = getTargetFiveMActivity(newPresence);
  const point = await getUserPoint(guild.id, user.id).catch(() => null);

  if (newTargetActivity) {
    if (point?.activePointStartedAt) {
      cancelPendingAutoPointCheck(guild.id, user.id);
      await syncPointOnlineChannel(guild.client, guild.id, user.id, true);
      return;
    }
    if (!await hasPointRole(guild, member, user.id)) return;
    scheduleAutoPointCheck({ guild, user, member });
    return;
  }

  cancelPendingAutoPointCheck(guild.id, user.id);
  await syncPointOnlineChannel(guild.client, guild.id, user.id, false);
  if (!point?.activePointStartedAt || point.activePointSource !== AUTO_POINT_SOURCE) return;

  const result = await closePoint(guild.id, user.id, {
    enforceMinimumDuration: false,
    pointSource: AUTO_POINT_SOURCE,
    pointReason: `Saiu do FiveM: ${TARGET_SERVER_NAME}`,
    serverName: point.activePointServerName || TARGET_SERVER_NAME,
    activityName: oldTargetActivity?.name || point.activePointActivityName || null,
    activityDetails: oldTargetActivity?.details || point.activePointActivityDetails || null,
    activityState: oldTargetActivity?.state || point.activePointActivityState || null,
  });
  if (result.action !== 'closed') return;
  await syncPointOnlineChannel(guild.client, guild.id, user.id, false);
  queuePointSnapshotSync(guild.client);

  const summary = await createPointActionTranscriptSummary({
    guild,
    target: user,
    generatedBy: guild.client.user,
    action: 'closed',
    result,
  });
  await user.send({
    content: [
      `Não detectei mais você na cidade **${point.activePointServerName || TARGET_SERVER_NAME}** e fechei seu ponto automaticamente.`,
      '',
      summary.content,
    ].join('\n'),
    allowedMentions: { users: [] },
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
  if (isMaintenanceMode()) return;
  if (!newPresence?.guild || !newPresence.user || newPresence.user.bot) return;

  const guild = newPresence.guild;
  if (!isPrimaryGuild(guild.id)) return;
  const user = newPresence.user;
  const member = newPresence.member || await guild.members.fetch(user.id).catch(() => null);
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

      scheduleAutoPointCheck({ guild, user: presence.user, member });
      results.push({ guildId: guild.id, userId: presence.user.id, action: 'pending_open_check' });
    }

    if (!presenceFetchOk) continue;

    const points = await listGuildPoints(guild.id).catch(() => []);
    for (const point of points) {
      if (!point?.activePointStartedAt || point.activePointSource !== AUTO_POINT_SOURCE) continue;
      if (detectedUserIds.has(String(point.userId))) continue;

      const result = await closePoint(guild.id, point.userId, {
        enforceMinimumDuration: false,
        pointSource: AUTO_POINT_SOURCE,
        pointReason: `Nao detectado no FiveM apos reinicio: ${TARGET_SERVER_NAME}`,
        serverName: point.activePointServerName || TARGET_SERVER_NAME,
      }).catch(() => null);

      if (result?.action !== 'closed') continue;
      results.push({ guildId: guild.id, userId: point.userId, action: 'closed_not_detected' });
      await syncPointOnlineChannel(client, guild.id, point.userId, false);
      queuePointSnapshotSync(client);

      const user = await client.users.fetch(point.userId).catch(() => null);
      if (user) {
        const summary = await createPointActionTranscriptSummary({
          guild,
          target: user,
          generatedBy: client.user,
          action: 'closed',
          result,
        });
        await user.send({
          content: [
            `Não detectei mais você na cidade **${point.activePointServerName || TARGET_SERVER_NAME}** após o bot iniciar e fechei seu ponto.`,
            '',
            summary.content,
          ].join('\n'),
          allowedMentions: { users: [] },
        }).catch(() => null);
      }
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
  AUTO_POINT_SOURCE,
};
