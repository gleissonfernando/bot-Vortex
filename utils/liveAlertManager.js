const fs = require('fs');
const path = require('path');
const { ActivityType, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const config = require('../config/config');

const DATA_PATH = path.join(__dirname, '..', 'commands', 'liveLinks.json');
const ALERT_CHANNEL_ID = '1202251715865489459';
const TWITCH_POLL_INTERVAL_MS = 60_000;
const activeStreams = new Set();
const twitchOnlineStreams = new Set();
let twitchToken = null;
let twitchTokenExpiresAt = 0;
let twitchPollTimer = null;
let twitchPollRunning = false;

function loadLiveLinks() {
  try {
    if (!fs.existsSync(DATA_PATH)) return {};
    return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveLiveLinks(data) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
}

function getGuildConfig(guildId) {
  const data = loadLiveLinks();
  return data[String(guildId)] || {};
}

function getAllLiveLinks() {
  return loadLiveLinks();
}

function getLiveLink(guildId, userId) {
  const guildConfig = getGuildConfig(guildId);
  return guildConfig[String(userId)]?.url || null;
}

function parseTwitchLogin(url) {
  try {
    const parsed = new URL(String(url).trim());
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (hostname !== 'twitch.tv' && hostname !== 'm.twitch.tv') return null;

    const [login] = parsed.pathname.split('/').filter(Boolean);
    if (!login || ['directory', 'downloads', 'jobs', 'p', 'popout', 'settings', 'subscriptions', 'turbo', 'videos'].includes(login.toLowerCase())) {
      return null;
    }

    return /^[a-z0-9_]{3,25}$/i.test(login) ? login.toLowerCase() : null;
  } catch {
    return null;
  }
}

function setLiveLink(guildId, userId, url, updatedBy) {
  const data = loadLiveLinks();
  const guildKey = String(guildId);
  const userKey = String(userId);
  if (!data[guildKey]) data[guildKey] = {};

  const twitchLogin = parseTwitchLogin(url);
  data[guildKey][userKey] = {
    url,
    platform: twitchLogin ? 'twitch' : 'other',
    twitchLogin,
    updatedBy: String(updatedBy),
    updatedAt: new Date().toISOString(),
  };
  saveLiveLinks(data);
  return data[guildKey][userKey];
}

function removeLiveLink(guildId, userId) {
  const data = loadLiveLinks();
  const guildKey = String(guildId);
  const userKey = String(userId);
  if (!data[guildKey]?.[userKey]) return false;

  delete data[guildKey][userKey];
  if (Object.keys(data[guildKey]).length === 0) delete data[guildKey];
  saveLiveLinks(data);
  return true;
}

function isValidLiveUrl(value) {
  return /^https?:\/\/\S+\.\S+/i.test(String(value || '').trim());
}

function getStreamingActivity(presence) {
  return presence?.activities?.find((activity) => activity.type === ActivityType.Streaming) || null;
}

function getStreamPlace(activity, fallback = 'Live') {
  return [
    activity?.name,
    activity?.details,
    activity?.state,
  ].filter(Boolean).join(' | ') || fallback;
}

function getTwitchConfig() {
  return {
    clientId: config.twitchClientId || process.env.TWITCH_CLIENT_ID,
    clientSecret: config.twitchClientSecret || process.env.TWITCH_CLIENT_SECRET,
  };
}

async function getTwitchAppToken() {
  const { clientId, clientSecret } = getTwitchConfig();
  if (!clientId || !clientSecret) return null;

  if (twitchToken && Date.now() < twitchTokenExpiresAt - 60_000) {
    return twitchToken;
  }

  const response = await axios.post('https://id.twitch.tv/oauth2/token', null, {
    params: {
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
    },
    timeout: 15_000,
  });

  twitchToken = response.data?.access_token || null;
  const expiresInMs = Number(response.data?.expires_in || 0) * 1000;
  twitchTokenExpiresAt = Date.now() + Math.max(expiresInMs, 0);
  return twitchToken;
}

async function fetchTwitchStreams(logins) {
  const uniqueLogins = [...new Set(logins.map(String).map((login) => login.toLowerCase()).filter(Boolean))];
  if (uniqueLogins.length === 0) return new Map();

  const token = await getTwitchAppToken();
  const { clientId } = getTwitchConfig();
  if (!token || !clientId) return new Map();

  const streams = new Map();
  for (let index = 0; index < uniqueLogins.length; index += 100) {
    const batch = uniqueLogins.slice(index, index + 100);
    const params = new URLSearchParams();
    for (const login of batch) params.append('user_login', login);

    const response = await axios.get(`https://api.twitch.tv/helix/streams?${params.toString()}`, {
      headers: {
        'Client-ID': clientId,
        Authorization: `Bearer ${token}`,
      },
      timeout: 15_000,
    });

    for (const stream of response.data?.data || []) {
      streams.set(String(stream.user_login).toLowerCase(), stream);
    }
  }

  return streams;
}

function buildLivePanelEmbed(interaction, link) {
  return new EmbedBuilder()
    .setColor('#9146FF')
    .setAuthor({
      name: 'VORTEX | Alerta de Live',
      iconURL: interaction.client.user.displayAvatarURL(),
    })
    .setTitle('Painel de live')
    .setDescription('Configure o link da sua live para o bot avisar automaticamente quando você começar a transmitir.')
    .addFields(
      { name: 'Usuário', value: `<@${interaction.user.id}>`, inline: true },
      { name: 'Canal de alerta', value: `<#${ALERT_CHANNEL_ID}>`, inline: true },
      { name: 'Link cadastrado', value: link || '`Nenhum link cadastrado`', inline: false },
    )
    .setFooter({ text: 'Vortex Live Alerts' })
    .setTimestamp();
}

function buildLiveAlertEmbed({ member, user, activity, link, place }) {
  const displayName = member?.displayName || user.username;
  const streamPlace = place || getStreamPlace(activity);
  const activityUrl = activity?.url && activity.url !== link ? activity.url : null;

  const embed = new EmbedBuilder()
    .setColor('#9146FF')
    .setAuthor({
      name: 'VORTEX | Live iniciada',
      iconURL: user.displayAvatarURL(),
    })
    .setTitle(`${displayName} está em live`)
    .setDescription([
      `<@${user.id}> começou uma transmissão.`,
      '',
      `**Link:** ${link}`,
      `**Onde:** ${streamPlace}`,
      activityUrl ? `**Detectado pelo Discord:** ${activityUrl}` : null,
    ].filter(Boolean).join('\n'))
    .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 256 }))
    .setFooter({ text: 'Vortex Live Alerts' })
    .setTimestamp();

  return embed;
}

