import { ObjectId } from 'mongodb';
import { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { collection, serializeDoc, serializeDocs } from '../db.js';
import { requireManager } from '../middleware.js';

const DEFAULT_MESSAGE = '🔴 {streamer} está ao vivo!\n\n🎮 Plataforma: {platform}\n📺 Título da live: {title}\n👤 Streamer: {streamer}\n🔗 Assistir agora: {url}';
const DEFAULT_CHECK_INTERVAL_SECONDS = 30;
const PLATFORMS = ['twitch', 'youtube', 'kick', 'custom'] as const;
let twitchTokenCache: { token: string; expiresAt: number } | null = null;

function asyncRoute(handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    void handler(req, res, next).catch(next);
  };
}

const liveSchema = z.object({
  platform: z.enum(PLATFORMS).optional(),
  url: z.string().trim().min(1).max(240),
  streamerName: z.string().trim().max(80).optional().nullable(),
  alertChannelId: z.string().min(5).max(32).optional().nullable(),
  mentionRoleId: z.string().min(5).max(32).optional().nullable(),
  enabled: z.boolean().optional(),
  customMessage: z.string().max(1200).optional().nullable(),
  guildId: z.string().min(5).max(32).optional()
});

const settingsSchema = z.object({
  guildId: z.string().min(5).max(32).optional(),
  enabled: z.boolean().optional(),
  defaultAlertChannelId: z.string().min(5).max(32).optional().nullable(),
  defaultMentionRoleId: z.string().min(5).max(32).optional().nullable(),
  defaultMessage: z.string().max(1200).optional().nullable(),
  checkIntervalSeconds: z.number().int().min(30).max(3600).optional()
});

type LiveDoc = {
  _id?: ObjectId;
  guild_id: string;
  platform: string;
  url: string;
  streamer_name: string;
  alert_channel_id: string | null;
  mention_role_id: string | null;
  enabled: boolean;
  custom_message: string | null;
  status: 'online' | 'offline' | 'unknown';
  last_live_title: string | null;
  last_live_url: string | null;
  twitch_user_id?: string | null;
  twitch_login?: string | null;
  avatar_url?: string | null;
  last_announced_live_id: string | null;
  last_alert_message_id?: string | null;
  last_alert_updated_at?: Date | null;
  last_live_started_at?: Date | null;
  last_checked_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

function defaultGuildId(req: any) {
  return String(req.query.guildId || req.body?.guildId || process.env.DISCORD_GUILD_ID || process.env.GUILD_ID || 'global');
}

function detectPlatform(url: string) {
  try {
    const host = new URL(url.includes('://') ? url : `https://${url}`).hostname.toLowerCase();
    if (host.includes('twitch.tv')) return 'twitch';
    if (host.includes('youtube.com') || host.includes('youtu.be')) return 'youtube';
    if (host.includes('kick.com')) return 'kick';
  } catch {
    return 'custom';
  }
  return 'custom';
}

function extractChannelSlug(url: string) {
  try {
    const parsed = new URL(url.includes('://') ? url : `https://twitch.tv/${url}`);
    const host = parsed.hostname.toLowerCase();
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (!parts.length && !host.includes('.')) return host.replace(/^@/, '');
    return (parts[0] || '').replace(/^@/, '');
  } catch {
    return String(url || '').replace(/^@/, '').trim();
  }
}

function normalizeChannelInput(value: string, platform: string) {
  const raw = String(value || '').trim();
  if (!raw) return raw;
  if (raw.includes('://')) return raw;
  const clean = raw.replace(/^@/, '').replace(/^\/+/, '');
  if (platform === 'twitch') return `https://www.twitch.tv/${clean}`;
  if (platform === 'kick') return `https://kick.com/${clean}`;
  return raw;
}

function fallbackStreamerName(input: { streamerName?: string | null; url: string }, platform: string) {
  const typedName = String(input.streamerName || '').trim();
  if (typedName) return typedName;
  const slug = extractChannelSlug(input.url);
  if (slug) return slug;
  return platform === 'twitch' ? 'Streamer Twitch' : 'Streamer';
}

async function getTwitchToken() {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  if (twitchTokenCache && twitchTokenCache.expiresAt > Date.now() + 60_000) return twitchTokenCache.token;

  try {
    const response = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'client_credentials'
      })
    });
    if (!response.ok) return null;
    const data = await response.json();
    twitchTokenCache = {
      token: data.access_token,
      expiresAt: Date.now() + Math.max(60, Number(data.expires_in || 3600) - 60) * 1000
    };
    return twitchTokenCache.token;
  } catch (error) {
    console.warn('[frequency-api] Falha ao obter token da Twitch:', error);
    return null;
  }
}

