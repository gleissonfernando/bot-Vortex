import { ObjectId } from 'mongodb';
import { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { collection, serializeDoc, serializeDocs } from '../db.js';
import { env } from '../env.js';
import { requireManager } from '../middleware.js';

const DEFAULT_MESSAGE = '@{streamer} {title}';
const PLATFORMS = ['twitch', 'kick', 'youtube', 'tiktok', 'facebook', 'trovo'] as const;
const PLATFORM_LABELS: Record<string, string> = {
  twitch: 'Twitch',
  kick: 'Kick',
  youtube: 'YouTube Live',
  tiktok: 'TikTok Live',
  facebook: 'Facebook Gaming',
  trovo: 'Trovo'
};
const PLATFORM_INTERVAL_MS: Record<string, number> = {
  twitch: 60_000,
  kick: 60_000,
  youtube: 120_000,
  tiktok: 120_000,
  facebook: 120_000,
  trovo: 120_000
};
const TWITCH_NEON_PURPLE = 0x9146ff;
const TWITCH_FALLBACK_IMAGE = 'https://dummyimage.com/1280x720/5f6270/2f313b.png&text=%F0%9F%93%B9';

let twitchTokenCache: { token: string; expiresAt: number } | null = null;
let monitorStarted = false;
let monitorRunning = false;

type LiveStatus = {
  online: boolean;
  liveId: string | null;
  title: string | null;
  game: string | null;
  viewers: number | null;
  thumbnail: string | null;
  url: string;
  startedAt: Date | null;
  twitchLogin?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
};

type LiveNotificationDoc = {
  _id?: ObjectId;
  guild_id: string;
  platform: string;
  channel_url: string;
  streamer_name: string;
  discord_channel_id: string;
  discord_role_id: string | null;
  custom_message: string | null;
  last_status: 'online' | 'offline' | 'unknown';
  last_live_id: string | null;
  last_title?: string | null;
  last_game?: string | null;
  last_viewers?: number | null;
  last_thumbnail?: string | null;
  avatar_url?: string | null;
  last_checked_at?: Date | null;
  last_notified_at?: Date | null;
  created_at: Date;
  updated_at: Date;
};

const optionalDiscordId = z.preprocess(
  (value) => value === '' ? null : value,
  z.string().min(1).max(32).optional().nullable()
);

const optionalText = (max: number) => z.preprocess(
  (value) => value === '' ? null : value,
  z.string().max(max).optional().nullable()
);

const liveSchema = z.object({
  platform: z.enum(PLATFORMS).optional(),
  url: z.string().trim().min(3).max(300),
  discordChannelId: z.string().min(5).max(32),
  discordRoleId: optionalDiscordId,
  customMessage: optionalText(1200),
  guildId: z.string().min(5).max(32).optional()
});

function asyncRoute(handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    void handler(req, res, next).catch(next);
  };
}

function defaultGuildId(req: any) {
  return String(req.query.guildId || req.body?.guildId || env.discordGuildId || process.env.GUILD_ID || 'global');
}

function normalizeUrl(input: string) {
  const raw = String(input || '').trim();
  if (!raw) return raw;
  return raw.includes('://') ? raw : `https://${raw.replace(/^\/+/, '')}`;
}

function detectPlatform(input: string) {
  try {
    const host = new URL(normalizeUrl(input)).hostname.toLowerCase();
    if (host.includes('twitch.tv')) return 'twitch';
    if (host.includes('kick.com')) return 'kick';
    if (host.includes('youtube.com') || host.includes('youtu.be')) return 'youtube';
    if (host.includes('tiktok.com')) return 'tiktok';
    if (host.includes('facebook.com') || host.includes('fb.gg')) return 'facebook';
    if (host.includes('trovo.live')) return 'trovo';
  } catch {
    return null;
  }
  return null;
}

function extractSlug(url: string, platform: string) {
  try {
    const parsed = new URL(normalizeUrl(url));
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (platform === 'youtube') {
      if (parts[0]?.startsWith('@')) return parts[0].replace(/^@/, '');
      if (parts[0] === 'channel' || parts[0] === 'c') return parts[1] || parts[0] || '';
    }
    if (platform === 'tiktok') return (parts[0] || '').replace(/^@/, '');
    return (parts[0] || '').replace(/^@/, '');
  } catch {
    return String(url || '').replace(/^@/, '').trim();
  }
}

