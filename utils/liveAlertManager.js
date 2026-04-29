const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ActivityType, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const axios = require('axios');
const config = require('../config/config');

const DATA_PATH = path.join(__dirname, '..', 'commands', 'liveLinks.json');
const ALERT_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID || '1202251715865489459';
const TWITCH_POLL_INTERVAL_MS = Number(process.env.CHECK_INTERVAL_MS || 60_000);
const DISCORD_MENTION_ROLE_ID = process.env.DISCORD_MENTION_ROLE_ID || '1201193356810780773';
const DISCORD_MENTION = process.env.DISCORD_MENTION || '';
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

function isLegacyGuildLiveEntryKey(key) {
  return !['termsAcceptedAt', 'termsAcceptedBy', 'links', 'updatedAt', 'updatedBy', 'users'].includes(String(key));
}

function normalizeGuildLiveConfig(guildConfig) {
  if (!guildConfig || typeof guildConfig !== 'object') {
    return { termsAcceptedAt: null, termsAcceptedBy: null, links: [] };
  }

  if (Array.isArray(guildConfig.links)) {
    return normalizeLiveEntry(guildConfig);
  }

  const legacyEntries = Object.entries(guildConfig).filter(([key, value]) => isLegacyGuildLiveEntryKey(key) && value && typeof value === 'object');
  if (!legacyEntries.length) {
    return normalizeLiveEntry(guildConfig);
  }

  const links = [];
  let termsAcceptedAt = guildConfig.termsAcceptedAt || null;
  let termsAcceptedBy = guildConfig.termsAcceptedBy || null;

  for (const [legacyKey, entry] of legacyEntries) {
    const normalized = normalizeLiveEntry(entry);
    if (!termsAcceptedAt && normalized.termsAcceptedAt) {
      termsAcceptedAt = normalized.termsAcceptedAt;
      termsAcceptedBy = normalized.termsAcceptedBy || legacyKey;
    }

    for (const link of normalized.links) {
      links.push({
        ...link,
        createdBy: link.createdBy || legacyKey,
      });
    }
  }

  const deduped = [];
  const seen = new Set();
  for (const link of links) {
    const key = String(link.url || '').trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(link);
  }

  return {
    termsAcceptedAt,
    termsAcceptedBy,
    links: deduped,
  };
}

function getGuildUserEntries(guildConfig) {
  if (!guildConfig || typeof guildConfig !== 'object') return {};

  const entries = {};
  if (guildConfig.users && typeof guildConfig.users === 'object' && !Array.isArray(guildConfig.users)) {
    for (const [userId, entry] of Object.entries(guildConfig.users)) {
      entries[String(userId)] = normalizeLiveEntry(entry);
    }
  }

  for (const [key, value] of Object.entries(guildConfig)) {
    if (!isLegacyGuildLiveEntryKey(key) || !value || typeof value !== 'object' || Array.isArray(value)) continue;
    entries[String(key)] = normalizeLiveEntry(value);
  }

  return entries;
}

function getUserLiveEntry(guildId, userId) {
  const guildConfig = getGuildConfig(guildId);
  if (!userId) return normalizeGuildLiveConfig(guildConfig);

  const userKey = String(userId);
  const entries = getGuildUserEntries(guildConfig);
  if (entries[userKey]) return entries[userKey];

  return { termsAcceptedAt: null, termsAcceptedBy: null, links: [] };
}

function getLiveLink(guildId, userId = null) {
  return getLiveLinks(guildId, userId)[0]?.url || null;
}

function getLiveLinks(guildId, userId = null) {
  return getUserLiveEntry(guildId, userId).links;
}

