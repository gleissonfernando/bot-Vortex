const { isPrimaryGuild } = require('./guildScope');
const { logger } = require('./logger');

const DEFAULT_API_URL = 'http://127.0.0.1:4100';
const MEMBER_CHUNK_SIZE = 100;
const MEMBER_SYNC_INTERVAL_MS = Math.max(5 * 60 * 1000, Number(process.env.FREQUENCY_MEMBER_SYNC_INTERVAL_MS || 15 * 60 * 1000));
const DISCORD_PROFILE_CACHE_MS = Math.max(5 * 60 * 1000, Number(process.env.FREQUENCY_DISCORD_PROFILE_CACHE_MS || 30 * 60 * 1000));
let intervalsStarted = false;
let memberSyncQueued = false;
let memberSyncRunning = false;
const discordProfileCache = new Map();

function hasRegisteredProfile(guildId, userId) {
  try {
    const { getUserProfile } = require('./profileManager');
    return Boolean(getUserProfile(guildId, userId));
  } catch {
    return false;
  }
}

function getApiUrl() {
  return String(process.env.FREQUENCY_API_URL || process.env.INTERNAL_API_URL || DEFAULT_API_URL).replace(/\/+$/, '');
}

function getIngestSecret() {
  return String(process.env.BOT_INGEST_SECRET || process.env.INGEST_SECRET || '').trim();
}

function isEnabled() {
  return process.env.FREQUENCY_DASHBOARD_SYNC !== 'false' && Boolean(getIngestSecret());
}

function getDisabledReason() {
  if (process.env.FREQUENCY_DASHBOARD_SYNC === 'false') {
    return 'FREQUENCY_DASHBOARD_SYNC=false';
  }
  if (!getIngestSecret()) {
    return 'INGEST_SECRET/BOT_INGEST_SECRET ausente';
  }
  return 'configuracao incompleta';
}

async function resolveDiscordUser(member) {
  const cached = discordProfileCache.get(member.user.id);
  if (cached && Date.now() - cached.cachedAt < DISCORD_PROFILE_CACHE_MS) return cached.user;

  const fetched = await member.client?.users?.fetch?.(member.user.id, { force: true }).catch(() => null);
  const user = fetched || member.user;
  discordProfileCache.set(member.user.id, { user, cachedAt: Date.now() });
  return user;
}

async function mapMember(member) {
  const user = await resolveDiscordUser(member);
  const roles = member.roles?.cache
    ? Array.from(member.roles.cache.values())
        .filter((role) => role.id !== member.guild.id)
        .map((role) => ({ id: role.id, name: role.name }))
    : [];
  const globalName = user?.globalName || member.user?.globalName || null;

  return {
    guildId: member.guild.id,
    discordUserId: member.user.id,
    username: user?.username || member.user.username,
    globalName,
    displayName: member.displayName || globalName || user?.username || member.user.username,
    avatarUrl: member.displayAvatarURL?.({ size: 128, extension: 'png', forceStatic: true })
      || user?.displayAvatarURL?.({ size: 128, extension: 'png', forceStatic: true })
      || null,
    bannerUrl: user?.bannerURL?.({ size: 512, extension: 'png' }) || null,
    highestRoleId: member.roles?.highest?.id || null,
    highestRoleName: member.roles?.highest?.name || null,
    roles,
    joinedAt: member.joinedAt?.toISOString?.() || null,
    status: 'active',
    lastSeenAt: new Date().toISOString(),
  };
}