function canonicalUrl(input: string, platform: string) {
  const raw = String(input || '').trim();
  if (raw.includes('://')) return raw;
  const slug = raw.replace(/^@/, '').replace(/^\/+/, '');
  if (platform === 'twitch') return `https://www.twitch.tv/${slug}`;
  if (platform === 'kick') return `https://kick.com/${slug}`;
  if (platform === 'youtube') return slug.startsWith('@') ? `https://youtube.com/${slug}` : `https://youtube.com/@${slug}`;
  if (platform === 'tiktok') return `https://www.tiktok.com/@${slug}`;
  if (platform === 'trovo') return `https://trovo.live/s/${slug}`;
  return normalizeUrl(raw);
}

function validatePlatformUrl(url: string, platform: string) {
  const detected = detectPlatform(url);
  if (!detected) throw new Error('URL invalida ou plataforma nao reconhecida.');
  if (detected !== platform) throw new Error(`URL informada pertence a ${PLATFORM_LABELS[detected]}, nao a ${PLATFORM_LABELS[platform]}.`);
  return true;
}

async function getTwitchToken() {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.warn('[frequency-api] erro ao buscar dados da Twitch: TWITCH_CLIENT_ID/TWITCH_CLIENT_SECRET ausentes.');
    return null;
  }
  if (twitchTokenCache && twitchTokenCache.expiresAt > Date.now() + 60_000) return twitchTokenCache.token;

  const response = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials'
    })
  }).catch((error) => {
    console.warn('[frequency-api] erro ao buscar token da Twitch:', error);
    return null;
  });
  if (!response?.ok) {
    console.warn(`[frequency-api] erro ao buscar token da Twitch: HTTP ${response?.status || 'sem resposta'}`);
    return null;
  }
  const data = await response.json();
  twitchTokenCache = {
    token: String(data.access_token || ''),
    expiresAt: Date.now() + Math.max(60, Number(data.expires_in || 3600) - 60) * 1000
  };
  return twitchTokenCache.token;
}

async function resolveTwitchChannel(url: string) {
  const login = extractSlug(url, 'twitch').toLowerCase();
  const token = await getTwitchToken();
  const clientId = process.env.TWITCH_CLIENT_ID;
  if (!login || !token || !clientId) return { streamerName: login || 'Streamer', channelUrl: canonicalUrl(url, 'twitch') };

  const response = await fetch(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(login)}`, {
    headers: { Authorization: `Bearer ${token}`, 'Client-Id': clientId }
  }).catch(() => null);
  if (!response?.ok) return { streamerName: login, channelUrl: canonicalUrl(url, 'twitch') };
  const data = await response.json();
  const user = Array.isArray(data.data) ? data.data[0] : null;
  if (!user) throw new Error('Canal Twitch nao encontrado.');
  return {
    streamerName: String(user.display_name || user.login || login),
    channelUrl: `https://www.twitch.tv/${user.login || login}`,
    avatarUrl: String(user.profile_image_url || '')
  };
}

async function resolveGenericChannel(url: string, platform: string) {
  return {
    streamerName: extractSlug(url, platform) || PLATFORM_LABELS[platform] || 'Streamer',
    channelUrl: canonicalUrl(url, platform)
  };
}

async function resolveChannel(url: string, platform: string) {
  if (platform === 'twitch') return resolveTwitchChannel(url);
  return resolveGenericChannel(url, platform);
}

function resolvedAvatarUrl(resolved: unknown) {
  const avatarUrl = (resolved as { avatarUrl?: unknown })?.avatarUrl;
  return typeof avatarUrl === 'string' && avatarUrl ? avatarUrl : null;
}