async function resolveTwitchChannel(url: string) {
  const login = extractChannelSlug(url).toLowerCase();
  const token = await getTwitchToken();
  const clientId = process.env.TWITCH_CLIENT_ID;
  if (!login || !token || !clientId) return null;

  try {
    const response = await fetch(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(login)}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Client-Id': clientId
      }
    });
    if (!response.ok) return null;
    const data = await response.json();
    const user = Array.isArray(data.data) ? data.data[0] : null;
    if (!user) return null;
    return {
      id: String(user.id),
      login: String(user.login || login),
      displayName: String(user.display_name || login),
      avatarUrl: user.profile_image_url || null,
      url: `https://www.twitch.tv/${user.login || login}`
    };
  } catch (error) {
    console.warn(`[frequency-api] Falha ao consultar canal Twitch ${login}:`, error);
    return null;
  }
}

function normalizeLive(doc: LiveDoc) {
  const item = serializeDoc(doc) as any;
  item.id = String(doc._id);
  item.guildId = doc.guild_id;
  item.streamerName = doc.streamer_name;
  item.alertChannelId = doc.alert_channel_id;
  item.mentionRoleId = doc.mention_role_id;
  item.customMessage = doc.custom_message;
  item.lastLiveTitle = doc.last_live_title;
  item.lastLiveUrl = doc.last_live_url;
  item.twitchUserId = doc.twitch_user_id || null;
  item.twitchLogin = doc.twitch_login || null;
  item.avatarUrl = doc.avatar_url || null;
  item.lastAlertMessageId = doc.last_alert_message_id || null;
  item.lastCheckedAt = doc.last_checked_at;
  delete item._id;
  delete item.guild_id;
  delete item.streamer_name;
  delete item.alert_channel_id;
  delete item.mention_role_id;
  delete item.custom_message;
  delete item.last_live_title;
  delete item.last_live_url;
  delete item.twitch_user_id;
  delete item.twitch_login;
  delete item.avatar_url;
  delete item.last_announced_live_id;
  delete item.last_alert_message_id;
  delete item.last_alert_updated_at;
  delete item.last_live_started_at;
  delete item.last_checked_at;
  delete item.created_at;
  delete item.updated_at;
  return item;
}

async function getSettings(guildId: string) {
  const settings = await collection('live_alert_settings');
  const existing = await settings.findOne({ guild_id: guildId });
  return existing || {
    guild_id: guildId,
    enabled: true,
    default_alert_channel_id: null,
    default_mention_role_id: null,
    default_message: DEFAULT_MESSAGE,
    check_interval_seconds: DEFAULT_CHECK_INTERVAL_SECONDS
  };
}

function normalizeSettings(doc: any) {
  return {
    guildId: doc.guild_id,
    enabled: doc.enabled !== false,
    defaultAlertChannelId: doc.default_alert_channel_id || null,
    defaultMentionRoleId: doc.default_mention_role_id || null,
    defaultMessage: doc.default_message || DEFAULT_MESSAGE,
    checkIntervalSeconds: Number(doc.check_interval_seconds || DEFAULT_CHECK_INTERVAL_SECONDS)
  };
}

function objectId(value: unknown) {
  return new ObjectId(String(value || ''));
}