function getGuildLiveLinks(guildId) {
  const guildConfig = getGuildConfig(guildId);
  const links = [...normalizeGuildLiveConfig(guildConfig).links];
  for (const entry of Object.values(getGuildUserEntries(guildConfig))) {
    links.push(...entry.links);
  }

  const deduped = [];
  const seen = new Set();
  for (const link of links) {
    const key = String(link.url || '').trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(link);
  }
  return deduped;
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

function hasAcceptedLiveTerms(guildId, userId = null) {
  return Boolean(getUserLiveEntry(guildId, userId).termsAcceptedAt);
}

function acceptLiveTerms(guildId, userId) {
  const data = loadLiveLinks();
  const guildKey = String(guildId);
  const userKey = String(userId);
  if (!data[guildKey]) data[guildKey] = {};
  const guildConfig = data[guildKey];
  if (!guildConfig.users || typeof guildConfig.users !== 'object' || Array.isArray(guildConfig.users)) {
    guildConfig.users = {};
  }
  const current = getUserLiveEntry(guildId, userKey);

  guildConfig.users[userKey] = {
    ...current,
    termsAcceptedAt: new Date().toISOString(),
    termsAcceptedBy: userKey,
  };
  saveLiveLinks(data);
  return guildConfig.users[userKey];
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
  if (!data[guildKey].users || typeof data[guildKey].users !== 'object' || Array.isArray(data[guildKey].users)) {
    data[guildKey].users = {};
  }

  const twitchLogin = parseTwitchLogin(url);
  const current = getUserLiveEntry(guildId, userKey);
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

  data[guildKey].users[userKey] = {
    ...current,
    termsAcceptedAt: current.termsAcceptedAt || new Date().toISOString(),
    termsAcceptedBy: current.termsAcceptedBy || String(updatedBy),
    links: [...current.links, nextLink],
    updatedBy: String(updatedBy),
    updatedAt: new Date().toISOString(),
  };

  saveLiveLinks(data);
  return nextLink;
}

function removeLiveLink(guildId) {
  const data = loadLiveLinks();
  const guildKey = String(guildId);
  if (!data[guildKey]) return false;

  const current = normalizeGuildLiveConfig(data[guildKey]);
  const userEntries = getGuildUserEntries(data[guildKey]);
  const hadLinks = current.links.length > 0 || Object.values(userEntries).some((entry) => entry.links.length > 0);
  if (!hadLinks) return false;

  data[guildKey] = {
    ...current,
    links: [],
    users: {},
    updatedAt: new Date().toISOString(),
  };
  saveLiveLinks(data);
  return true;
}

function removeUserLiveLinks(guildId, userId) {
  const data = loadLiveLinks();
  const guildKey = String(guildId);
  const userKey = String(userId);
  const guildConfig = data[guildKey];
  if (!guildConfig) return false;

  const current = getUserLiveEntry(guildId, userKey);
  if (current.links.length === 0) return false;

  if (!guildConfig.users || typeof guildConfig.users !== 'object' || Array.isArray(guildConfig.users)) {
    guildConfig.users = {};
  }
  guildConfig.users[userKey] = {
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
    clientId: String(config.twitchClientId || process.env.TWITCH_CLIENT_ID || '').trim().replace(/^["']|["']$/g, ''),
    clientSecret: String(config.twitchClientSecret || process.env.TWITCH_CLIENT_SECRET || '').trim().replace(/^["']|["']$/g, ''),
  };
}

function getEnvTwitchStreamers() {
  return (process.env.TWITCH_STREAMERS || '')
    .split(',')
    .map((streamer) => streamer.trim().toLowerCase())
    .filter(Boolean)
    .filter((streamer, index, list) => list.indexOf(streamer) === index);
}

function hasTwitchCredentials() {
  const { clientId, clientSecret } = getTwitchConfig();
  return Boolean(clientId && clientSecret);
}

function formatTwitchError(error, fallback = 'Falha ao consultar Twitch') {
  const status = error?.response?.status;
  const data = error?.response?.data;

  if (data && typeof data === 'object') {
    const parts = [];
    if (data.message) parts.push(String(data.message));
    if (data.error) parts.push(String(data.error));
    if (data.status && !status) parts.push(`status ${data.status}`);
    if (parts.length) return `${fallback}: ${parts.join(' | ')}`;
  }

  if (status) {
    return `${fallback}: HTTP ${status}${error?.message ? ` (${error.message})` : ''}`;
  }

  return `${fallback}: ${error?.message || 'erro desconhecido'}`;
}

async function getTwitchAppToken() {
  const { clientId, clientSecret } = getTwitchConfig();
  if (!clientId || !clientSecret) {
    const error = new Error('TWITCH_CLIENT_ID/TWITCH_CLIENT_SECRET ausentes no ambiente.');
    error.code = 'TWITCH_ENV_MISSING';
    throw error;
  }

  if (twitchToken && Date.now() < twitchTokenExpiresAt - 60_000) {
    return twitchToken;
  }

  let response;
  try {
    response = await axios.post(
      'https://id.twitch.tv/oauth2/token',
      new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'client_credentials',
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 15_000,
      },
    );
  } catch (error) {
    error.message = formatTwitchError(error, 'Erro ao obter token da Twitch');
    throw error;
  }

  twitchToken = response.data?.access_token || null;
  if (!twitchToken) {
    throw new Error('Erro ao obter token da Twitch: resposta sem access_token.');
  }
  const expiresInMs = Number(response.data?.expires_in || 0) * 1000;
  twitchTokenExpiresAt = Date.now() + Math.max(expiresInMs, 0);
  return twitchToken;
}

async function fetchTwitchStreams(logins) {
  const uniqueLogins = [...new Set(logins.map(String).map((login) => login.toLowerCase()).filter(Boolean))];
  if (uniqueLogins.length === 0) return new Map();

  const token = await getTwitchAppToken();
  const { clientId } = getTwitchConfig();
  if (!token || !clientId) {
    const error = new Error('TWITCH_CLIENT_ID/TWITCH_CLIENT_SECRET ausentes no ambiente.');
    error.code = 'TWITCH_ENV_MISSING';
    throw error;
  }

  const streams = new Map();
  for (let index = 0; index < uniqueLogins.length; index += 100) {
    const batch = uniqueLogins.slice(index, index + 100);
    const params = new URLSearchParams();
    for (const login of batch) params.append('user_login', login);

    let response;
    try {
      response = await axios.get(`https://api.twitch.tv/helix/streams?${params.toString()}`, {
        headers: {
          'Client-ID': clientId,
          Authorization: `Bearer ${token}`,
        },
        timeout: 15_000,
      });
    } catch (error) {
      error.message = formatTwitchError(error, 'Erro ao consultar streams da Twitch');
      throw error;
    }

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
      { name: 'Servidor', value: interaction.guild?.name || 'Servidor', inline: true },
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
  const fields = [];
  if (link) fields.push(`**Link:** ${link}`);
  fields.push(`**Onde:** ${streamPlace}`);
  if (activityUrl) fields.push(`**Detectado pelo Discord:** ${activityUrl}`);

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
      ...fields,
    ].join('\n'))
    .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 256 }))
    .setFooter({ text: 'Vortex Live Alerts' })
    .setTimestamp();

  return embed;
}

