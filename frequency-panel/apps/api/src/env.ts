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

export const env = {
  mongoUri,
  mongoEnabled: Boolean(mongoUri),
  jwtSecret: requiredSecret('JWT_SECRET', 32),
  adminEmail: optionalEmail('ADMIN_EMAIL'),
  adminPassword: optionalSecret('ADMIN_PASSWORD', 12, ['vortex']),
  apiPort: Number(process.env.API_PORT || 4100),
  apiOrigin: process.env.API_ORIGIN || 'http://localhost:3000',
  ingestSecret: requiredSecret('INGEST_SECRET', 32)
};