async function fetchDiscordGuildOptions(guildId: string) {
  const token = process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN;
  if (!token) return { channels: [], roles: [], error: 'DISCORD_TOKEN/DISCORD_BOT_TOKEN ausente.' };

  const headers = { Authorization: `Bot ${token}` };
  const [channelsResponse, rolesResponse] = await Promise.all([
    fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, { headers }),
    fetch(`https://discord.com/api/v10/guilds/${guildId}/roles`, { headers })
  ]);

  if (!channelsResponse.ok || !rolesResponse.ok) {
    return {
      channels: [],
      roles: [],
      error: `Discord HTTP canais=${channelsResponse.status} cargos=${rolesResponse.status}`
    };
  }

  const channels = await channelsResponse.json();
  const roles = await rolesResponse.json();

  return {
    channels: (Array.isArray(channels) ? channels : [])
      .filter((channel: any) => channel.type === 0 || channel.type === 5)
      .sort((a: any, b: any) => Number(a.position || 0) - Number(b.position || 0))
      .map((channel: any) => ({
        id: String(channel.id),
        name: String(channel.name || 'canal'),
        type: Number(channel.type || 0),
        parentId: channel.parent_id ? String(channel.parent_id) : null
      })),
    roles: (Array.isArray(roles) ? roles : [])
      .filter((role: any) => !role.managed)
      .sort((a: any, b: any) => Number(b.position || 0) - Number(a.position || 0))
      .map((role: any) => ({
        id: String(role.id),
        name: role.name === '@everyone' ? '@everyone' : String(role.name || 'cargo'),
        color: Number(role.color || 0),
        mentionable: role.name === '@everyone' ? true : Boolean(role.mentionable)
      })),
    error: null
  };
}

function renderMessage(template: string, live: any, settings: any) {
  return String(template || DEFAULT_MESSAGE)
    .replaceAll('{streamer}', live.streamer_name || live.streamerName || 'Streamer')
    .replaceAll('{platform}', live.platform || 'Live')
    .replaceAll('{title}', live.last_live_title || 'Live da Vortex')
    .replaceAll('{url}', live.last_live_url || live.url)
    .replaceAll('{guild}', settings.guild_id || settings.guildId || '');
}

function isEveryoneMention(roleId: string | null, guildId: string | null) {
  return Boolean(roleId && guildId && String(roleId) === String(guildId));
}

function formatAlertMention(roleId: string | null, guildId: string | null) {
  if (!roleId) return null;
  return isEveryoneMention(roleId, guildId) ? '@everyone' : `<@&${roleId}>`;
}

function liveAlertAllowedMentions(roleId: string | null, guildId: string | null) {
  if (!roleId) return { parse: [] };
  if (isEveryoneMention(roleId, guildId)) return { parse: ['everyone'] };
  return { parse: [], roles: [String(roleId)] };
}

function liveAlertContent(roleId: string | null, live: any, settings: any) {
  const mention = formatAlertMention(roleId, settings.guild_id || settings.guildId || live.guild_id || live.guildId || null);
  const template = live.custom_message || settings.default_message;
  if (template && template !== DEFAULT_MESSAGE) {
    return [mention, renderMessage(template, live, settings)].filter(Boolean).join('\n\n');
  }
  return mention || '';
}

