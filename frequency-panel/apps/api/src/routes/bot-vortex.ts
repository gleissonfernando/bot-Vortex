import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import { requireManager } from '../middleware.js';

const toolSections = [
  { id: 'stats', label: 'Dashboard', description: 'Visao geral do bot, banco e operacao.' },
  { id: 'roles', label: 'Cargos Vortex', description: 'Niveis Admin, Medio e Membro.' },
  { id: 'points', label: 'Pontos', description: 'Canais, cargos e automacao de ponto.' },
  { id: 'absence', label: 'Ausencias', description: 'Cargo e mensagens de ausencia.' },
  { id: 'commands', label: 'Comandos', description: 'Permissoes por comando.' },
  { id: 'profile', label: 'Perfil', description: 'Cadastros, cobrancas e perfis.' },
  { id: 'billing', label: 'Cobrancas', description: 'Cobrancas e penalidades automaticas.' },
  { id: 'messages', label: 'Mensagens', description: 'Canais de mensagens em painel.' },
  { id: 'bau', label: 'Bau', description: 'Permissao do painel de bau.' },
  { id: 'visual', label: 'Visual', description: 'Tema visual dos paineis.' },
  { id: 'maintenance', label: 'Manutencao', description: 'Modo manutencao e logs.' }
];

const updateSchema = z.object({
  patch: z.record(z.any())
});

function findRepoRoot() {
  let current = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(current, 'commands', 'config.json'))) return current;
    const next = path.dirname(current);
    if (next === current) break;
    current = next;
  }
  return process.cwd();
}

const rootDir = findRepoRoot();
const configPath = path.join(rootDir, 'commands', 'config.json');

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8') || '{}');
  } catch {
    return {};
  }
}

