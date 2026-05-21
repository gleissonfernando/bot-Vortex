const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { EmbedBuilder } = require('discord.js');
const { logger } = require('./logger');
const { isMongoConnected } = require('./database');

const STORE_PATH = path.join(__dirname, '..', 'commands', 'liveAlerts.json');
const DEFAULT_MESSAGE = '🔴 {streamer} está ao vivo!\n\n🎮 Plataforma: {platform}\n📺 Título da live: {title}\n👤 Streamer: {streamer}\n🔗 Assistir agora: {url}';
const DEFAULT_INTERVAL_SECONDS = 120;
const MIN_INTERVAL_MS = 30 * 1000;
let monitorInterval = null;
let twitchTokenCache = null;
const lastGuildCheckAt = new Map();

function databaseNameFromUri(uri) {
  const withoutQuery = String(uri || '').split('?')[0] || '';
  const withoutScheme = withoutQuery.replace(/^mongodb(?:\+srv)?:\/\//i, '');
  const slashIndex = withoutScheme.indexOf('/');
  const pathname = slashIndex >= 0 ? withoutScheme.slice(slashIndex + 1).trim() : '';
  return decodeURIComponent(pathname) || 'vortex_frequency';
}

function ensureStore() {
  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(STORE_PATH, `${JSON.stringify({ lives: [], settings: {} }, null, 2)}\n`, 'utf8');
  }
}

function readStore() {
  ensureStore();
  try {
    const data = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8') || '{}');
    return {
      lives: Array.isArray(data.lives) ? data.lives : [],
      settings: data.settings && typeof data.settings === 'object' ? data.settings : {},
    };
  } catch {
    return { lives: [], settings: {} };
  }
}

function writeStore(data) {
  ensureStore();
  fs.writeFileSync(STORE_PATH, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function mongoCollection(name) {
  if (!isMongoConnected() || !mongoose.connection.db) return null;
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DATABASE_URL || '';
  const dbName = process.env.MONGODB_DB || databaseNameFromUri(uri);
  return mongoose.connection.client.db(dbName).collection(name);
}

function detectPlatform(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes('twitch.tv')) return 'twitch';
    if (host.includes('youtube.com') || host.includes('youtu.be')) return 'youtube';
    if (host.includes('kick.com')) return 'kick';
  } catch {}
  return 'custom';
}

function extractSlug(url) {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parsed.hostname.includes('youtu.be')) return parts[0] || '';
    if (parsed.hostname.includes('youtube.com') && parts[0] === '@') return parts[0] || '';
    return parts[0] || '';
  } catch {
    return '';
  }
}

function normalizeLive(row) {
  return {
    id: String(row._id || row.id || row.localId || `${row.guild_id || row.guildId}:${row.url}`),
    guildId: String(row.guild_id || row.guildId || 'global'),
    platform: String(row.platform || detectPlatform(row.url || 'custom')),
    url: String(row.url || ''),
    streamerName: String(row.streamer_name || row.streamerName || extractSlug(row.url || '') || 'Streamer'),
    alertChannelId: row.alert_channel_id || row.alertChannelId || null,
    mentionRoleId: row.mention_role_id || row.mentionRoleId || null,
    enabled: row.enabled !== false,
    customMessage: row.custom_message || row.customMessage || null,
    status: row.status || 'unknown',
    lastAnnouncedLiveId: row.last_announced_live_id || row.lastAnnouncedLiveId || null,
    lastLiveTitle: row.last_live_title || row.lastLiveTitle || null,
    lastLiveUrl: row.last_live_url || row.lastLiveUrl || null,
    twitchUserId: row.twitch_user_id || row.twitchUserId || null,
    twitchLogin: row.twitch_login || row.twitchLogin || null,
    avatarUrl: row.avatar_url || row.avatarUrl || null,
  };
}

function normalizeSettings(row = {}) {
  return {
    guildId: String(row.guild_id || row.guildId || 'global'),
    enabled: row.enabled !== false,
    defaultAlertChannelId: row.default_alert_channel_id || row.defaultAlertChannelId || null,
    defaultMentionRoleId: row.default_mention_role_id || row.defaultMentionRoleId || null,
    defaultMessage: row.default_message || row.defaultMessage || DEFAULT_MESSAGE,
    checkIntervalSeconds: Number(row.check_interval_seconds || row.checkIntervalSeconds || DEFAULT_INTERVAL_SECONDS),
  };
}