async function sendDiscordAlert(live: any, settings: any) {
  const token = process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN;
  if (!token) return { ok: false, error: 'DISCORD_TOKEN/DISCORD_BOT_TOKEN ausente na API.' };
  const channelId = live.alert_channel_id || settings.default_alert_channel_id;
  if (!channelId) return { ok: false, error: 'Canal de alerta nao configurado.' };
  const roleId = live.mention_role_id || settings.default_mention_role_id || process.env.LIVE_MENTION_ROLE_ID || null;
  const streamUrl = live.last_live_url || live.url;
  const streamerName = live.streamer_name || live.streamerName || 'Streamer';
  const content = liveAlertContent(roleId, live, settings);
  const preview = live.thumbnail_url || live.preview_url || null;
  const embed: any = {
    color: 0x9146ff,
    author: {
      name: `${streamerName} is now live on Twitch!`,
      icon_url: live.avatar_url || undefined,
      url: streamUrl
    },
    title: live.last_live_title || 'Teste de alerta de live da Vortex',
    url: streamUrl,
    fields: [
      { name: 'Game', value: String(live.game_name || 'Grand Theft Auto V'), inline: true },
      { name: 'Viewers', value: String(live.viewer_count || 0), inline: true }
    ],
    footer: {
      text: `vortex lives • Hoje às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
    },
    timestamp: new Date().toISOString()
  };
  if (preview) embed.image = { url: String(preview).replace('{width}', '1280').replace('{height}', '720') };

  const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      content: content || undefined,
      embeds: [embed],
      components: [{
        type: 1,
        components: [{
          type: 2,
          style: 5,
          label: 'Watch Stream',
          url: streamUrl
        }]
      }],
      allowed_mentions: liveAlertAllowedMentions(roleId, live.guild_id || settings.guild_id || null)
    })
  });
  if (!response.ok) return { ok: false, error: `Discord HTTP ${response.status}` };
  return { ok: true };
}

export const livesRouter = Router();

livesRouter.get('/', asyncRoute(async (req, res) => {
  const guildId = defaultGuildId(req);
  try {
    const lives = await collection<LiveDoc>('live_alert_configs');
    const rows = await lives.find({ guild_id: guildId }).sort({ created_at: -1 }).toArray();
    const settings = await getSettings(guildId);
    return res.json({ ok: true, lives: rows.map(normalizeLive), settings: normalizeSettings(settings) });
  } catch (error) {
    console.warn('[frequency-api] Lives sem MongoDB:', error);
    return res.json({
      ok: true,
      lives: [],
      settings: normalizeSettings({
        guild_id: guildId,
        enabled: true,
        default_alert_channel_id: null,
        default_mention_role_id: null,
        default_message: DEFAULT_MESSAGE,
        check_interval_seconds: DEFAULT_CHECK_INTERVAL_SECONDS
      })
    });
  }
}));

livesRouter.get('/discord-options', requireManager, asyncRoute(async (req, res) => {
  const guildId = defaultGuildId(req);
  const options = await fetchDiscordGuildOptions(guildId);
  res.json({ ok: true, guildId, ...options });
}));

livesRouter.post('/', requireManager, asyncRoute(async (req, res) => {
  const input = liveSchema.parse(req.body);
  const guildId = input.guildId || defaultGuildId(req);
  const now = new Date();
  const platform = input.platform || detectPlatform(input.url);
  const normalizedUrl = normalizeChannelInput(input.url, platform);
  const twitch = platform === 'twitch' ? await resolveTwitchChannel(normalizedUrl) : null;
  const twitchLogin = platform === 'twitch'
    ? (twitch?.login || extractChannelSlug(normalizedUrl).toLowerCase() || null)
    : null;
  const doc: LiveDoc = {
    guild_id: guildId,
    platform,
    url: twitch?.url || normalizedUrl,
    streamer_name: twitch?.displayName || fallbackStreamerName({ ...input, url: normalizedUrl }, platform),
    alert_channel_id: input.alertChannelId || null,
    mention_role_id: input.mentionRoleId || null,
    enabled: input.enabled !== false,
    custom_message: input.customMessage || null,
    status: 'unknown',
    last_live_title: null,
    last_live_url: null,
    twitch_user_id: twitch?.id || null,
    twitch_login: twitchLogin,
    avatar_url: twitch?.avatarUrl || null,
    last_announced_live_id: null,
    last_alert_message_id: null,
    last_alert_updated_at: null,
    last_live_started_at: null,
    last_checked_at: null,
    created_at: now,
    updated_at: now
  };
  const lives = await collection<LiveDoc>('live_alert_configs');
  const duplicateQuery = twitchLogin
    ? { guild_id: guildId, platform, twitch_login: twitchLogin }
    : { guild_id: guildId, platform, url: doc.url };
  const existing = await lives.findOne(duplicateQuery);
  if (existing) {
    return res.status(409).json({ ok: false, error: 'Esta live ja esta cadastrada neste servidor.', live: normalizeLive(existing) });
  }
  const result = await lives.insertOne(doc);
  res.status(201).json({ ok: true, live: normalizeLive({ ...doc, _id: result.insertedId }) });
}));

livesRouter.put('/:id', requireManager, asyncRoute(async (req, res) => {
  const input = liveSchema.partial().parse(req.body);
  const update: any = { updated_at: new Date() };
  if (input.url) {
    update.platform = input.platform || detectPlatform(input.url);
    update.url = normalizeChannelInput(input.url, update.platform);
    if (update.platform === 'twitch') {
      const twitch = await resolveTwitchChannel(update.url);
      const twitchLogin = twitch?.login || extractChannelSlug(update.url).toLowerCase() || null;
      update.url = twitch?.url || update.url;
      update.streamer_name = twitch?.displayName || fallbackStreamerName({ ...input, url: update.url }, update.platform);
      update.twitch_user_id = twitch?.id || null;
      update.twitch_login = twitchLogin;
      update.avatar_url = twitch?.avatarUrl || null;
    }
  } else if (input.platform) {
    update.platform = input.platform;
  }
  if (input.streamerName !== undefined) {
    const name = String(input.streamerName || '').trim();
    if (name) update.streamer_name = name;
  }
  if (input.alertChannelId !== undefined) update.alert_channel_id = input.alertChannelId || null;
  if (input.mentionRoleId !== undefined) update.mention_role_id = input.mentionRoleId || null;
  if (input.enabled !== undefined) update.enabled = input.enabled;
  if (input.customMessage !== undefined) update.custom_message = input.customMessage || null;
  const lives = await collection<LiveDoc>('live_alert_configs');
  const row = await lives.findOneAndUpdate(
    { _id: objectId(req.params.id) },
    { $set: update },
    { returnDocument: 'after' }
  );
  if (!row) return res.status(404).json({ ok: false, error: 'Live nao encontrada.' });
  res.json({ ok: true, live: normalizeLive(row) });
}));

livesRouter.delete('/:id', requireManager, asyncRoute(async (req, res) => {
  const lives = await collection('live_alert_configs');
  await lives.deleteOne({ _id: objectId(req.params.id) });
  res.json({ ok: true });
}));

livesRouter.get('/settings', asyncRoute(async (req, res) => {
  const guildId = defaultGuildId(req);
  try {
    const settings = await getSettings(guildId);
    return res.json({ ok: true, settings: normalizeSettings(settings) });
  } catch {
    return res.json({
      ok: true,
      settings: normalizeSettings({
        guild_id: guildId,
        enabled: true,
        default_alert_channel_id: null,
        default_mention_role_id: null,
        default_message: DEFAULT_MESSAGE,
        check_interval_seconds: DEFAULT_CHECK_INTERVAL_SECONDS
      })
    });
  }
}));

livesRouter.put('/settings/general', requireManager, asyncRoute(async (req, res) => {
  const input = settingsSchema.parse(req.body);
  const guildId = input.guildId || defaultGuildId(req);
  const update = {
    guild_id: guildId,
    enabled: input.enabled !== false,
    default_alert_channel_id: input.defaultAlertChannelId || null,
    default_mention_role_id: input.defaultMentionRoleId || null,
    default_message: input.defaultMessage || DEFAULT_MESSAGE,
    check_interval_seconds: input.checkIntervalSeconds || DEFAULT_CHECK_INTERVAL_SECONDS,
    updated_at: new Date()
  };
  const settings = await collection('live_alert_settings');
  await settings.updateOne({ guild_id: guildId }, { $set: update, $setOnInsert: { created_at: new Date() } }, { upsert: true });
  res.json({ ok: true, settings: normalizeSettings(update) });
}));

livesRouter.post('/:id/test', requireManager, asyncRoute(async (req, res) => {
  const lives = await collection<LiveDoc>('live_alert_configs');
  const live = await lives.findOne({ _id: objectId(req.params.id) });
  if (!live) return res.status(404).json({ ok: false, error: 'Live nao encontrada.' });
  const settings = await getSettings(live.guild_id);
  const result = await sendDiscordAlert({
    ...live,
    last_live_title: live.last_live_title || 'Teste de alerta Vortex',
    last_live_url: live.last_live_url || live.url
  }, settings);
  if (!result.ok) return res.status(400).json(result);
  res.json({ ok: true });
}));