function writeConfig(config: Record<string, any>) {
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

function pickBotConfig(config: Record<string, any>) {
  return {
    MAINTENANCE_MODE: config.MAINTENANCE_MODE === true,
    DISABLE_NOTICE_DMS: config.DISABLE_NOTICE_DMS === true,
    DISABLE_CHANNEL_LOGS: config.DISABLE_CHANNEL_LOGS === true,
    DISABLE_DM_LOGS: config.DISABLE_DM_LOGS === true,
    DISABLE_ACTIVITY_LOGS: config.DISABLE_ACTIVITY_LOGS === true,
    PANEL_PRIVATE_MODE: config.PANEL_PRIVATE_MODE === true,
    NOTICE_MENTION_ROLE_ID: config.NOTICE_MENTION_ROLE_ID || '',
    POINT_ACTION_CHANNEL_ID: config.POINT_ACTION_CHANNEL_ID || '',
    POINT_ONLINE_CHANNEL_ID: config.POINT_ONLINE_CHANNEL_ID || '',
    POINT_ONLINE_VOICE_CHANNEL_ID: config.POINT_ONLINE_VOICE_CHANNEL_ID || '',
    POINT_ADJUST_CATEGORY_ID: config.POINT_ADJUST_CATEGORY_ID || '',
    POINT_ALLOWED_ROLE_IDS: Array.isArray(config.POINT_ALLOWED_ROLE_IDS) ? config.POINT_ALLOWED_ROLE_IDS : [],
    POINT_ADJUST_STAFF_ROLES: Array.isArray(config.POINT_ADJUST_STAFF_ROLES) ? config.POINT_ADJUST_STAFF_ROLES : [],
    POINT_MONITOR_ENABLED: config.POINT_MONITOR_ENABLED !== false,
    POINT_OFFLINE_CHARGE_ENABLED: config.POINT_OFFLINE_CHARGE_ENABLED !== false,
    POINT_MONITOR_DM_INTERVAL_HOURS: Number(config.POINT_MONITOR_DM_INTERVAL_HOURS || 4),
    POINT_MONITOR_AUTO_CLOSE_HOURS: Number(config.POINT_MONITOR_AUTO_CLOSE_HOURS || 6),
    POINT_MONITOR_MAX_DM_ATTEMPTS: Number(config.POINT_MONITOR_MAX_DM_ATTEMPTS || 3),
    POINT_OFFLINE_THRESHOLD_HOURS: Number(config.POINT_OFFLINE_THRESHOLD_HOURS || 12),
    VORTEX_ROLE_LEVELS: config.VORTEX_ROLE_LEVELS || { admin: [], medio: [], membro: [] },
    COMMAND_ROLE_PERMISSIONS: config.COMMAND_ROLE_PERMISSIONS || {},
    MIRROR_MESSAGE_CHANNEL_IDS: Array.isArray(config.MIRROR_MESSAGE_CHANNEL_IDS) ? config.MIRROR_MESSAGE_CHANNEL_IDS : [],
    ABSENCE_ROLE_ID: config.ABSENCE_ROLE_ID || '',
    ABSENCE_END_MESSAGE_ENABLED: config.ABSENCE_END_MESSAGE_ENABLED !== false,
    PROFILE_BILLING_ENABLED: config.PROFILE_BILLING_ENABLED !== false,
    PROFILE_UPDATE_NOTIFICATIONS_ENABLED: config.PROFILE_UPDATE_NOTIFICATIONS_ENABLED !== false,
    PANEL_THEME: config.PANEL_THEME || {}
  };
}

function sanitizePatch(patch: Record<string, any>) {
  const allowed = new Set([
    'MAINTENANCE_MODE',
    'DISABLE_NOTICE_DMS',
    'DISABLE_CHANNEL_LOGS',
    'DISABLE_DM_LOGS',
    'DISABLE_ACTIVITY_LOGS',
    'PANEL_PRIVATE_MODE',
    'NOTICE_MENTION_ROLE_ID',
    'POINT_ACTION_CHANNEL_ID',
    'POINT_ONLINE_CHANNEL_ID',
    'POINT_ONLINE_VOICE_CHANNEL_ID',
    'POINT_ADJUST_CATEGORY_ID',
    'POINT_ALLOWED_ROLE_IDS',
    'POINT_ADJUST_STAFF_ROLES',
    'POINT_MONITOR_ENABLED',
    'POINT_OFFLINE_CHARGE_ENABLED',
    'POINT_MONITOR_DM_INTERVAL_HOURS',
    'POINT_MONITOR_AUTO_CLOSE_HOURS',
    'POINT_MONITOR_MAX_DM_ATTEMPTS',
    'POINT_OFFLINE_THRESHOLD_HOURS',
    'VORTEX_ROLE_LEVELS',
    'COMMAND_ROLE_PERMISSIONS',
    'MIRROR_MESSAGE_CHANNEL_IDS',
    'ABSENCE_ROLE_ID',
    'ABSENCE_END_MESSAGE_ENABLED',
    'PROFILE_BILLING_ENABLED',
    'PROFILE_UPDATE_NOTIFICATIONS_ENABLED',
    'PANEL_THEME'
  ]);
  return Object.fromEntries(Object.entries(patch).filter(([key]) => allowed.has(key)));
}

async function discordOptions(guildId: string) {
  const token = process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN;
  if (!token || !guildId) return { channels: [], roles: [], error: token ? null : 'Token do bot ausente.' };
  const headers = { Authorization: `Bot ${token}` };
  const [channelsResponse, rolesResponse] = await Promise.all([
    fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, { headers }),
    fetch(`https://discord.com/api/v10/guilds/${guildId}/roles`, { headers })
  ]);
  if (!channelsResponse.ok || !rolesResponse.ok) {
    return { channels: [], roles: [], error: `Discord HTTP ${channelsResponse.status}/${rolesResponse.status}` };
  }
  const channels = await channelsResponse.json();
  const roles = await rolesResponse.json();
  return {
    channels: (Array.isArray(channels) ? channels : [])
      .filter((channel: any) => [0, 2, 4, 5].includes(channel.type))
      .sort((a: any, b: any) => Number(a.position || 0) - Number(b.position || 0))
      .map((channel: any) => ({ id: String(channel.id), name: String(channel.name || 'canal'), type: Number(channel.type || 0) })),
    roles: (Array.isArray(roles) ? roles : [])
      .filter((role: any) => !role.managed)
      .sort((a: any, b: any) => Number(b.position || 0) - Number(a.position || 0))
      .map((role: any) => ({ id: String(role.id), name: role.name === '@everyone' ? '@everyone' : String(role.name || 'cargo') })),
    error: null
  };
}

export const botVortexRouter = Router();

botVortexRouter.get('/', async (_req, res) => {
  const config = readConfig();
  const guildId = process.env.DISCORD_GUILD_ID || process.env.GUILD_ID || config.GUILD_ID || '';
  const options = await discordOptions(String(guildId));
  res.json({
    ok: true,
    guildId,
    tools: toolSections,
    config: pickBotConfig(config),
    options
  });
});

botVortexRouter.put('/config', requireManager, async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: 'Payload invalido.' });
  const current = readConfig();
  const patch = sanitizePatch(parsed.data.patch || {});
  const next = { ...current, ...patch };
  writeConfig(next);
  res.json({ ok: true, config: pickBotConfig(next), applied: Object.keys(patch) });
});