async function checkTwitchLive(item: LiveNotificationDoc): Promise<LiveStatus> {
  const login = extractSlug(item.channel_url, 'twitch').toLowerCase();
  const token = await getTwitchToken();
  const clientId = process.env.TWITCH_CLIENT_ID;
  const fallback = {
    online: false,
    liveId: null,
    title: null,
    game: null,
    viewers: null,
    thumbnail: null,
    url: item.channel_url,
    startedAt: null
  };
  if (!login || !token || !clientId) return fallback;

  const response = await fetch(`https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(login)}`, {
    headers: { Authorization: `Bearer ${token}`, 'Client-Id': clientId }
  }).catch((error) => {
    console.warn('[frequency-api] erro ao buscar dados da Twitch:', error);
    return null;
  });
  if (!response?.ok) {
    console.warn(`[frequency-api] erro ao buscar dados da Twitch: HTTP ${response?.status || 'sem resposta'}`);
    return fallback;
  }
  const data = await response.json();
  const stream = Array.isArray(data.data) ? data.data[0] : null;
  if (!stream) return fallback;
  let user: any = null;
  const userLogin = String(stream.user_login || login).toLowerCase();
  const userResponse = await fetch(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(userLogin)}`, {
    headers: { Authorization: `Bearer ${token}`, 'Client-Id': clientId }
  }).catch((error) => {
    console.warn('[frequency-api] erro ao buscar usuario da Twitch:', error);
    return null;
  });
  if (userResponse?.ok) {
    const userData = await userResponse.json().catch(() => ({}));
    user = Array.isArray(userData.data) ? userData.data[0] : null;
  } else if (userResponse) {
    console.warn(`[frequency-api] erro ao buscar usuario da Twitch: HTTP ${userResponse.status}`);
  }
  return {
    online: true,
    liveId: String(stream.id || `${login}:${stream.started_at || Date.now()}`),
    title: stream.title || null,
    game: stream.game_name || null,
    viewers: Number(stream.viewer_count || 0),
    thumbnail: stream.thumbnail_url || null,
    url: `https://www.twitch.tv/${stream.user_login || login}`,
    startedAt: stream.started_at ? new Date(stream.started_at) : null,
    twitchLogin: userLogin,
    displayName: String(user?.display_name || stream.user_name || item.streamer_name),
    avatarUrl: String(user?.profile_image_url || item.avatar_url || '')
  };
}