function buildTwitchStreamEmbed(stream) {
  const streamUrl = `https://www.twitch.tv/${stream.user_login}`;
  const thumbnail = stream.thumbnail_url
    ? stream.thumbnail_url
        .replace('{width}', '1280')
        .replace('{height}', '720') + `?r=${Date.now()}`
    : null;

  const embed = new EmbedBuilder()
    .setColor('#1D7DFF')
    .setAuthor({
      name: `${stream.user_name || stream.user_login} está AO VIVO!`,
      url: streamUrl,
    })
    .setTitle(stream.title || 'Live sem titulo')
    .setURL(streamUrl)
    .addFields(
      { name: 'Jogo', value: stream.game_name || 'Nao informado', inline: true },
      { name: 'Viewers', value: Number(stream.viewer_count || 0).toLocaleString('pt-BR'), inline: true },
      { name: 'Assistir', value: `[Entrar na live agora!](${streamUrl})`, inline: false },
    )
    .setFooter({ text: 'Vortex Twitch Live Alert' })
    .setTimestamp(stream.started_at ? new Date(stream.started_at) : new Date());

  if (thumbnail) embed.setImage(thumbnail);
  return embed;
}

function buildMentionText() {
  if (DISCORD_MENTION_ROLE_ID) {
    return `<@&${DISCORD_MENTION_ROLE_ID}>`;
  }

  return DISCORD_MENTION || '';
}