async function listLiveAlerts(guildId = null) {
  const collection = mongoCollection('live_alert_configs');
  if (collection) {
    const query = guildId ? { guild_id: String(guildId) } : {};
    const rows = await collection.find(query).sort({ created_at: -1 }).toArray();
    return rows.map(normalizeLive);
  }
  const store = readStore();
  return store.lives.map(normalizeLive).filter((row) => !guildId || row.guildId === String(guildId));
}

async function getLiveSettings(guildId) {
  const collection = mongoCollection('live_alert_settings');
  if (collection) {
    const row = await collection.findOne({ guild_id: String(guildId) });
    return normalizeSettings(row || { guild_id: String(guildId) });
  }
  const store = readStore();
  return normalizeSettings(store.settings[String(guildId)] || { guildId });
}

async function saveLiveSettings(guildId, patch) {
  const current = await getLiveSettings(guildId);
  const next = { ...current, ...patch, guildId: String(guildId) };
  const collection = mongoCollection('live_alert_settings');
  if (collection) {
    await collection.updateOne(
      { guild_id: String(guildId) },
      {
        $set: {
          guild_id: String(guildId),
          enabled: next.enabled !== false,
          default_alert_channel_id: next.defaultAlertChannelId || null,
          default_mention_role_id: next.defaultMentionRoleId || null,
          default_message: next.defaultMessage || DEFAULT_MESSAGE,
          check_interval_seconds: next.checkIntervalSeconds || DEFAULT_INTERVAL_SECONDS,
          updated_at: new Date(),
        },
        $setOnInsert: { created_at: new Date() },
      },
      { upsert: true }
    );
  } else {
    const store = readStore();
    store.settings[String(guildId)] = next;
    writeStore(store);
  }
  return next;
}

async function createLiveAlert(guildId, input) {
  const now = new Date();
  const doc = {
    guild_id: String(guildId),
    platform: input.platform || detectPlatform(input.url),
    url: String(input.url || '').trim(),
    streamer_name: String(input.streamerName || input.streamer_name || extractSlug(input.url) || 'Streamer').trim(),
    alert_channel_id: input.alertChannelId || input.alert_channel_id || null,
    mention_role_id: input.mentionRoleId || input.mention_role_id || null,
    enabled: input.enabled !== false,
    custom_message: input.customMessage || input.custom_message || null,
    status: 'unknown',
    last_live_title: null,
    last_live_url: null,
    last_announced_live_id: null,
    last_checked_at: null,
    created_at: now,
    updated_at: now,
  };
  const collection = mongoCollection('live_alert_configs');
  if (collection) {
    const result = await collection.insertOne(doc);
    return normalizeLive({ ...doc, _id: result.insertedId });
  }
  const store = readStore();
  const row = { ...doc, localId: `${Date.now()}-${Math.random().toString(16).slice(2)}` };
  store.lives.unshift(row);
  writeStore(store);
  return normalizeLive(row);
}

async function updateLiveAlertStatus(live, patch) {
  const collection = mongoCollection('live_alert_configs');
  const update = {
    status: patch.status || live.status || 'unknown',
    last_live_title: patch.lastLiveTitle || null,
    last_live_url: patch.lastLiveUrl || null,
    last_announced_live_id: patch.lastAnnouncedLiveId ?? live.lastAnnouncedLiveId ?? null,
    last_checked_at: new Date(),
    updated_at: new Date(),
  };
  if (collection && /^[a-f\d]{24}$/i.test(live.id)) {
    await collection.updateOne({ _id: new mongoose.Types.ObjectId(live.id) }, { $set: update });
    return;
  }
  const store = readStore();
  store.lives = store.lives.map((row) => {
    const normalized = normalizeLive(row);
    if (normalized.id !== live.id) return row;
    return { ...row, ...update };
  });
  writeStore(store);
}