async function sendLiveAlert({ guild, user, member, activity = null, place = null }) {
  if (!guild || !user || user.bot) return false;

  const guildId = guild.id;
  const userId = user.id;
  const streamKey = `${guildId}:${userId}`;
  if (activeStreams.has(streamKey)) return false;

  const link = getLiveLink(guildId, userId);
  if (!link) {
    activeStreams.add(streamKey);
    return false;
  }

  const channel = await guild.channels.fetch(ALERT_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased?.()) {
    console.warn(`[LIVE ALERT] Canal de alerta invalido ou inacessivel: ${ALERT_CHANNEL_ID}`);
    activeStreams.add(streamKey);
    return false;
  }

  const guildMember = member || await guild.members.fetch(userId).catch(() => null);

  await channel.send({
    content: `<@${userId}> está fazendo live: ${link}`,
    embeds: [buildLiveAlertEmbed({
      member: guildMember,
      user,
      activity,
      link,
      place,
    })],
    allowedMentions: { users: [userId] },
  }).catch((error) => {
    console.warn(`[LIVE ALERT] Falha ao enviar alerta de live de ${userId}: ${error.message}`);
    return null;
  });

  activeStreams.add(streamKey);
  return true;
}

async function sendTwitchLiveAlert(client, { guildId, userId, link, stream }) {
  const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return false;

  const user = await client.users.fetch(userId).catch(() => null);
  if (!user) return false;

  const member = await guild.members.fetch(userId).catch(() => null);
  const category = stream.game_name ? `Twitch | ${stream.game_name}` : 'Twitch';
  return sendLiveAlert({
    guild,
    user,
    member,
    link,
    place: category,
  });
}