async function postToFrequencyApi(path, payload) {
  if (!isEnabled()) return null;
  const response = await fetch(`${getApiUrl()}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Ingest-Secret': getIngestSecret(),
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({ ok: false, error: 'Invalid API response' }));
  if (!response.ok || !data.ok) {
    throw new Error(data.error || `Frequency API error ${response.status}`);
  }
  return data;
}

function getPrimaryGuilds(client) {
  return client.guilds.cache.filter((guild) => isPrimaryGuild(guild.id));
}

async function syncGuildMembers(client) {
  if (!isEnabled()) return { skipped: true };
  let total = 0;
  for (const guild of getPrimaryGuilds(client).values()) {
    const members = await guild.members.fetch().catch(() => guild.members.cache);
    const payload = await Promise.all(Array.from(members.values())
      .filter((member) => !member.user?.bot && hasRegisteredProfile(guild.id, member.id))
      .map(mapMember));

    for (let index = 0; index < payload.length; index += MEMBER_CHUNK_SIZE) {
      const chunk = payload.slice(index, index + MEMBER_CHUNK_SIZE);
      await postToFrequencyApi('/ingest/members', { members: chunk });
    }
    total += payload.length;
  }
  logger.info(`Frequency dashboard: ${total} membro(s) sincronizado(s).`);
  return { total };
}

function queuePointSnapshotSync(client, delayMs = 1500) {
  return queueMemberSync(client, delayMs);
}

function queueMemberSync(client, delayMs = 1500) {
  if (memberSyncQueued) return;
  memberSyncQueued = true;
  setTimeout(() => {
    memberSyncQueued = false;
    runMemberSyncScheduled(client);
  }, Math.max(1000, Number(delayMs) || 1500));
}

function buildCityPresenceDetails(presence) {
  try {
    const { extractCityName, getTargetFiveMActivity } = require('./fivemActivityAlertManager');
    const activity = getTargetFiveMActivity(presence);
    return {
      cityOnline: Boolean(activity),
      cityName: activity ? extractCityName(activity) : null,
      activityName: activity?.name || null,
      activityDetails: activity?.details || null,
      activityState: activity?.state || null,
    };
  } catch {
    return {};
  }
}

async function syncPresence(newPresence, cityDetails = null) {
  if (!isEnabled() || !newPresence?.guild || !newPresence.userId) return null;
  if (!isPrimaryGuild(newPresence.guild.id)) return null;
  if (!hasRegisteredProfile(newPresence.guild.id, newPresence.userId)) return null;
  const details = cityDetails || buildCityPresenceDetails(newPresence);
  return postToFrequencyApi('/ingest/presence', {
    guildId: newPresence.guild.id,
    discordUserId: newPresence.userId,
    seenAt: new Date().toISOString(),
    ...(details || {}),
  }).catch(() => null);
}

async function syncGuildCityPresences(guild) {
  const presences = guild.presences?.cache;
  if (!presences?.size) return 0;

  let total = 0;
  for (const presence of presences.values()) {
    if (!presence?.userId || presence.user?.bot) continue;
    if (!hasRegisteredProfile(guild.id, presence.userId)) continue;
    await syncPresence(presence, buildCityPresenceDetails(presence));
    total += 1;
  }
  return total;
}

function runMemberSyncScheduled(client) {
  if (memberSyncRunning) return;
  memberSyncRunning = true;
  syncGuildMembers(client)
    .catch((error) => {
      logger.warn('Falha ao sincronizar membros com o dashboard:', error.message);
      queueMemberSync(client, 60 * 1000);
    })
    .finally(() => {
      memberSyncRunning = false;
    });
}

function initFrequencyDashboardSync(client) {
  if (!isEnabled()) {
    logger.info(`Frequency dashboard sync desativado: ${getDisabledReason()}.`);
    return;
  }
  if (intervalsStarted) return;
  intervalsStarted = true;

  setTimeout(() => {
    runMemberSyncScheduled(client);
  }, 10 * 1000);

  setInterval(() => {
    runMemberSyncScheduled(client);
  }, MEMBER_SYNC_INTERVAL_MS);

}

module.exports = {
  initFrequencyDashboardSync,
  queueMemberSync,
  queuePointSnapshotSync,
  syncGuildCityPresences,
  syncGuildMembers,
  syncPresence,
};
