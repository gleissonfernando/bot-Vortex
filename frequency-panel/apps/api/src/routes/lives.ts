import { ObjectId } from 'mongodb';
import { Router } from 'express';
import { z } from 'zod';
import { collection, serializeDoc, serializeDocs } from '../db.js';
import { requireManager } from '../middleware.js';

const DEFAULT_MESSAGE = '🔴 {streamer} está ao vivo!\n\n🎮 Plataforma: {platform}\n📺 Título da live: {title}\n👤 Streamer: {streamer}\n🔗 Assistir agora: {url}';
const PLATFORMS = ['twitch', 'youtube', 'kick', 'custom'] as const;

const liveSchema = z.object({
  platform: z.enum(PLATFORMS).optional(),
  url: z.string().url(),
  streamerName: z.string().min(2).max(80),
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
  last_announced_live_id: string | null;
  last_checked_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

function defaultGuildId(req: any) {
  return String(req.query.guildId || req.body?.guildId || process.env.DISCORD_GUILD_ID || process.env.GUILD_ID || 'global');
}

function detectPlatform(url: string) {
  const host = new URL(url).hostname.toLowerCase();
  if (host.includes('twitch.tv')) return 'twitch';
  if (host.includes('youtube.com') || host.includes('youtu.be')) return 'youtube';
  if (host.includes('kick.com')) return 'kick';
  return 'custom';
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
  item.lastCheckedAt = doc.last_checked_at;
  delete item._id;
  delete item.guild_id;
  delete item.streamer_name;
  delete item.alert_channel_id;
  delete item.mention_role_id;
  delete item.custom_message;
  delete item.last_live_title;
  delete item.last_live_url;
  delete item.last_announced_live_id;
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
    check_interval_seconds: 120
  };
}

function normalizeSettings(doc: any) {
  return {
    guildId: doc.guild_id,
    enabled: doc.enabled !== false,
    defaultAlertChannelId: doc.default_alert_channel_id || null,
    defaultMentionRoleId: doc.default_mention_role_id || null,
    defaultMessage: doc.default_message || DEFAULT_MESSAGE,
    checkIntervalSeconds: Number(doc.check_interval_seconds || 120)
  };
}

function objectId(value: unknown) {
  return new ObjectId(String(value || ''));
}

function renderMessage(template: string, live: any, settings: any) {
  return String(template || DEFAULT_MESSAGE)
    .replaceAll('{streamer}', live.streamer_name || live.streamerName || 'Streamer')
    .replaceAll('{platform}', live.platform || 'Live')
    .replaceAll('{title}', live.last_live_title || 'Live da Vortex')
    .replaceAll('{url}', live.last_live_url || live.url)
    .replaceAll('{guild}', settings.guild_id || settings.guildId || '');
}

async function sendDiscordAlert(live: any, settings: any) {
  const token = process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN;
  if (!token) return { ok: false, error: 'DISCORD_TOKEN/DISCORD_BOT_TOKEN ausente na API.' };
  const channelId = live.alert_channel_id || settings.default_alert_channel_id;
  if (!channelId) return { ok: false, error: 'Canal de alerta nao configurado.' };
  const roleId = live.mention_role_id || settings.default_mention_role_id;
  const message = renderMessage(live.custom_message || settings.default_message, live, settings);
  const content = [roleId ? `<@&${roleId}>` : null, message].filter(Boolean).join('\n\n');
  const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      content,
      allowed_mentions: { roles: roleId ? [roleId] : [] }
    })
  });
  if (!response.ok) return { ok: false, error: `Discord HTTP ${response.status}` };
  return { ok: true };
}

export const livesRouter = Router();

livesRouter.get('/', async (req, res) => {
  const guildId = defaultGuildId(req);
  const lives = await collection<LiveDoc>('live_alert_configs');
  const rows = await lives.find({ guild_id: guildId }).sort({ created_at: -1 }).toArray();
  const settings = await getSettings(guildId);
  res.json({ ok: true, lives: rows.map(normalizeLive), settings: normalizeSettings(settings) });
});

livesRouter.post('/', requireManager, async (req, res) => {
  const input = liveSchema.parse(req.body);
  const guildId = input.guildId || defaultGuildId(req);
  const now = new Date();
  const doc: LiveDoc = {
    guild_id: guildId,
    platform: input.platform || detectPlatform(input.url),
    url: input.url.trim(),
    streamer_name: input.streamerName.trim(),
    alert_channel_id: input.alertChannelId || null,
    mention_role_id: input.mentionRoleId || null,
    enabled: input.enabled !== false,
    custom_message: input.customMessage || null,
    status: 'unknown',
    last_live_title: null,
    last_live_url: null,
    last_announced_live_id: null,
    last_checked_at: null,
    created_at: now,
    updated_at: now
  };
  const lives = await collection<LiveDoc>('live_alert_configs');
  const result = await lives.insertOne(doc);
  res.status(201).json({ ok: true, live: normalizeLive({ ...doc, _id: result.insertedId }) });
});

livesRouter.put('/:id', requireManager, async (req, res) => {
  const input = liveSchema.partial().parse(req.body);
  const update: any = { updated_at: new Date() };
  if (input.url) {
    update.url = input.url.trim();
    update.platform = input.platform || detectPlatform(input.url);
  } else if (input.platform) {
    update.platform = input.platform;
  }
  if (input.streamerName !== undefined) update.streamer_name = input.streamerName.trim();
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
});

livesRouter.delete('/:id', requireManager, async (req, res) => {
  const lives = await collection('live_alert_configs');
  await lives.deleteOne({ _id: objectId(req.params.id) });
  res.json({ ok: true });
});

livesRouter.get('/settings', async (req, res) => {
  const settings = await getSettings(defaultGuildId(req));
  res.json({ ok: true, settings: normalizeSettings(settings) });
});

livesRouter.put('/settings/general', requireManager, async (req, res) => {
  const input = settingsSchema.parse(req.body);
  const guildId = input.guildId || defaultGuildId(req);
  const update = {
    guild_id: guildId,
    enabled: input.enabled !== false,
    default_alert_channel_id: input.defaultAlertChannelId || null,
    default_mention_role_id: input.defaultMentionRoleId || null,
    default_message: input.defaultMessage || DEFAULT_MESSAGE,
    check_interval_seconds: input.checkIntervalSeconds || 120,
    updated_at: new Date()
  };
  const settings = await collection('live_alert_settings');
  await settings.updateOne({ guild_id: guildId }, { $set: update, $setOnInsert: { created_at: new Date() } }, { upsert: true });
  res.json({ ok: true, settings: normalizeSettings(update) });
});

livesRouter.post('/:id/test', requireManager, async (req, res) => {
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
});