async function checkKickLive(item: LiveNotificationDoc): Promise<LiveStatus> {
  const slug = extractSlug(item.channel_url, 'kick');
  const fallback = emptyStatus(item.channel_url);
  if (!slug) return fallback;
  const response = await fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`, {
    headers: { Accept: 'application/json' }
  }).catch(() => null);
  if (!response?.ok) return fallback;
  const data = await response.json().catch(() => null);
  const live = data?.livestream || null;
  if (!live) return fallback;
  return {
    online: true,
    liveId: String(live.id || live.session_title || `${slug}:live`),
    title: live.session_title || live.title || null,
    game: live.categories?.[0]?.name || live.category?.name || null,
    viewers: Number(live.viewer_count || live.viewers || 0),
    thumbnail: live.thumbnail?.url || live.thumbnail || null,
    url: item.channel_url,
    startedAt: live.created_at ? new Date(live.created_at) : null
  };
}

async function checkPageHeuristic(item: LiveNotificationDoc): Promise<LiveStatus> {
  const fallback = emptyStatus(item.channel_url);
  const response = await fetch(item.channel_url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 VortexLiveMonitor/1.0',
      Accept: 'text/html,application/xhtml+xml'
    }
  }).catch(() => null);
  if (!response?.ok) return fallback;
  const html = await response.text().catch(() => '');
  const lower = html.toLowerCase();
  const platform = item.platform;
  const live =
    (platform === 'youtube' && (lower.includes('"islive":true') || lower.includes('"is_live":true') || lower.includes('watching now'))) ||
    (platform === 'tiktok' && (lower.includes('live-room') || lower.includes('"islive":true') || lower.includes('is living'))) ||
    (platform === 'trovo' && (lower.includes('"islive":true') || lower.includes('is_live'))) ||
    (platform === 'facebook' && (lower.includes('is_live') || lower.includes('live_video')));
  if (!live) return fallback;

  const title = matchMeta(html, 'og:title') || `${item.streamer_name} ao vivo`;
  const thumbnail = matchMeta(html, 'og:image');
  return {
    online: true,
    liveId: `${platform}:${extractSlug(item.channel_url, platform)}:${title}`,
    title,
    game: null,
    viewers: null,
    thumbnail,
    url: matchMeta(html, 'og:url') || item.channel_url,
    startedAt: null
  };
}

function emptyStatus(url: string): LiveStatus {
  return { online: false, liveId: null, title: null, game: null, viewers: null, thumbnail: null, url, startedAt: null };
}

function matchMeta(html: string, property: string) {
  const pattern = new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i');
  return html.match(pattern)?.[1]?.replace(/&amp;/g, '&') || null;
}

async function checkLiveStatus(item: LiveNotificationDoc) {
  if (item.platform === 'twitch') return checkTwitchLive(item);
  if (item.platform === 'kick') return checkKickLive(item);
  return checkPageHeuristic(item);
}

function renderTemplate(template: string, item: LiveNotificationDoc, status: LiveStatus) {
  return String(template || DEFAULT_MESSAGE)
    .replaceAll('{streamer}', item.streamer_name)
    .replaceAll('{title}', status.title || 'Live')
    .replaceAll('{game}', status.game || 'Nao informado')
    .replaceAll('{viewers}', status.viewers === null || status.viewers === undefined ? 'Nao informado' : String(status.viewers))
    .replaceAll('{url}', status.url || item.channel_url)
    .replaceAll('{thumbnail}', status.thumbnail || '')
    .replaceAll('{platform}', PLATFORM_LABELS[item.platform] || item.platform);
}

function allowedMentions(roleId: string | null, guildId: string) {
  if (!roleId) return { parse: [] };
  if (roleId === guildId || roleId === '@everyone') return { parse: ['everyone'] };
  return { parse: [], roles: [roleId] };
}

function mentionText(roleId: string | null, guildId: string) {
  if (!roleId) return '';
  if (roleId === guildId || roleId === '@everyone') return '@everyone';
  return `<@&${roleId}>`;
}

function twitchPreviewUrl(status: LiveStatus) {
  if (!status.thumbnail) return TWITCH_FALLBACK_IMAGE;
  const base = String(status.thumbnail).replace('{width}', '1280').replace('{height}', '720');
  const separator = base.includes('?') ? '&' : '?';
  return `${base}${separator}v=${Date.now()}`;
}

function twitchHandle(item: LiveNotificationDoc, status: LiveStatus) {
  return String(status.twitchLogin || extractSlug(status.url || item.channel_url, 'twitch') || item.streamer_name)
    .replace(/^@/, '')
    .toLowerCase();
}

function footerDate(date = new Date()) {
  const time = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const full = date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
  return `vortex lives - Hoje às ${time} - ${full}`;
}

async function sendDiscordLiveNotification(item: LiveNotificationDoc, status: LiveStatus) {
  const token = env.discordBotToken || process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN;
  if (!token) return { ok: false, error: 'DISCORD_TOKEN/DISCORD_BOT_TOKEN ausente.' };

  const streamUrl = status.url || item.channel_url;
  const handle = twitchHandle(item, status);
  const displayName = status.displayName || item.streamer_name || handle;
  const title = status.title || 'Live na Twitch';
  const mention = mentionText(item.discord_role_id, item.guild_id);

  const embed: any = {
    color: item.platform === 'twitch' ? TWITCH_NEON_PURPLE : item.platform === 'kick' ? 0x53fc18 : item.platform === 'youtube' ? 0xff0033 : item.platform === 'tiktok' ? 0x00f2ea : TWITCH_NEON_PURPLE,
    author: {
      name: item.platform === 'twitch' ? `${displayName} is now live on Twitch!` : `${displayName} is now live!`,
      icon_url: status.avatarUrl || item.avatar_url || undefined,
      url: streamUrl
    },
    description: `[@${handle} ${title}](${streamUrl})`,
    fields: [
      { name: 'Game', value: status.game || 'Nao informado', inline: true },
      { name: 'Viewers', value: status.viewers === null || status.viewers === undefined ? '0' : String(status.viewers), inline: true }
    ],
    image: { url: item.platform === 'twitch' ? twitchPreviewUrl(status) : status.thumbnail || TWITCH_FALLBACK_IMAGE },
    footer: { text: footerDate(new Date()) }
  };

  const response = await fetch(`https://discord.com/api/v10/channels/${item.discord_channel_id}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      content: mention || undefined,
      embeds: [embed],
      components: [{
        type: 1,
        components: [{ type: 2, style: 5, label: 'Watch Stream', emoji: { name: '↗️' }, url: streamUrl }]
      }],
      allowed_mentions: allowedMentions(item.discord_role_id, item.guild_id)
    })
  });

  if (!response.ok) return { ok: false, error: `Discord HTTP ${response.status}` };
  return { ok: true };
}

