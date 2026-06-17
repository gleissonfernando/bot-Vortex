import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { env } from './env.js';
import { collection, serializeDoc } from './db.js';
import { findSiteUser, markSiteUserLogin } from './services/site-users.js';
export async function ensureAdminUser() {
    if (!env.adminEmail || (!env.adminPassword && !env.adminPasswordHash)) {
        console.warn('[frequency-api] ADMIN_EMAIL/ADMIN_PASSWORD invalidos ou ausentes. API ativa, mas usuario admin automatico/fallback desativado.');
        return;
    }
    if (!env.mongoEnabled) {
        console.warn('[frequency-api] MongoDB ausente. Login administrativo usara fallback por ADMIN_EMAIL/ADMIN_PASSWORD.');
        return;
    }
    const hash = env.adminPasswordHash || await bcrypt.hash(env.adminPassword, 12);
    try {
        const users = await collection('app_users');
        const now = new Date();
        await users.updateOne({ email: env.adminEmail.toLowerCase() }, {
            $set: {
                email: env.adminEmail.toLowerCase(),
                name: 'Vortex Admin',
                password_hash: hash,
                role: 'admin',
                updated_at: now
            },
            $setOnInsert: {
                id: randomUUID(),
                created_at: now
            }
        }, { upsert: true });
    }
    catch (error) {
        console.warn('[frequency-api] MongoDB indisponivel. Login administrativo usara fallback por ADMIN_EMAIL/ADMIN_PASSWORD.', error);
    }
}
export async function login(email, password) {
    if (!String(process.env.ALLOW_PASSWORD_LOGIN || '').toLowerCase().includes('true')) {
        return null;
    }
    if (!env.mongoEnabled) {
        return fallbackLogin(email, password);
    }
    let user = null;
    try {
        const users = await collection('app_users');
        user = serializeDoc(await users.findOne({ email: email.toLowerCase() }));
    }
    catch (error) {
        console.warn('[frequency-api] Falha ao consultar MongoDB no login. Usando fallback administrativo.', error);
        return fallbackLogin(email, password);
    }
    if (!user)
        return fallbackLogin(email, password);
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid)
        return null;
    const sessionUser = {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
    };
    return signSession(sessionUser);
}
async function fallbackLogin(email, password) {
    if (!env.adminEmail || (!env.adminPassword && !env.adminPasswordHash))
        return null;
    if (email.toLowerCase() !== env.adminEmail.toLowerCase())
        return null;
    if (env.adminPasswordHash) {
        const valid = await bcrypt.compare(password, env.adminPasswordHash);
        if (!valid)
            return null;
    }
    else if (password !== env.adminPassword) {
        return null;
    }
    const sessionUser = {
        id: 'fallback-admin',
        email: env.adminEmail.toLowerCase(),
        name: 'Vortex Admin',
        role: 'admin'
    };
    return signSession(sessionUser);
}
export function signSession(user) {
    const token = jwt.sign(user, env.jwtSecret, { expiresIn: env.jwtExpiresIn });
    const refreshToken = jwt.sign({ ...user, token_type: 'refresh' }, env.refreshJwtSecret, {
        expiresIn: env.refreshTokenExpiresIn
    });
    return { token, refreshToken, user };
}
export async function sessionFromRegisteredDiscordUser(input) {
    const siteUser = await findSiteUser(input.guildId, input.discordId);
    if (!siteUser) {
        return { ok: false, error: 'Acesso Negado. Sua conta não foi cadastrada pela administração. Solicite a liberação para um responsável autorizado.' };
    }
    if (siteUser.status === 'suspended') {
        return { ok: false, error: 'Acesso negado. Sua conta está suspensa temporariamente.' };
    }
    if (siteUser.status === 'banned') {
        return { ok: false, error: 'Acesso negado. Sua conta foi banida do sistema.' };
    }
    await markSiteUserLogin(input.discordId, input.guildId);
    return {
        ok: true,
        session: signSession(siteUserToSession(siteUser, input.discordName))
    };
}
export async function sessionFromDiscordOAuthUser(input) {
    const siteUser = await findSiteUser(input.guildId, input.discordId).catch(() => null);
    if (!siteUser) {
        return { ok: false, error: 'Acesso negado. Sua conta nao foi cadastrada pela administracao.' };
    }
    if (siteUser.status === 'suspended') {
        return { ok: false, error: 'Acesso negado. Sua conta esta suspensa temporariamente.' };
    }
    if (siteUser.status === 'banned') {
        return { ok: false, error: 'Acesso negado. Sua conta foi banida do sistema.' };
    }
    await markSiteUserLogin(input.discordId, input.guildId);
    const sessionUser = {
        id: siteUser.id,
        email: input.email || siteUser.discord_email || `${input.discordId}@discord.local`,
        name: input.displayName || siteUser.discord_name || input.username || input.discordId,
        role: siteUser.system_role,
        discordId: input.discordId,
        username: input.username,
        avatar: input.avatar || siteUser.discord_avatar_url || null,
        guilds: input.guilds,
        guildId: input.guildId
    };
    return {
        ok: true,
        session: signSession(sessionUser)
    };
}
function siteUserToSession(siteUser, discordName) {
    return {
        id: siteUser.id,
        email: `${siteUser.discord_id}@discord.local`,
        name: discordName || siteUser.discord_name || siteUser.discord_id,
        role: siteUser.system_role,
        discordId: siteUser.discord_id,
        guildId: siteUser.guild_id
    };
}
export function verifyToken(token) {
    try {
        return jwt.verify(token, env.jwtSecret);
    }
    catch {
        return null;
    }
}
export function refreshSession(refreshToken) {
    try {
        const payload = jwt.verify(refreshToken, env.refreshJwtSecret);
        if (payload.token_type !== 'refresh')
            return null;
        return signSession({
            id: payload.id,
            email: payload.email,
            name: payload.name,
            role: payload.role,
            discordId: payload.discordId,
            username: payload.username,
            avatar: payload.avatar,
            guilds: payload.guilds,
            guildId: payload.guildId
        });
    }
    catch {
        return null;
    }
}
