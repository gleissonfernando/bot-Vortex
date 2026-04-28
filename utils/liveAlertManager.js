const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ActivityType, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const config = require('../config/config');

const DATA_PATH = path.join(__dirname, '..', 'commands', 'liveLinks.json');
const ALERT_CHANNEL_ID = '1202251715865489459';
const TWITCH_POLL_INTERVAL_MS = 60_000;
const LIVE_TERMS_BASE_URL = process.env.LIVE_TERMS_BASE_URL || process.env.PUBLIC_BASE_URL || 'https://bot-vortex.shardweb.app';
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

function normalizeLiveEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return { termsAcceptedAt: null, links: [] };
  }

  const links = Array.isArray(entry.links)
    ? entry.links
    : entry.url
      ? [{
          url: entry.url,
          platform: entry.platform,
          twitchLogin: entry.twitchLogin,
          createdAt: entry.updatedAt,
          createdBy: entry.updatedBy,
        }]
      : [];

  return {
    ...entry,
    termsAcceptedAt: entry.termsAcceptedAt || null,
    termsAcceptedBy: entry.termsAcceptedBy || null,
    links: links
      .filter((item) => item?.url)
      .map((item) => {
        const twitchLogin = item.twitchLogin || parseTwitchLogin(item.url);
        return {
          url: item.url,
          platform: twitchLogin ? 'twitch' : item.platform || 'other',
          twitchLogin,
          createdAt: item.createdAt || item.updatedAt || new Date().toISOString(),
          createdBy: item.createdBy || item.updatedBy || null,
        };
      }),
  };
}

function getLiveLink(guildId, userId) {
  return getLiveLinks(guildId, userId)[0]?.url || null;
}