function shouldCheck(item: LiveNotificationDoc, now = Date.now()) {
  const interval = PLATFORM_INTERVAL_MS[item.platform] || 120_000;
  const last = item.last_checked_at ? new Date(item.last_checked_at).getTime() : 0;
  return now - last >= interval;
}

async function processLiveItem(item: LiveNotificationDoc) {
  if (!item._id || !shouldCheck(item)) return;
  const status = await checkLiveStatus(item);
  const becameOnline = status.online && item.last_status !== 'online';
  const newLive = status.online && status.liveId && status.liveId !== item.last_live_id;
  const shouldNotify = status.online && (becameOnline || newLive);
  const now = new Date();
  let notificationSent = false;

  if (shouldNotify) {
    console.log(`[frequency-api] live detectada: ${item.streamer_name} online na Twitch.`);
    const result = await sendDiscordLiveNotification(item, status);
    if (!result.ok) {
      console.warn(`[frequency-api] erro ao enviar alerta de ${item.streamer_name}: ${result.error}`);
    } else {
      notificationSent = true;
      console.log(`[frequency-api] alerta enviado: ${item.streamer_name}.`);
    }
  }

  if (!status.online && item.last_status === 'online') {
    console.log(`[frequency-api] live ficou offline: ${item.streamer_name}.`);
  }

  await (await collection<LiveNotificationDoc>('live_notifications')).updateOne(
    { _id: item._id },
    {
      $set: {
        last_status: status.online ? 'online' : 'offline',
        last_live_id: status.online ? (shouldNotify && !notificationSent ? item.last_live_id : status.liveId) : item.last_live_id,
        last_title: status.title,
        last_game: status.game,
        last_viewers: status.viewers,
        last_thumbnail: status.thumbnail,
        last_checked_at: now,
        last_notified_at: notificationSent ? now : item.last_notified_at || null,
        updated_at: now
      }
    }
  );
}

async function monitorLiveNotificationsOnce() {
  if (monitorRunning) return;
  monitorRunning = true;
  try {
    const rows = await (await collection<LiveNotificationDoc>('live_notifications'))
      .find({})
      .sort({ last_checked_at: 1 })
      .limit(150)
      .toArray();
    for (const item of rows) {
      await processLiveItem(item).catch((error) => console.warn('[frequency-api] Falha ao monitorar live:', error));
    }
  } catch (error) {
    console.warn('[frequency-api] Monitor de lives indisponivel:', error);
  } finally {
    monitorRunning = false;
  }
}

export function startLiveNotificationMonitor() {
  if (monitorStarted) return;
  monitorStarted = true;
  setInterval(() => void monitorLiveNotificationsOnce(), 30_000).unref?.();
  setTimeout(() => void monitorLiveNotificationsOnce(), 5_000).unref?.();
}

function normalizeLive(doc: LiveNotificationDoc) {
  const item = serializeDoc(doc) as any;
  item.id = String(doc._id);
  item.guildId = doc.guild_id;
  item.channelUrl = doc.channel_url;
  item.streamerName = doc.streamer_name;
  item.discordChannelId = doc.discord_channel_id;
  item.discordRoleId = doc.discord_role_id;
  item.customMessage = doc.custom_message;
  item.lastStatus = doc.last_status;
  item.lastLiveId = doc.last_live_id;
  item.lastTitle = doc.last_title || null;
  item.lastGame = doc.last_game || null;
  item.lastViewers = doc.last_viewers ?? null;
  item.lastThumbnail = doc.last_thumbnail || null;
  item.lastCheckedAt = doc.last_checked_at || null;
  item.lastNotifiedAt = doc.last_notified_at || null;
  delete item._id;
  delete item.guild_id;
  delete item.channel_url;
  delete item.streamer_name;
  delete item.discord_channel_id;
  delete item.discord_role_id;
  delete item.custom_message;
  delete item.last_status;
  delete item.last_live_id;
  delete item.last_title;
  delete item.last_game;
  delete item.last_viewers;
  delete item.last_thumbnail;
  delete item.last_checked_at;
  delete item.last_notified_at;
  delete item.created_at;
  delete item.updated_at;
  return item;
}

