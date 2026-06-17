import { env } from './env.js';
import { collection } from './db.js';
const buckets = new Map();
export function getClientIp(req) {
    const forwardedFor = String(req.headers['x-forwarded-for'] || '').split(',')[0]?.trim();
    return forwardedFor || req.ip || req.socket.remoteAddress || 'unknown';
}
export function rateLimit(options) {
    return (req, res, next) => {
        const now = Date.now();
        if (buckets.size > 5000)
            cleanupExpiredBuckets(now);
        const key = `${options.keyPrefix}:${getClientIp(req)}`;
        const bucket = buckets.get(key);
        if (!bucket || bucket.resetAt <= now) {
            buckets.set(key, { count: 1, resetAt: now + options.windowMs });
            return next();
        }
        bucket.count += 1;
        if (bucket.count > options.max) {
            res.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
            return res.status(429).json({ ok: false, error: 'Limite de requisicoes excedido. Tente novamente em instantes.' });
        }
        return next();
    };
}
function cleanupExpiredBuckets(now = Date.now()) {
    for (const [key, bucket] of buckets) {
        if (bucket.resetAt <= now)
            buckets.delete(key);
    }
}
export function requireTrustedOrigin(req, res, next) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method))
        return next();
    const origin = String(req.headers.origin || '');
    const referer = String(req.headers.referer || '');
    const requestOrigin = origin || (referer ? safeOrigin(referer) : '');
    if (!requestOrigin)
        return next();
    if (requestOrigin === env.apiOrigin)
        return next();
    return res.status(403).json({ ok: false, error: 'Origem da requisicao nao autorizada' });
}
function safeOrigin(value) {
    try {
        return new URL(value).origin;
    }
    catch {
        return '';
    }
}
export async function auditLog(req, action, metadata = {}) {
    const entry = {
        action,
        metadata,
        ip: getClientIp(req),
        method: req.method,
        path: req.originalUrl,
        user_agent: String(req.headers['user-agent'] || ''),
        user: req.user
            ? {
                id: req.user.id,
                email: req.user.email,
                role: req.user.role
            }
            : null,
        created_at: new Date()
    };
    try {
        if (!env.mongoEnabled) {
            console.info('[audit]', entry);
            return;
        }
        const logs = await collection('security_audit_logs');
        await logs.insertOne(entry);
    }
    catch (error) {
        console.warn('[frequency-api] Falha ao registrar auditoria:', error);
    }
}