function buildAllowedMentions() {
  if (DISCORD_MENTION_ROLE_ID) {
    return { roles: [DISCORD_MENTION_ROLE_ID] };
  }

  if (DISCORD_MENTION === '@everyone' || DISCORD_MENTION === '@here') {
    return { parse: ['everyone'] };
  }

  return { parse: [] };
}

async function resolveDiscordMention(channel) {
  if (DISCORD_MENTION_ROLE_ID) {
    const guild = channel?.guild || null;
    const role = guild ? await guild.roles.fetch(DISCORD_MENTION_ROLE_ID).catch(() => null) : null;
    if (!role) {
      console.warn(`[LIVE ALERT] Cargo de menção não encontrado: ${DISCORD_MENTION_ROLE_ID}`);
      return { content: '', allowedMentions: { parse: [] }, resetMentionable: null };
    }

    const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
    const canEditRole = Boolean(role.editable || me?.permissions?.has(PermissionFlagsBits.ManageRoles));

    if (!role.mentionable && canEditRole) {
      await role.setMentionable(true, 'Vortex live alert temporary mention').catch((error) => {
        console.warn(`[LIVE ALERT] Não foi possível tornar o cargo mencionável: ${error.message}`);
      });
      return {
        content: `<@&${role.id}>`,
        allowedMentions: { roles: [role.id] },
        resetMentionable: role,
      };
    }

    if (!role.mentionable && !canEditRole) {
      console.warn(`[LIVE ALERT] Cargo ${role.id} não está mencionável e o bot não pode alterá-lo.`);
      return {
        content: `<@&${role.id}>`,
        allowedMentions: { roles: [role.id] },
        resetMentionable: null,
      };
    }

    return {
      content: `<@&${role.id}>`,
      allowedMentions: { roles: [role.id] },
      resetMentionable: null,
    };
  }

  const mention = DISCORD_MENTION || '';
  return {
    content: mention,
    allowedMentions: mention === '@everyone' || mention === '@here'
      ? { parse: ['everyone'] }
      : { parse: [] },
    resetMentionable: null,
  };
}

async function sendLiveAlert({ guild, user, member, activity = null, place = null, link = null, streamKeyOverride = null, force = false }) {
  if (!guild || !user || user.bot) return false;

  const guildId = guild.id;
  const userId = user.id;
  const streamKey = streamKeyOverride || `${guildId}:${userId}`;
  if (!force && activeStreams.has(streamKey)) return false;

  const alertLink = link || activity?.url || null;

  const channel = await guild.channels.fetch(ALERT_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased?.()) {
    console.warn(`[LIVE ALERT] Canal de alerta invalido ou inacessivel: ${ALERT_CHANNEL_ID}`);
    activeStreams.add(streamKey);
    return false;
  }

  const guildMember = member || await guild.members.fetch(userId).catch(() => null);
  const mention = await resolveDiscordMention(channel);
  const content = [
    mention.content || null,
    alertLink
      ? `<@${userId}> está fazendo live: ${alertLink}`
      : `<@${userId}> está fazendo live`,
  ].filter(Boolean).join(' ');

  await channel.send({
    content,
    embeds: [buildLiveAlertEmbed({
      member: guildMember,
      user,
      activity,
      link: alertLink,
      place,
    })],
    allowedMentions: {
      users: [userId],
      roles: mention.allowedMentions?.roles || [],
      parse: mention.allowedMentions?.parse || [],
    },
  }).catch((error) => {
    console.warn(`[LIVE ALERT] Falha ao enviar alerta de live de ${userId}: ${error.message}`);
    return null;
  }).finally(async () => {
    if (mention.resetMentionable) {
      await mention.resetMentionable.setMentionable(false, 'Vortex live alert reset').catch(() => null);
    }
  });

  activeStreams.add(streamKey);
  return true;
}

