import { Router } from 'express';
import { z } from 'zod';
import { requireManager, requireRole } from '../middleware.js';
import { auditLog } from '../security.js';
import { env } from '../env.js';
import { collection } from '../db.js';
import { listSiteUsers, removeSiteUser, siteUserHistory, updateSiteUser, upsertSiteUser } from '../services/site-users.js';
export const siteUsersRouter = Router();
const upsertSchema = z.object({
    discordId: z.string().regex(/^\d{15,25}$/),
    discordName: z.string().min(1).max(120),
    systemRole: z.enum(['admin', 'manager', 'viewer']),
    permissionLevel: z.number().int().min(1).max(100),
    status: z.enum(['active', 'suspended', 'banned']).optional()
});
const updateSchema = z.object({
    systemRole: z.enum(['admin', 'manager', 'viewer']).optional(),
    permissionLevel: z.number().int().min(1).max(100).optional(),
    status: z.enum(['active', 'suspended', 'banned']).optional(),
    discordName: z.string().min(1).max(120).optional()
});
siteUsersRouter.get('/', requireManager, async (req, res) => {
    const users = await listSiteUsers(String(req.query.search || ''));
    return res.json({ ok: true, users });
});
siteUsersRouter.post('/', requireManager, async (req, res) => {
    const parsed = upsertSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ ok: false, error: 'Dados invalidos.' });
    const user = await upsertSiteUser({
        ...parsed.data,
        guildId: env.discordGuildId,
        actorId: req.user?.discordId || req.user?.id,
        actorName: req.user?.name || req.user?.email,
        discordRoles: await fetchDiscordRoleIds(parsed.data.discordId)
    });
    await writeSiteUserAudit(req, 'site_user.created', parsed.data.discordId, parsed.data);
    return res.json({ ok: true, user });
});
siteUsersRouter.put('/:discordId', requireManager, async (req, res) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ ok: false, error: 'Dados invalidos.' });
    const discordId = String(req.params.discordId);
    const user = await updateSiteUser(discordId, {
        system_role: parsed.data.systemRole,
        permission_level: parsed.data.permissionLevel,
        status: parsed.data.status,
        discord_name: parsed.data.discordName
    });
    await writeSiteUserAudit(req, 'site_user.updated', discordId, parsed.data);
    return res.json({ ok: true, user });
});
siteUsersRouter.post('/:discordId/suspend', requireManager, async (req, res) => {
    const discordId = String(req.params.discordId);
    const user = await updateSiteUser(discordId, { status: 'suspended' });
    await writeSiteUserAudit(req, 'site_user.suspended', discordId);
    return res.json({ ok: true, user });
});
siteUsersRouter.post('/:discordId/activate', requireManager, async (req, res) => {
    const discordId = String(req.params.discordId);
    const user = await updateSiteUser(discordId, { status: 'active' });
    await writeSiteUserAudit(req, 'site_user.activated', discordId);
    return res.json({ ok: true, user });
});
siteUsersRouter.post('/:discordId/ban', requireRole('admin'), async (req, res) => {
    const discordId = String(req.params.discordId);
    const user = await updateSiteUser(discordId, { status: 'banned' });
    await writeSiteUserAudit(req, 'site_user.banned', discordId);
    return res.json({ ok: true, user });
});
siteUsersRouter.delete('/:discordId', requireRole('admin'), async (req, res) => {
    const discordId = String(req.params.discordId);
    await removeSiteUser(discordId);
    await writeSiteUserAudit(req, 'site_user.removed', discordId);
    return res.json({ ok: true });
});
siteUsersRouter.get('/:discordId/history', requireManager, async (req, res) => {
    const history = await siteUserHistory(String(req.params.discordId));
    return res.json({ ok: true, history });
});
async function writeSiteUserAudit(req, action, targetDiscordId, metadata = {}) {
    await auditLog(req, action, { target_discord_id: targetDiscordId, ...metadata });
    const logs = await collection('site_user_audit_logs');
    await logs.insertOne({
        action,
        guild_id: env.discordGuildId,
        target_discord_id: targetDiscordId,
        actor_id: req.user?.discordId || req.user?.id || null,
        actor_name: req.user?.name || req.user?.email || null,
        ip: req.ip,
        metadata,
        created_at: new Date()
    });
}
async function fetchDiscordRoleIds(discordId) {
    if (!env.discordBotToken || !env.discordGuildId)
        return [];
    const response = await fetch(`https://discord.com/api/v10/guilds/${env.discordGuildId}/members/${discordId}`, {
        headers: { Authorization: `Bot ${env.discordBotToken}` }
    }).catch(() => null);
    if (!response?.ok)
        return [];
    const member = await response.json().catch(() => null);
    return Array.isArray(member?.roles) ? member.roles.map(String) : [];
}
