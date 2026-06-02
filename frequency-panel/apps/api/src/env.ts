import dotenv from 'dotenv';

dotenv.config({ path: '../../.env' });
dotenv.config();

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing env var ${name}`);
  return value;
}

function requiredSecret(name: string, minLength: number, blockedValues: string[] = []): string {
  const value = required(name);
  const valid = validateSecretValue(value, minLength, blockedValues);
  if (!valid) throw new Error(`${name} must be changed to a strong private value`);
  return value;
}

function optionalSecret(name: string, minLength: number, blockedValues: string[] = []): string {
  const value = process.env[name]?.trim() || '';
  if (!value) return '';
  return validateSecretValue(value, minLength, blockedValues) ? value : '';
}

function validateSecretValue(value: string, minLength: number, blockedValues: string[] = []) {
  const normalized = value.toLowerCase();
  const blocked = blockedValues.some((blockedValue) => normalized === blockedValue.toLowerCase());
  return value.length >= minLength && !blocked && !/^(change-this|replace-|put-your-)/i.test(value);
}

function optionalEmail(name: string): string {
  const value = process.env[name]?.trim().toLowerCase() || '';
  if (!value) return '';
  const blocked = ['admin@example.com', 'admin@vortex.local', 'vortex@adimin.com'].includes(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && !blocked ? value : '';
}

const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DATABASE_URL || '';
const siteOrigin = process.env.SITE_ORIGIN || process.env.NEXT_PUBLIC_SITE_URL || 'https://bot-vortex.shardweb.app';
const defaultDiscordOauthRedirectUri = `${siteOrigin.replace(/\/+$/, '')}/api/auth/discord/callback`;

export const env = {
  mongoUri,
  mongoEnabled: Boolean(mongoUri),
  jwtSecret: requiredSecret('JWT_SECRET', 32),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '2h',
  refreshJwtSecret: optionalSecret('JWT_REFRESH_SECRET', 32) || `${requiredSecret('JWT_SECRET', 32)}:refresh`,
  refreshTokenExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  adminEmail: optionalEmail('ADMIN_EMAIL'),
  adminPassword: optionalSecret('ADMIN_PASSWORD', 12, ['vortex']),
  adminPasswordHash: optionalSecret('ADMIN_PASSWORD_HASH', 30),
  apiPort: Number(process.env.API_PORT || 4100),
  apiOrigin: process.env.API_ORIGIN || 'http://localhost:3000',
  siteOrigin,
  ingestSecret: requiredSecret('INGEST_SECRET', 32),
  discordClientId: process.env.DISCORD_CLIENT_ID || '',
  discordClientSecret: process.env.DISCORD_CLIENT_SECRET || '',
  discordOauthRedirectUri: process.env.DISCORD_OAUTH_REDIRECT_URI || defaultDiscordOauthRedirectUri,
  discordBotToken: process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN || '',
  discordGuildId: process.env.DISCORD_GUILD_ID || process.env.GUILD_ID || '',
  discordIdLoginEnabled: String(process.env.DISCORD_ID_LOGIN_ENABLED || '').toLowerCase() === 'true',
  apiRateLimitWindowMs: Number(process.env.API_RATE_LIMIT_WINDOW_MS || 60 * 1000),
  apiRateLimitMax: Number(process.env.API_RATE_LIMIT_MAX || 180),
  sessionIdleTimeoutMs: Number(process.env.SESSION_IDLE_TIMEOUT_MS || 30 * 60 * 1000),
  backupDir: process.env.BACKUP_DIR || 'backups'
};
