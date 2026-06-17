import { timingSafeEqual } from 'node:crypto';
import { env } from './env.js';
import { verifyToken } from './auth.js';
import { findSiteUser } from './services/site-users.js';
export async function requireAuth(req, res, next) {
    res.setHeader('Cache-Control', 'no-store');
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : getCookie(req, 'vortex_access_token');
    const user = token ? verifyToken(token) : null;
    if (!user)
        return res.status(401).json({ ok: false, error: 'Unauthorized' });
    if (user.discordId) {
        let siteUser = null;
        try {
            siteUser = await findSiteUser(user.guildId || env.discordGuildId, user.discordId);
        }
        catch (error) {
            console.warn('[frequency-api] Falha ao confirmar acesso do usuario; mantendo sessao assinada.', {
                guildId: user.guildId || env.discordGuildId,
                discordId: user.discordId,
                error: error instanceof Error ? error.message : String(error)
            });
            req.user = user;
            return next();
        }
        if (!siteUser || siteUser.status !== 'active') {
            res.clearCookie('vortex_access_token', { path: '/' });
            res.clearCookie('vortex_refresh_token', { path: '/' });
            const error = !siteUser
                ? 'Acesso negado. Sua conta nao foi cadastrada pela administracao.'
                : siteUser.status === 'banned'
                    ? 'Acesso negado. Sua conta foi banida do sistema.'
                    : 'Acesso negado. Sua conta esta suspensa temporariamente.';
            return res.status(403).json({ ok: false, error });
        }
        user.role = siteUser.system_role;
        user.name = siteUser.discord_name || user.name;
    }
    req.user = user;
    next();
}
export function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            return res.status(403).json({ ok: false, error: 'Forbidden' });
        }
        return next();
    };
}
export function requireManager(req, res, next) {
    if (!req.user || !['admin', 'manager'].includes(req.user.role)) {
        return res.status(403).json({ ok: false, error: 'Forbidden' });
    }
    next();
}
export function requireIngestSecret(req, res, next) {
    const secret = String(req.headers['x-ingest-secret'] || '');
    if (!secret || !safeSecretEqual(secret, env.ingestSecret)) {
        return res.status(401).json({ ok: false, error: 'Invalid ingest secret' });
    }
    next();
}
function safeSecretEqual(input, expected) {
    const inputBuffer = Buffer.from(input);
    const expectedBuffer = Buffer.from(expected);
    if (inputBuffer.length !== expectedBuffer.length)
        return false;
    return timingSafeEqual(inputBuffer, expectedBuffer);
}
function getCookie(req, name) {
    const cookies = String(req.headers.cookie || '').split(';');
    for (const cookie of cookies) {
        const [key, ...value] = cookie.trim().split('=');
        if (key === name)
            return decodeURIComponent(value.join('='));
    }
    return '';
}