function getConfiguredTwitchTargets() {
  const data = getAllLiveLinks();
  const targets = [];

  for (const [guildId, guildConfig] of Object.entries(data)) {
    for (const [userId, entry] of Object.entries(guildConfig || {})) {
      const twitchLogin = entry?.twitchLogin || parseTwitchLogin(entry?.url);
      if (!twitchLogin || !entry?.url) continue;
      targets.push({
        guildId,
        userId,
        link: entry.url,
        twitchLogin,
      });
    }
  }

  return targets;
}

async function pollTwitchLiveAlerts(client) {
  if (twitchPollRunning) return;
  twitchPollRunning = true;

  try {
    const targets = getConfiguredTwitchTargets();
    if (targets.length === 0) return;

    const streams = await fetchTwitchStreams(targets.map((target) => target.twitchLogin));
    for (const target of targets) {
      const streamKey = `${target.guildId}:${target.userId}:twitch:${target.twitchLogin}`;
      const stream = streams.get(target.twitchLogin);

      if (!stream) {
        twitchOnlineStreams.delete(streamKey);
        activeStreams.delete(`${target.guildId}:${target.userId}`);
        continue;
      }

      if (twitchOnlineStreams.has(streamKey)) continue;

      await sendTwitchLiveAlert(client, {
        guildId: target.guildId,
        userId: target.userId,
        link: target.link,
        stream,
      });
      twitchOnlineStreams.add(streamKey);
    }
  } catch (error) {
    console.warn(`[LIVE ALERT] Falha ao consultar Twitch: ${error.message}`);
  } finally {
    twitchPollRunning = false;
  }
}

function initTwitchLiveMonitor(client) {
  const { clientId, clientSecret } = getTwitchConfig();
  if (!clientId || !clientSecret) {
    console.warn('[LIVE ALERT] TWITCH_CLIENT_ID/TWITCH_CLIENT_SECRET ausentes. Monitor da Twitch desativado.');
    return;
  }

  if (twitchPollTimer) clearInterval(twitchPollTimer);
  pollTwitchLiveAlerts(client).catch(() => null);
  twitchPollTimer = setInterval(() => {
    pollTwitchLiveAlerts(client).catch(() => null);
  }, TWITCH_POLL_INTERVAL_MS);
}

async function handlePresenceLiveAlert(oldPresence, newPresence) {
  if (!newPresence?.guild || !newPresence.user || newPresence.user.bot) return;

  const guildId = newPresence.guild.id;
  const userId = newPresence.user.id;
  const streamKey = `${guildId}:${userId}`;
  const oldStreaming = getStreamingActivity(oldPresence);
  const newStreaming = getStreamingActivity(newPresence);

  if (!newStreaming) {
    activeStreams.delete(streamKey);
    return;
  }

  if (oldStreaming) {
    activeStreams.add(streamKey);
    return;
  }

  await sendLiveAlert({
    guild: newPresence.guild,
    user: newPresence.user,
    member: newPresence.member,
    activity: newStreaming,
  });
}

async function handleVoiceLiveAlert(oldState, newState) {
  const guild = newState?.guild;
  const member = newState?.member;
  const user = member?.user;
  if (!guild || !member || !user || user.bot) return;

  const guildId = guild.id;
  const userId = user.id;
  const streamKey = `${guildId}:${userId}`;
  const wasStreaming = Boolean(oldState?.streaming);
  const isStreaming = Boolean(newState?.streaming);

  if (!isStreaming) {
    activeStreams.delete(streamKey);
    return;
  }

  if (wasStreaming) {
    activeStreams.add(streamKey);
    return;
  }

  const voiceChannel = newState.channel;
  await sendLiveAlert({
    guild,
    user,
    member,
    place: voiceChannel ? `<#${voiceChannel.id}>` : 'Call do Discord',
  });
}

module.exports = {
  ALERT_CHANNEL_ID,
  buildLivePanelEmbed,
  getLiveLink,
  handlePresenceLiveAlert,
  handleVoiceLiveAlert,
  initTwitchLiveMonitor,
  isValidLiveUrl,
  parseTwitchLogin,
  removeLiveLink,
  setLiveLink,
};