function getLiveLinks(guildId, userId) {
  const guildConfig = getGuildConfig(guildId);
  return normalizeLiveEntry(guildConfig[String(userId)]).links;
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

function getTokenSecret() {
  return config.token || process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN || 'vortex-live-alerts';
}

function signLiveTermsPayload(guildId, userId) {
  return crypto
    .createHmac('sha256', getTokenSecret())
    .update(`${guildId}:${userId}`)
    .digest('hex')
    .slice(0, 32);
}

function buildLiveTermsToken(guildId, userId) {
  const payload = Buffer.from(JSON.stringify({
    guildId: String(guildId),
    userId: String(userId),
    sig: signLiveTermsPayload(guildId, userId),
  })).toString('base64url');
  return payload;
}

function parseLiveTermsToken(token) {
  try {
    const parsed = JSON.parse(Buffer.from(String(token || ''), 'base64url').toString('utf8'));
    if (!parsed.guildId || !parsed.userId || !parsed.sig) return null;
    if (parsed.sig !== signLiveTermsPayload(parsed.guildId, parsed.userId)) return null;
    return {
      guildId: String(parsed.guildId),
      userId: String(parsed.userId),
    };
  } catch {
    return null;
  }
}

function buildLiveTermsUrl(guildId, userId) {
  const token = buildLiveTermsToken(guildId, userId);
  return `${LIVE_TERMS_BASE_URL.replace(/\/$/, '')}/twitch?token=${encodeURIComponent(token)}`;
}

function hasAcceptedLiveTerms(guildId, userId) {
  const guildConfig = getGuildConfig(guildId);
  return Boolean(normalizeLiveEntry(guildConfig[String(userId)]).termsAcceptedAt);
}

function acceptLiveTerms(guildId, userId) {
  const data = loadLiveLinks();
  const guildKey = String(guildId);
  const userKey = String(userId);
  if (!data[guildKey]) data[guildKey] = {};
  const current = normalizeLiveEntry(data[guildKey][userKey]);

  data[guildKey][userKey] = {
    ...current,
    termsAcceptedAt: new Date().toISOString(),
    termsAcceptedBy: userKey,
  };
  saveLiveLinks(data);
  return data[guildKey][userKey];
}

function acceptLiveTermsToken(token) {
  const parsed = parseLiveTermsToken(token);
  if (!parsed) return null;
  acceptLiveTerms(parsed.guildId, parsed.userId);
  return parsed;
}

function setLiveLink(guildId, userId, url, updatedBy) {
  const data = loadLiveLinks();
  const guildKey = String(guildId);
  const userKey = String(userId);
  if (!data[guildKey]) data[guildKey] = {};

  const twitchLogin = parseTwitchLogin(url);
  const current = normalizeLiveEntry(data[guildKey][userKey]);
  const normalizedUrl = String(url).trim();
  const existing = current.links.find((item) => item.url.toLowerCase() === normalizedUrl.toLowerCase());
  if (existing) return existing;

  const nextLink = {
    url: normalizedUrl,
    platform: twitchLogin ? 'twitch' : 'other',
    twitchLogin,
    createdBy: String(updatedBy),
    createdAt: new Date().toISOString(),
  };

  data[guildKey][userKey] = {
    ...current,
    links: [...current.links, nextLink],
    updatedBy: String(updatedBy),
    updatedAt: new Date().toISOString(),
  };

  saveLiveLinks(data);
  return nextLink;
}

function removeLiveLink(guildId, userId) {
  const data = loadLiveLinks();
  const guildKey = String(guildId);
  const userKey = String(userId);
  if (!data[guildKey]?.[userKey]) return false;

  const current = normalizeLiveEntry(data[guildKey][userKey]);
  if (current.links.length === 0) return false;

  data[guildKey][userKey] = {
    ...current,
    links: [],
    updatedAt: new Date().toISOString(),
  };
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

function hasTwitchCredentials() {
  const { clientId, clientSecret } = getTwitchConfig();
  return Boolean(clientId && clientSecret);
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

function formatLiveLinks(links) {
  if (!links.length) return '`Nenhum link cadastrado`';
  return links
    .map((item, index) => `${index + 1}. ${item.url}`)
    .join('\n')
    .slice(0, 1000);
}

function buildLivePanelEmbed(interaction, links = [], termsAccepted = false) {
  return new EmbedBuilder()
    .setColor('#9146FF')
    .setAuthor({
      name: 'VORTEX | Alerta de Live',
      iconURL: interaction.client.user.displayAvatarURL(),
    })
    .setTitle('Painel de live')
    .setDescription(termsAccepted
      ? 'Termos aceitos. Cadastre quantos links de live quiser para o bot avisar automaticamente quando um canal ficar online.'
      : 'Aceite os termos para liberar o cadastro de links de live.')
    .addFields(
      { name: 'Usuário', value: `<@${interaction.user.id}>`, inline: true },
      { name: 'Canal de alerta', value: `<#${ALERT_CHANNEL_ID}>`, inline: true },
      { name: 'Termos', value: termsAccepted ? '`Aceitos`' : '`Pendente`', inline: true },
      { name: 'Links cadastrados', value: formatLiveLinks(links), inline: false },
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

async function sendLiveAlert({ guild, user, member, activity = null, place = null, link = null, streamKeyOverride = null, force = false }) {
  if (!guild || !user || user.bot) return false;

  const guildId = guild.id;
  const userId = user.id;
  const streamKey = streamKeyOverride || `${guildId}:${userId}`;
  if (!force && activeStreams.has(streamKey)) return false;

  const alertLink = link || getLiveLink(guildId, userId);
  if (!alertLink) {
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
    content: `<@${userId}> está fazendo live: ${alertLink}`,
    embeds: [buildLiveAlertEmbed({
      member: guildMember,
      user,
      activity,
      link: alertLink,
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

async function sendTwitchLiveAlert(client, { guildId, userId, link, stream, streamKey, force = false }) {
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
    streamKeyOverride: streamKey,
    force,
  });
}

async function checkUserTwitchLinks(client, guildId, userId, { sendIfOnline = false } = {}) {
  const termsAccepted = hasAcceptedLiveTerms(guildId, userId);
  const links = getLiveLinks(guildId, userId);
  const twitchLinks = links
    .map((link) => ({
      ...link,
      twitchLogin: link.twitchLogin || parseTwitchLogin(link.url),
    }))
    .filter((link) => link.twitchLogin);

  const result = {
    ok: false,
    termsAccepted,
    hasCredentials: hasTwitchCredentials(),
    totalLinks: links.length,
    twitchLinks: twitchLinks.length,
    sent: 0,
    online: [],
    offline: [],
    message: '',
  };

  if (!termsAccepted) {
    result.message = 'Termos ainda nao foram aceitos.';
    return result;
  }

  if (twitchLinks.length === 0) {
    result.message = links.length
      ? 'Nenhum link cadastrado e da Twitch.'
      : 'Nenhum link cadastrado.';
    return result;
  }

  if (!result.hasCredentials) {
    result.message = 'TWITCH_CLIENT_ID/TWITCH_CLIENT_SECRET ausentes no ambiente.';
    return result;
  }

  const streams = await fetchTwitchStreams(twitchLinks.map((link) => link.twitchLogin));
  for (const link of twitchLinks) {
    const stream = streams.get(link.twitchLogin);
    if (!stream) {
      result.offline.push(link);
      continue;
    }

    result.online.push({ link, stream });
    if (sendIfOnline) {
      const streamKey = `${guildId}:${userId}:twitch:${link.twitchLogin}`;
      const sent = await sendTwitchLiveAlert(client, {
        guildId,
        userId,
        link: link.url,
        stream,
        streamKey,
        force: true,
      });
      if (sent) result.sent += 1;
    }
  }

  result.ok = true;
  result.message = result.online.length
    ? `${result.online.length} live(s) online encontrada(s).`
    : 'Nenhuma live online encontrada agora.';
  return result;
}

function getConfiguredTwitchTargets() {
  const data = getAllLiveLinks();
  const targets = [];

  for (const [guildId, guildConfig] of Object.entries(data)) {
    for (const [userId, entry] of Object.entries(guildConfig || {})) {
      const normalized = normalizeLiveEntry(entry);
      if (!normalized.termsAcceptedAt) continue;

      for (const link of normalized.links) {
        const twitchLogin = link?.twitchLogin || parseTwitchLogin(link?.url);
        if (!twitchLogin || !link?.url) continue;
        targets.push({
          guildId,
          userId,
          link: link.url,
          twitchLogin,
        });
      }
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
        activeStreams.delete(streamKey);
        continue;
      }

      if (twitchOnlineStreams.has(streamKey)) continue;

      await sendTwitchLiveAlert(client, {
        guildId: target.guildId,
        userId: target.userId,
        link: target.link,
        stream,
        streamKey,
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
  acceptLiveTermsToken,
  buildLivePanelEmbed,
  buildLiveTermsUrl,
  getLiveLink,
  getLiveLinks,
  handlePresenceLiveAlert,
  handleVoiceLiveAlert,
  checkUserTwitchLinks,
  hasAcceptedLiveTerms,
  initTwitchLiveMonitor,
  isValidLiveUrl,
  parseTwitchLogin,
  parseLiveTermsToken,
  removeLiveLink,
  setLiveLink,
};
