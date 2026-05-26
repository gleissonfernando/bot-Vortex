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
  const normalized = value.toLowerCase();
  const blocked = blockedValues.some((blockedValue) => normalized === blockedValue.toLowerCase());
  if (value.length < minLength || blocked || /^(change-this|replace-|put-your-)/i.test(value)) {
    throw new Error(`${name} must be changed to a strong private value`);
  }
  return value;
}

function requiredEmail(name: string): string {
  const value = required(name).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || ['admin@example.com', 'admin@vortex.local', 'vortex@adimin.com'].includes(value)) {
    throw new Error(`${name} must be changed to a private admin email`);
  }
  return value;
}

const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DATABASE_URL || '';

export const env = {
  mongoUri,
  mongoEnabled: Boolean(mongoUri),
  jwtSecret: requiredSecret('JWT_SECRET', 32),
  adminEmail: requiredEmail('ADMIN_EMAIL'),
  adminPassword: requiredSecret('ADMIN_PASSWORD', 12, ['vortex']),
  apiPort: Number(process.env.API_PORT || 4100),
  apiOrigin: process.env.API_ORIGIN || 'http://localhost:3000',
  ingestSecret: requiredSecret('INGEST_SECRET', 32)
};