async function fetchDiscordGuildOptions(guildId: string) {
  const token = env.discordBotToken || process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN;
  if (!token) return { channels: [], roles: [], error: 'DISCORD_TOKEN/DISCORD_BOT_TOKEN ausente.' };

  const headers = { Authorization: `Bot ${token}` };
  const [channelsResponse, rolesResponse] = await Promise.all([
    fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, { headers }),
    fetch(`https://discord.com/api/v10/guilds/${guildId}/roles`, { headers })
  ]);
  if (!channelsResponse.ok || !rolesResponse.ok) {
    return { channels: [], roles: [], error: `Discord HTTP canais=${channelsResponse.status} cargos=${rolesResponse.status}` };
  }

  const channels = await channelsResponse.json();
  const roles = await rolesResponse.json();
  return {
    channels: (Array.isArray(channels) ? channels : [])
      .filter((channel: any) => channel.type === 0 || channel.type === 5)
      .sort((a: any, b: any) => Number(a.position || 0) - Number(b.position || 0))
      .map((channel: any) => ({ id: String(channel.id), name: String(channel.name || 'canal'), type: Number(channel.type || 0) })),
    roles: [
      { id: guildId, name: '@everyone', mentionable: true },
      ...(Array.isArray(roles) ? roles : [])
        .filter((role: any) => !role.managed && role.name !== '@everyone')
        .sort((a: any, b: any) => Number(b.position || 0) - Number(a.position || 0))
        .map((role: any) => ({ id: String(role.id), name: String(role.name || 'cargo'), color: Number(role.color || 0), mentionable: Boolean(role.mentionable) }))
    ],
    error: null
  };
}

async function liveStats(guildId: string, rows?: LiveNotificationDoc[]) {
  const lives = await collection<LiveNotificationDoc>('live_notifications');
  const items = rows || await lives.find({ guild_id: guildId }).toArray();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return {
    totalMonitored: items.length,
    detectedToday: await lives.countDocuments({ guild_id: guildId, last_notified_at: { $gte: today } }),
    lastLiveSent: items
      .filter((item) => item.last_notified_at)
      .sort((a, b) => Number(new Date(b.last_notified_at || 0)) - Number(new Date(a.last_notified_at || 0)))[0]?.last_notified_at || null,
    connectedPlatforms: new Set(items.map((item) => item.platform)).size
  };
}

export const livesRouter = Router();

livesRouter.get('/', asyncRoute(async (req, res) => {
  const guildId = defaultGuildId(req);
  try {
    const rows = await (await collection<LiveNotificationDoc>('live_notifications')).find({ guild_id: guildId }).sort({ created_at: -1 }).toArray();
    return res.json({ ok: true, lives: rows.map(normalizeLive), stats: await liveStats(guildId, rows), platforms: PLATFORMS.map((id) => ({ id, name: PLATFORM_LABELS[id] })) });
  } catch (error) {
    console.warn('[frequency-api] Social Notifications sem MongoDB:', error);
    return res.json({ ok: true, lives: [], stats: { totalMonitored: 0, detectedToday: 0, lastLiveSent: null, connectedPlatforms: 0 }, platforms: PLATFORMS.map((id) => ({ id, name: PLATFORM_LABELS[id] })) });
  }
}));

livesRouter.get('/discord-options', requireManager, asyncRoute(async (req, res) => {
  const guildId = defaultGuildId(req);
  res.json({ ok: true, guildId, ...(await fetchDiscordGuildOptions(guildId)) });
}));

