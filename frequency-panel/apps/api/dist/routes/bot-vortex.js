import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import { canManageAntiAbuse, configPatchAccess } from '../anti-abuse-access.js';
import { collection } from '../db.js';
const toolSections = [
    { id: 'stats', label: 'Dashboard', description: 'Visao geral do bot, banco e operacao.' },
    { id: 'roles', label: 'Cargos Vortex', description: 'Niveis Admin, Medio e Membro.' },
    { id: 'absence', label: 'Ausencias', description: 'Cargo e mensagens de ausencia.' },
    { id: 'commands', label: 'Comandos', description: 'Permissoes por comando.' },
    { id: 'profile', label: 'Perfil', description: 'Cadastros, cobrancas e perfis.' },
    { id: 'billing', label: 'Cobrancas', description: 'Cobrancas e penalidades automaticas.' },
    { id: 'messages', label: 'Mensagens', description: 'Canais de mensagens em painel.' },
    { id: 'adjust', label: 'Ajuste', description: 'Calls de ajuste.' },
    { id: 'bau', label: 'Bau', description: 'Permissao do painel de bau.' },
    { id: 'security', label: 'Seguranca', description: 'Anti-Abuso, whitelist e punicoes.' },
    { id: 'visual', label: 'Visual', description: 'Tema visual dos paineis.' },
    { id: 'hierarchy', label: 'Hierarquia FAC', description: 'Painel automatico da hierarquia.' },
    { id: 'maintenance', label: 'Manutencao', description: 'Modo manutencao e logs.' }
];
const updateSchema = z.object({
    patch: z.record(z.any())
});
function findRepoRoot() {
    let current = process.cwd();
    for (let i = 0; i < 8; i += 1) {
        if (fs.existsSync(path.join(current, 'commands', 'config.json')))
            return current;
        const next = path.dirname(current);
        if (next === current)
            break;
        current = next;
    }
    return process.cwd();
}
const rootDir = findRepoRoot();
const configPath = path.join(rootDir, 'commands', 'config.json');
export function readConfig() {
    try {
        return JSON.parse(fs.readFileSync(configPath, 'utf8') || '{}');
    }
    catch {
        return {};
    }
}
async function writeConfig(config) {
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    try {
        await (await collection('jsondocuments')).updateOne({ key: 'commands/config.json' }, {
            $set: {
                key: 'commands/config.json',
                sourcePath: configPath,
                data: config,
                updatedAt: new Date()
            }
        }, { upsert: true });
    }
    catch (error) {
        console.warn('[frequency-api] Nao foi possivel sincronizar commands/config.json no Mongo:', error);
    }
}
function pickBotConfig(config) {
    return {
        MAINTENANCE_MODE: config.MAINTENANCE_MODE === true,
        DISABLE_NOTICE_DMS: config.DISABLE_NOTICE_DMS === true,
        DISABLE_CHANNEL_LOGS: config.DISABLE_CHANNEL_LOGS === true,
        DISABLE_DM_LOGS: config.DISABLE_DM_LOGS === true,
        DISABLE_ACTIVITY_LOGS: config.DISABLE_ACTIVITY_LOGS === true,
        PANEL_PRIVATE_MODE: config.PANEL_PRIVATE_MODE === true,
        LOG_CHANNEL: config.LOG_CHANNEL || '',
        DISABLED_LOG_CHANNEL_IDS: Array.isArray(config.DISABLED_LOG_CHANNEL_IDS) ? config.DISABLED_LOG_CHANNEL_IDS : [],
        NOTICE_MENTION_ROLE_ID: config.NOTICE_MENTION_ROLE_ID || '',
        VORTEX_ACCESS_ROLES: config.VORTEX_ACCESS_ROLES || { admin: [], medio: [], membro: [] },
        VORTEX_AUTO_ROLES: config.VORTEX_AUTO_ROLES || { pending: [], approved: [] },
        COMMAND_ROLE_PERMISSIONS: config.COMMAND_ROLE_PERMISSIONS || {},
        COMMAND_DISABLED_COMMANDS: Array.isArray(config.COMMAND_DISABLED_COMMANDS) ? config.COMMAND_DISABLED_COMMANDS : [],
        COMMAND_PERMISSION_HISTORY: Array.isArray(config.COMMAND_PERMISSION_HISTORY) ? config.COMMAND_PERMISSION_HISTORY.slice(-30) : [],
        MIRROR_MESSAGE_CHANNEL_IDS: Array.isArray(config.MIRROR_MESSAGE_CHANNEL_IDS) ? config.MIRROR_MESSAGE_CHANNEL_IDS : [],
        ADJUST_CALL_CHANNEL_IDS: Array.isArray(config.ADJUST_CALL_CHANNEL_IDS) ? config.ADJUST_CALL_CHANNEL_IDS : [],
        ABSENCE_ROLE_ID: config.ABSENCE_ROLE_ID || '',
        ABSENCE_END_MESSAGE_ENABLED: config.ABSENCE_END_MESSAGE_ENABLED !== false,
        PROFILE_BILLING_ENABLED: config.PROFILE_BILLING_ENABLED !== false,
        PROFILE_UPDATE_NOTIFICATIONS_ENABLED: config.PROFILE_UPDATE_NOTIFICATIONS_ENABLED !== false,
        ANTI_ABUSE: normalizeAntiAbuseConfig(config.ANTI_ABUSE),
        PANEL_VISUALS: config.PANEL_VISUALS || {},
        PANEL_THEME: config.PANEL_THEME || {},
        FACTION_HIERARCHY: config.FACTION_HIERARCHY || { channelId: '', messageId: '', roles: {} }
    };
}
async function loadAntiAbuseHistory(guildId) {
    if (!guildId)
        return [];
    try {
        const rows = await (await collection('audit_events'))
            .find({ guild_id: guildId, action: /^anti_abuse\./ })
            .sort({ created_at: -1 })
            .limit(20)
            .toArray();
        return rows.map((row) => ({
            id: String(row._id || ''),
            guild_id: row.guild_id || guildId,
            actor_id: row.actor_id || null,
            target_id: row.target_id || null,
            action: row.action || '',
            payload: row.payload || {},
            created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at || null
        }));
    }
    catch {
        return [];
    }
}
function normalizeIdList(value) {
    return Array.from(new Set((Array.isArray(value) ? value : [])
        .map((item) => String(item || '').trim())
        .filter((item) => /^\d{15,25}$/.test(item))));
}
function normalizeProtection(value) {
    return {
        enabled: value?.enabled === true,
        punishment: ['log', 'warn', 'kick', 'ban'].includes(String(value?.punishment || ''))
            ? String(value.punishment)
            : 'log'
    };
}
function normalizeAntiAbuseConfig(value = {}) {
    const protectionKeys = [
        'antiDisconnect',
        'antiChannelDelete',
        'antiRoleDelete',
        'antiCategoryDelete',
        'antiChannelCreateSpam',
        'antiRoleCreateSpam',
        'antiPermissionChange',
        'antiRoleChange',
        'antiChannelUpdate',
        'antiWebhookAbuse',
        'antiWebhookSpam'
    ];
    const protections = Object.fromEntries(protectionKeys.map((key) => [key, normalizeProtection(value?.protections?.[key])]));
    return {
        enabled: value?.enabled === true,
        shieldedDisconnect: value?.shieldedDisconnect === undefined
            ? protections.antiDisconnect?.enabled === true
            : value.shieldedDisconnect === true,
        protections,
        whitelist: {
            users: normalizeIdList(value?.whitelist?.users),
            roles: normalizeIdList(value?.whitelist?.roles)
        },
        thresholds: {
            channelCreate: Math.max(1, Number(value?.thresholds?.channelCreate || 3)),
            roleCreate: Math.max(1, Number(value?.thresholds?.roleCreate || 3)),
            webhookSpam: Math.max(2, Number(value?.thresholds?.webhookSpam || 5)),
            bulkWindowMs: Math.max(10000, Number(value?.thresholds?.bulkWindowMs || 60000)),
            webhookWindowMs: Math.max(5000, Number(value?.thresholds?.webhookWindowMs || 10000))
        }
    };
}
function mergeAntiAbuseConfig(current = {}, patch = {}) {
    return normalizeAntiAbuseConfig({
        ...current,
        ...patch,
        protections: {
            ...(current?.protections || {}),
            ...(patch?.protections || {})
        },
        whitelist: {
            ...(current?.whitelist || {}),
            ...(patch?.whitelist || {})
        },
        thresholds: {
            ...(current?.thresholds || {}),
            ...(patch?.thresholds || {})
        }
    });
}
export function getMaintenanceStatus(config = readConfig()) {
    const enabled = config.MAINTENANCE_MODE === true;
    const sinceMs = Number(config.MAINTENANCE_SINCE || 0);
    const sinceDate = Number.isFinite(sinceMs) && sinceMs > 0 ? new Date(sinceMs) : null;
    return {
        enabled,
        message: enabled ? 'O sistema esta em manutencao. Nenhum comando, botao, formulario ou automacao fica disponivel ate a liberacao da equipe.' : '',
        since: enabled && sinceDate ? sinceDate.toISOString() : null,
        by: enabled && config.MAINTENANCE_BY ? String(config.MAINTENANCE_BY) : null
    };
}
function sanitizePatch(patch) {
    const allowed = new Set([
        'MAINTENANCE_MODE',
        'DISABLE_NOTICE_DMS',
        'DISABLE_CHANNEL_LOGS',
        'DISABLE_DM_LOGS',
        'DISABLE_ACTIVITY_LOGS',
        'PANEL_PRIVATE_MODE',
        'LOG_CHANNEL',
        'DISABLED_LOG_CHANNEL_IDS',
        'NOTICE_MENTION_ROLE_ID',
        'VORTEX_ACCESS_ROLES',
        'VORTEX_AUTO_ROLES',
        'COMMAND_ROLE_PERMISSIONS',
        'COMMAND_DISABLED_COMMANDS',
        'COMMAND_PERMISSION_HISTORY',
        'MIRROR_MESSAGE_CHANNEL_IDS',
        'ADJUST_CALL_CHANNEL_IDS',
        'ABSENCE_ROLE_ID',
        'ABSENCE_END_MESSAGE_ENABLED',
        'PROFILE_BILLING_ENABLED',
        'PROFILE_UPDATE_NOTIFICATIONS_ENABLED',
        'ANTI_ABUSE',
        'PANEL_VISUALS',
        'PANEL_THEME',
        'FACTION_HIERARCHY'
    ]);
    return Object.fromEntries(Object.entries(patch).filter(([key]) => allowed.has(key)));
}
async function discordOptions(guildId) {
    const token = process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN || process.env.TOKEN;
    if (!token || !guildId)
        return { channels: [], roles: [], error: token ? null : 'Token do bot ausente.' };
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
            .filter((channel) => [0, 2, 4, 5].includes(channel.type))
            .sort((a, b) => Number(a.position || 0) - Number(b.position || 0))
            .map((channel) => ({ id: String(channel.id), name: String(channel.name || 'canal'), type: Number(channel.type || 0) })),
        roles: (Array.isArray(roles) ? roles : [])
            .filter((role) => !role.managed)
            .sort((a, b) => Number(b.position || 0) - Number(a.position || 0))
            .map((role) => ({ id: String(role.id), name: role.name === '@everyone' ? '@everyone' : String(role.name || 'cargo') })),
        error: null
    };
}
export const botVortexRouter = Router();
botVortexRouter.get('/', async (req, res) => {
    const config = readConfig();
    const guildId = process.env.DISCORD_GUILD_ID || process.env.GUILD_ID || config.GUILD_ID || '';
    const [options, antiAbuseHistory] = await Promise.all([
        discordOptions(String(guildId)),
        loadAntiAbuseHistory(String(guildId))
    ]);
    res.json({
        ok: true,
        guildId,
        tools: toolSections,
        config: pickBotConfig(config),
        antiAbuseHistory,
        maintenance: getMaintenanceStatus(config),
        permissions: {
            canManageAntiAbuse: canManageAntiAbuse(req.user)
        },
        options
    });
});
botVortexRouter.put('/config', async (req, res) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ ok: false, error: 'Payload invalido.' });
    const current = readConfig();
    const patch = sanitizePatch(parsed.data.patch || {});
    const access = configPatchAccess(req.user, Object.keys(patch));
    if (access === 'empty') {
        return res.status(400).json({ ok: false, error: 'Nenhuma configuracao valida foi informada.' });
    }
    if (access === 'anti-abuse-forbidden') {
        return res.status(403).json({ ok: false, error: 'Somente os administradores autorizados podem alterar o Anti-Abuso.' });
    }
    if (access === 'manager-forbidden') {
        return res.status(403).json({ ok: false, error: 'Forbidden' });
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'ANTI_ABUSE')) {
        patch.ANTI_ABUSE = mergeAntiAbuseConfig(current.ANTI_ABUSE, patch.ANTI_ABUSE);
    }
    const next = { ...current, ...patch };
    if (Object.prototype.hasOwnProperty.call(patch, 'COMMAND_ROLE_PERMISSIONS')
        || Object.prototype.hasOwnProperty.call(patch, 'COMMAND_DISABLED_COMMANDS')) {
        const changedCommands = new Set();
        if (Object.prototype.hasOwnProperty.call(patch, 'COMMAND_ROLE_PERMISSIONS')) {
            const before = current.COMMAND_ROLE_PERMISSIONS || {};
            const after = patch.COMMAND_ROLE_PERMISSIONS || {};
            for (const command of new Set([...Object.keys(before), ...Object.keys(after)])) {
                if (JSON.stringify(before[command] || []) !== JSON.stringify(after[command] || []))
                    changedCommands.add(command);
            }
        }
        if (Object.prototype.hasOwnProperty.call(patch, 'COMMAND_DISABLED_COMMANDS')) {
            const before = new Set((Array.isArray(current.COMMAND_DISABLED_COMMANDS) ? current.COMMAND_DISABLED_COMMANDS : []).map(String));
            const after = new Set((Array.isArray(patch.COMMAND_DISABLED_COMMANDS) ? patch.COMMAND_DISABLED_COMMANDS : []).map(String));
            for (const command of new Set([...before, ...after])) {
                if (before.has(command) !== after.has(command))
                    changedCommands.add(command);
            }
        }
        if (changedCommands.size) {
            const history = Array.isArray(current.COMMAND_PERMISSION_HISTORY) ? current.COMMAND_PERMISSION_HISTORY : [];
            const actor = req.user?.email || req.user?.id || 'frequency-panel';
            next.COMMAND_PERMISSION_HISTORY = [
                ...history,
                ...Array.from(changedCommands).map((command) => ({
                    user: String(actor),
                    command,
                    at: new Date().toISOString()
                }))
            ].slice(-30);
        }
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'MAINTENANCE_MODE') && current.MAINTENANCE_MODE !== patch.MAINTENANCE_MODE) {
        next.MAINTENANCE_BY = req.user?.id || req.user?.email || 'frequency-panel';
        next.MAINTENANCE_SINCE = Date.now();
    }
    await writeConfig(next);
    res.json({ ok: true, config: pickBotConfig(next), maintenance: getMaintenanceStatus(next), applied: Object.keys(patch) });
});