async function getTwitchToken() {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  if (twitchTokenCache && twitchTokenCache.expiresAt > Date.now() + 60_000) return twitchTokenCache.token;
  const response = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
    }),
  });
  if (!response.ok) return null;
  const data = await response.json();
  twitchTokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + Math.max(60, Number(data.expires_in || 3600) - 60) * 1000,
  };
  return twitchTokenCache.token;
}

async function getTwitchUserByLogin(login) {
  const token = await getTwitchToken();
  const clientId = process.env.TWITCH_CLIENT_ID;
  if (!token || !clientId || !login) return null;
  const response = await fetch(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(login)}`, {
    headers: { 'Client-ID': clientId, Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return null;
  const data = await response.json();
  return Array.isArray(data.data) ? data.data[0] || null : null;
}

async function checkTwitchLive(live) {
  const token = await getTwitchToken();
  const clientId = process.env.TWITCH_CLIENT_ID;
  let userId = live.twitchUserId;
  const login = live.twitchLogin || extractSlug(live.url);
  if (!userId && login) {
    const user = await getTwitchUserByLogin(login);
    userId = user?.id || null;
  }
  if (!token || !clientId || (!userId && !login)) return { online: false };
  const query = userId
    ? `user_id=${encodeURIComponent(userId)}`
    : `user_login=${encodeURIComponent(login)}`;
  const response = await fetch(`https://api.twitch.tv/helix/streams?${query}`, {
    headers: { 'Client-ID': clientId, Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return { online: false };
  const data = await response.json();
  const stream = Array.isArray(data.data) ? data.data[0] : null;
  if (!stream) return { online: false };
  return {
    online: true,
    liveId: String(stream.id || `${userId || login}:${stream.started_at || ''}`),
    title: stream.title || 'Live na Twitch',
    game: stream.game_name || null,
    viewerCount: Number(stream.viewer_count || 0),
    thumbnailUrl: stream.thumbnail_url || null,
    url: live.url,
  };
}

async function checkKickLive(live) {
  const slug = extractSlug(live.url);
  if (!slug) return { online: false };
  const response = await fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`, {
    headers: { 'User-Agent': 'VortexLiveAlerts/1.0' },
  }).catch(() => null);
  if (!response?.ok) return { online: false };
  const data = await response.json().catch(() => ({}));
  const livestream = data.livestream || data.current_livestream;
  if (!livestream) return { online: false };
  return {
    online: true,
    liveId: String(livestream.id || `${slug}:${livestream.created_at || livestream.start_time || ''}`),
    title: livestream.session_title || livestream.title || 'Live na Kick',
    url: live.url,
  };
}

async function checkPageLive(live) {
  const response = await fetch(live.url, { headers: { 'User-Agent': 'VortexLiveAlerts/1.0' } }).catch(() => null);
  if (!response?.ok) return { online: false };
  const html = await response.text();
  const online = /isLiveNow|watching now|LIVE|ao vivo|is_live|livestream/i.test(html);
  const title = (html.match(/<title[^>]*>([^<]+)/i)?.[1] || 'Live').replace(/\s+/g, ' ').trim();
  return online ? { online: true, liveId: `${live.url}:${title}`, title, url: live.url } : { online: false };
}

async function checkLiveStatus(live) {
  if (live.platform === 'twitch') return checkTwitchLive(live);
  if (live.platform === 'kick') return checkKickLive(live);
  return checkPageLive(live);
}

function renderMessage(template, live, status) {
  return String(template || DEFAULT_MESSAGE)
    .replaceAll('{streamer}', live.streamerName)
    .replaceAll('{platform}', live.platform)
    .replaceAll('{title}', status.title || 'Live da Vortex')
    .replaceAll('{url}', status.url || live.url);
}

async function sendLiveAlert(client, live, settings, status, { test = false } = {}) {
  const channelId = live.alertChannelId || settings.defaultAlertChannelId;
  if (!channelId) return { ok: false, error: 'Canal nao configurado.' };
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return { ok: false, error: 'Canal invalido.' };
  const roleId = live.mentionRoleId || settings.defaultMentionRoleId;
  const content = [roleId ? `<@&${roleId}>` : null, renderMessage(live.customMessage || settings.defaultMessage, live, status)].filter(Boolean).join('\n\n');
  const embed = new EmbedBuilder()
    .setColor(test ? '#7C3AED' : '#ED4245')
    .setAuthor({ name: 'VORTEX | Live Alerts' })
    .setTitle(test ? 'Teste de alerta de live' : `${live.streamerName} está ao vivo!`)
    .setDescription(`Assista agora: ${status.url || live.url}`)
    .addFields(
      { name: 'Plataforma', value: live.platform, inline: true },
      { name: 'Streamer', value: live.streamerName, inline: true },
      status.game ? { name: 'Categoria', value: String(status.game), inline: true } : { name: 'Status', value: test ? 'Teste' : 'Online', inline: true },
      { name: 'Titulo', value: status.title || 'Live da Vortex', inline: false }
    )
    .setTimestamp();
  if (live.avatarUrl) embed.setThumbnail(live.avatarUrl);
  if (status.thumbnailUrl) {
    embed.setImage(String(status.thumbnailUrl).replace('{width}', '1280').replace('{height}', '720'));
  }
  await channel.send({
    content,
    embeds: [embed],
    allowedMentions: { roles: roleId ? [roleId] : [] },
  });
  return { ok: true };
}

async function runLiveAlertCheck(client) {
  const lives = await listLiveAlerts();
  const settingsCache = new Map();
  const dueGuilds = new Map();
  for (const live of lives) {
    if (!live.enabled) continue;
    const settings = settingsCache.get(live.guildId) || await getLiveSettings(live.guildId);
    settingsCache.set(live.guildId, settings);
    if (!settings.enabled) continue;
    if (!dueGuilds.has(live.guildId)) {
      const intervalMs = Math.max(MIN_INTERVAL_MS, Number(settings.checkIntervalSeconds || DEFAULT_INTERVAL_SECONDS) * 1000);
      const last = lastGuildCheckAt.get(live.guildId) || 0;
      const due = Date.now() - last >= intervalMs;
      dueGuilds.set(live.guildId, due);
      if (due) lastGuildCheckAt.set(live.guildId, Date.now());
    }
    if (!dueGuilds.get(live.guildId)) continue;
    const status = await checkLiveStatus(live).catch((error) => {
      logger.warn(`Lives: falha ao verificar ${live.url}: ${error.message}`);
      return { online: false };
    });
    if (!status.online) {
      await updateLiveAlertStatus(live, {
        status: 'offline',
        lastLiveTitle: null,
        lastLiveUrl: null,
        lastAnnouncedLiveId: null,
      });
      continue;
    }
    const liveId = status.liveId || `${live.url}:${status.title || 'online'}`;
    if (live.lastAnnouncedLiveId !== liveId) {
      await sendLiveAlert(client, live, settings, status).catch((error) => {
        logger.warn(`Lives: falha ao enviar alerta de ${live.streamerName}: ${error.message}`);
      });
    }
    await updateLiveAlertStatus(live, {
      status: 'online',
      lastLiveTitle: status.title || null,
      lastLiveUrl: status.url || live.url,
      lastAnnouncedLiveId: liveId,
    });
  }
}

function initLiveAlertMonitor(client) {
  if (monitorInterval) clearInterval(monitorInterval);
  const intervalMs = Math.max(MIN_INTERVAL_MS, Number(process.env.LIVE_ALERT_CHECK_INTERVAL_MS || MIN_INTERVAL_MS));
  setTimeout(() => runLiveAlertCheck(client).catch((error) => logger.error('Erro no monitor de lives:', error)), 20_000);
  monitorInterval = setInterval(() => {
    runLiveAlertCheck(client).catch((error) => logger.error('Erro no monitor de lives:', error));
  }, intervalMs);
}

module.exports = {
  DEFAULT_MESSAGE,
  createLiveAlert,
  detectPlatform,
  getLiveSettings,
  initLiveAlertMonitor,
  listLiveAlerts,
  runLiveAlertCheck,
  saveLiveSettings,
  sendLiveAlert,
};