livesRouter.post('/', requireManager, asyncRoute(async (req, res) => {
  const input = liveSchema.parse(req.body);
  const guildId = input.guildId || defaultGuildId(req);
  const platform = input.platform || detectPlatform(input.url);
  if (!platform) return res.status(400).json({ ok: false, error: 'Nao foi possivel identificar a plataforma da URL.' });
  const channelUrl = canonicalUrl(input.url, platform);
  validatePlatformUrl(channelUrl, platform);
  const resolved = await resolveChannel(channelUrl, platform);
  const now = new Date();
  const doc: LiveNotificationDoc = {
    guild_id: guildId,
    platform,
    channel_url: resolved.channelUrl,
    streamer_name: resolved.streamerName,
    discord_channel_id: input.discordChannelId,
    discord_role_id: input.discordRoleId || guildId,
    custom_message: input.customMessage || null,
    avatar_url: resolvedAvatarUrl(resolved),
    last_status: 'unknown',
    last_live_id: null,
    last_checked_at: null,
    last_notified_at: null,
    created_at: now,
    updated_at: now
  };
  const lives = await collection<LiveNotificationDoc>('live_notifications');
  const existing = await lives.findOne({ guild_id: guildId, platform, channel_url: doc.channel_url });
  if (existing) return res.status(409).json({ ok: false, error: 'Este canal ja esta cadastrado.', live: normalizeLive(existing) });
  const result = await lives.insertOne(doc);
  return res.status(201).json({ ok: true, live: normalizeLive({ ...doc, _id: result.insertedId }) });
}));

livesRouter.put('/:id', requireManager, asyncRoute(async (req, res) => {
  const paramId = String(req.params.id || '');
  const id = ObjectId.isValid(paramId) ? new ObjectId(paramId) : null;
  if (!id) return res.status(400).json({ ok: false, error: 'ID invalido.' });
  const input = liveSchema.partial().parse(req.body);
  const update: any = { updated_at: new Date() };
  if (input.url) {
    const platform = input.platform || detectPlatform(input.url);
    if (!platform) return res.status(400).json({ ok: false, error: 'Nao foi possivel identificar a plataforma da URL.' });
    const channelUrl = canonicalUrl(input.url, platform);
    validatePlatformUrl(channelUrl, platform);
    const resolved = await resolveChannel(channelUrl, platform);
    update.platform = platform;
    update.channel_url = resolved.channelUrl;
    update.streamer_name = resolved.streamerName;
    update.avatar_url = resolvedAvatarUrl(resolved);
    update.last_status = 'unknown';
    update.last_live_id = null;
  }
  if (input.discordChannelId !== undefined) update.discord_channel_id = input.discordChannelId;
  if (input.discordRoleId !== undefined) update.discord_role_id = input.discordRoleId || null;
  if (input.customMessage !== undefined) update.custom_message = input.customMessage || null;
  const row = await (await collection<LiveNotificationDoc>('live_notifications')).findOneAndUpdate({ _id: id }, { $set: update }, { returnDocument: 'after' });
  if (!row) return res.status(404).json({ ok: false, error: 'Canal nao encontrado.' });
  return res.json({ ok: true, live: normalizeLive(row) });
}));

livesRouter.delete('/:id', requireManager, asyncRoute(async (req, res) => {
  const paramId = String(req.params.id || '');
  const id = ObjectId.isValid(paramId) ? new ObjectId(paramId) : null;
  if (!id) return res.status(400).json({ ok: false, error: 'ID invalido.' });
  await (await collection('live_notifications')).deleteOne({ _id: id });
  return res.json({ ok: true });
}));

livesRouter.post('/:id/test', requireManager, asyncRoute(async (req, res) => {
  const paramId = String(req.params.id || '');
  const id = ObjectId.isValid(paramId) ? new ObjectId(paramId) : null;
  if (!id) return res.status(400).json({ ok: false, error: 'ID invalido.' });
  const item = await (await collection<LiveNotificationDoc>('live_notifications')).findOne({ _id: id });
  if (!item) return res.status(404).json({ ok: false, error: 'Canal nao encontrado.' });
  const status = await checkLiveStatus(item).catch(() => ({
    online: true,
    liveId: 'test',
    title: 'Teste de notificacao',
    game: 'Teste',
    viewers: 0,
    thumbnail: null,
    url: item.channel_url,
    startedAt: null
  }));
  const result = await sendDiscordLiveNotification(item, { ...status, online: true });
  if (!result.ok) return res.status(400).json(result);
  return res.json({ ok: true });
}));