async function sendTwitchLiveAlert(client, { link, stream, streamKey, force = false }) {
  if (streamKey && !force && activeStreams.has(streamKey)) {
    return false;
  }

  const channel = await client.channels.fetch(ALERT_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased?.()) {
    console.warn(`[LIVE ALERT] Canal Discord invalido ou inacessivel: ${ALERT_CHANNEL_ID}`);
    return false;
  }

  const mention = await resolveDiscordMention(channel);
  await channel.send({
    content: `${mention.content ? `${mention.content} ` : ''}**${stream.user_name || stream.user_login}** está AO VIVO!\n${link || `https://www.twitch.tv/${stream.user_login}`}`,
    embeds: [buildTwitchStreamEmbed(stream)],
    allowedMentions: mention.allowedMentions,
  }).catch((error) => {
    console.warn(`[LIVE ALERT] Falha ao enviar alerta Twitch de ${stream.user_login}: ${error.message}`);
    return null;
  }).finally(async () => {
    if (mention.resetMentionable) {
      await mention.resetMentionable.setMentionable(false, 'Vortex live alert reset').catch(() => null);
    }
  });

  if (streamKey) {
    activeStreams.add(streamKey);
  }
  return true;
}

async function checkUserTwitchLinks(client, guildId, userId, { sendIfOnline = false } = {}) {
  const links = userId ? getLiveLinks(guildId, userId) : getGuildLiveLinks(guildId);
  const termsAccepted = userId ? hasAcceptedLiveTerms(guildId, userId) : links.length > 0;
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
      const streamKey = `${guildId}:twitch:${link.twitchLogin}`;
      const sent = await sendTwitchLiveAlert(client, {
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

  for (const streamer of getEnvTwitchStreamers()) {
    targets.push({
      source: 'env',
      twitchLogin: streamer,
      link: `https://www.twitch.tv/${streamer}`,
    });
  }

  for (const [guildId, guildConfig] of Object.entries(data)) {
    const normalized = normalizeGuildLiveConfig(guildConfig);
    for (const link of normalized.links) {
      const twitchLogin = link?.twitchLogin || parseTwitchLogin(link?.url);
      if (!twitchLogin || !link?.url) continue;
      targets.push({
        source: 'guild',
        guildId,
        link: link.url,
        twitchLogin,
      });
    }

    for (const [userId, entry] of Object.entries(getGuildUserEntries(guildConfig))) {
      for (const link of entry.links) {
        const twitchLogin = link?.twitchLogin || parseTwitchLogin(link?.url);
        if (!twitchLogin || !link?.url) continue;
        targets.push({
          source: 'user',
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
      const streamKey = target.source === 'env'
        ? `env:twitch:${target.twitchLogin}`
        : target.source === 'user'
          ? `${target.guildId}:${target.userId}:twitch:${target.twitchLogin}`
          : `${target.guildId}:twitch:${target.twitchLogin}`;
      const stream = streams.get(target.twitchLogin);

      if (!stream) {
        twitchOnlineStreams.delete(streamKey);
        activeStreams.delete(streamKey);
        continue;
      }

      if (twitchOnlineStreams.has(streamKey)) continue;

      await sendTwitchLiveAlert(client, {
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
  const envStreamers = getEnvTwitchStreamers();
  if (envStreamers.length) {
    console.log(`[LIVE ALERT] Monitorando streamers do .env: ${envStreamers.join(', ')}`);
  }
  console.log(`[LIVE ALERT] Credenciais Twitch carregadas: client_id=${clientId ? 'sim' : 'nao'} secret=${clientSecret ? 'sim' : 'nao'} mention_role=${DISCORD_MENTION_ROLE_ID || 'nao'} scope=global`);
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
  getGuildLiveLinks,
  handlePresenceLiveAlert,
  handleVoiceLiveAlert,
  checkUserTwitchLinks,
  buildMentionText,
  buildAllowedMentions,
  resolveDiscordMention,
  hasAcceptedLiveTerms,
  initTwitchLiveMonitor,
  isValidLiveUrl,
  formatTwitchError,
  parseTwitchLogin,
  parseLiveTermsToken,
  removeLiveLink,
  removeUserLiveLinks,
  setLiveLink,
};
