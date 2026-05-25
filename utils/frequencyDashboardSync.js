const { listGuildPoints } = require('./pontoManager');
const { isPrimaryGuild } = require('./guildScope');
const { logger } = require('./logger');

const DEFAULT_API_URL = 'http://127.0.0.1:4100';
const MEMBER_CHUNK_SIZE = 100;
const SESSION_CHUNK_SIZE = 150;
const MEMBER_SYNC_INTERVAL_MS = Math.max(5 * 60 * 1000, Number(process.env.FREQUENCY_MEMBER_SYNC_INTERVAL_MS || 15 * 60 * 1000));
const POINT_SYNC_INTERVAL_MS = Math.max(30 * 1000, Number(process.env.FREQUENCY_POINT_SYNC_INTERVAL_MS || 60 * 1000));
let intervalsStarted = false;
let pointSyncQueued = false;
let memberSyncRunning = false;
let pointSyncRunning = false;

function getApiUrl() {
  return String(process.env.FREQUENCY_API_URL || process.env.INTERNAL_API_URL || DEFAULT_API_URL).replace(/\/+$/, '');
}

function getIngestSecret() {
  return String(process.env.BOT_INGEST_SECRET || process.env.INGEST_SECRET || '').trim();
}

function isEnabled() {
  return process.env.FREQUENCY_DASHBOARD_SYNC !== 'false' && Boolean(getIngestSecret());
}

function mapMember(member) {
  const roles = member.roles?.cache
    ? Array.from(member.roles.cache.values())
        .filter((role) => role.id !== member.guild.id)
        .map((role) => ({ id: role.id, name: role.name }))
    : [];

  return {
    guildId: member.guild.id,
    discordUserId: member.user.id,
    username: member.user.username,
    displayName: member.displayName || member.user.username,
    avatarUrl: member.user.displayAvatarURL?.({ size: 128, extension: 'png', forceStatic: true }) || null,
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
    const payload = Array.from(members.values())
      .filter((member) => !member.user?.bot)
      .map(mapMember);

    for (let index = 0; index < payload.length; index += MEMBER_CHUNK_SIZE) {
      const chunk = payload.slice(index, index + MEMBER_CHUNK_SIZE);
      await postToFrequencyApi('/ingest/members', { members: chunk });
    }
    total += payload.length;
  }
  logger.info(`Frequency dashboard: ${total} membro(s) sincronizado(s).`);
  return { total };
}

function buildSessionId(guildId, userId, startedAt, closedAt, index = 0) {
  return [
    'vortex',
    String(guildId).replace(/\D/g, ''),
    String(userId).replace(/\D/g, ''),
    String(startedAt || '').replace(/[^a-zA-Z0-9]/g, ''),
    String(closedAt || 'open').replace(/[^a-zA-Z0-9]/g, ''),
    index,
  ].join('-').slice(0, 180);
}

function pointSessionsFromRecord(point) {
  const sessions = [];
  const guildId = String(point.guildId);
  const userId = String(point.userId);

  for (const [index, session] of (point.sessions || []).entries()) {
    if (!session?.startedAt) continue;
    sessions.push({
      id: String(session.pointId || buildSessionId(guildId, userId, session.startedAt, session.closedAt, index)),
      guildId,
      discordUserId: userId,
      openedAt: session.startedAt,
      closedAt: session.closedAt || null,
      totalSeconds: Math.max(0, Math.floor(Number(session.durationMs || 0) / 1000)),
      source: session.source || point.activePointSource || 'vortex-point',
      openedBy: session.openedBy || userId,
      closedBy: session.closedBy || session.correctedBy || session.adjustedBy || userId,
      note: session.reason || session.serverName || null,
    });
  }

  if (point.activePointStartedAt) {
    sessions.push({
      id: String(point.activePointId || buildSessionId(guildId, userId, point.activePointStartedAt, 'open')),
      guildId,
      discordUserId: userId,
      openedAt: point.activePointStartedAt,
      closedAt: null,
      totalSeconds: 0,
      source: point.activePointSource || 'vortex-point',
      openedBy: userId,
      closedBy: null,
      note: point.activePointReason || point.activePointServerName || null,
    });
  }

  return sessions;
}

async function syncPointSnapshot(client) {
  if (!isEnabled()) return { skipped: true };
  let total = 0;
  for (const guild of getPrimaryGuilds(client).values()) {
    const points = await listGuildPoints(guild.id);
    const membersById = new Map();
    const sessions = points.flatMap(pointSessionsFromRecord);

    for (const point of points) {
      const member = guild.members.cache.get(point.userId)
        || await guild.members.fetch(point.userId).catch(() => null);
      if (member && !member.user?.bot) membersById.set(member.id, mapMember(member));
    }

    for (let index = 0; index < sessions.length; index += SESSION_CHUNK_SIZE) {
      const chunk = sessions.slice(index, index + SESSION_CHUNK_SIZE);
      const memberIds = new Set(chunk.map((item) => item.discordUserId));
      const members = Array.from(membersById.values()).filter((member) => memberIds.has(member.discordUserId));
      await postToFrequencyApi('/ingest/point-snapshot', { members, sessions: chunk });
    }
    total += sessions.length;
  }
  logger.info(`Frequency dashboard: ${total} sessao(oes) de ponto sincronizada(s).`);
  return { total };
}

function queuePointSnapshotSync(client) {
  if (pointSyncQueued) return;
  pointSyncQueued = true;
  setTimeout(() => {
    pointSyncQueued = false;
    runPointSyncScheduled(client);
  }, 1500);
}

async function syncPresence(newPresence) {
  if (!isEnabled() || !newPresence?.guild || !newPresence.userId) return null;
  if (!isPrimaryGuild(newPresence.guild.id)) return null;
  return postToFrequencyApi('/ingest/presence', {
    guildId: newPresence.guild.id,
    discordUserId: newPresence.userId,
    seenAt: new Date().toISOString(),
  }).catch(() => null);
}

function runMemberSyncScheduled(client) {
  if (memberSyncRunning) return;
  memberSyncRunning = true;
  syncGuildMembers(client)
    .catch((error) => logger.warn('Falha ao sincronizar membros com o dashboard:', error.message))
    .finally(() => {
      memberSyncRunning = false;
    });
}

function runPointSyncScheduled(client) {
  if (pointSyncRunning) return;
  pointSyncRunning = true;
  syncPointSnapshot(client)
    .catch((error) => logger.warn('Falha ao sincronizar pontos com o dashboard:', error.message))
    .finally(() => {
      pointSyncRunning = false;
    });
}

function initFrequencyDashboardSync(client) {
  if (!isEnabled()) {
    logger.warn('Frequency dashboard sync desativado: INGEST_SECRET/BOT_INGEST_SECRET ausente.');
    return;
  }
  if (intervalsStarted) return;
  intervalsStarted = true;

  setTimeout(() => {
    runMemberSyncScheduled(client);
    runPointSyncScheduled(client);
  }, 10 * 1000);

  setInterval(() => {
    runMemberSyncScheduled(client);
  }, MEMBER_SYNC_INTERVAL_MS);

  setInterval(() => {
    runPointSyncScheduled(client);
  }, POINT_SYNC_INTERVAL_MS);
}

module.exports = {
  initFrequencyDashboardSync,
  queuePointSnapshotSync,
  syncGuildMembers,
  syncPointSnapshot,
  syncPresence,
};
