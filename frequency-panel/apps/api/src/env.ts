import dotenv from 'dotenv';

dotenv.config({ path: '../../.env' });
dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var ${name}`);
  return value;
}

const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DATABASE_URL || '';

export const env = {
  mongoUri,
  mongoEnabled: Boolean(mongoUri),
  jwtSecret: required('JWT_SECRET'),
  adminEmail: process.env.ADMIN_EMAIL || 'vortex@adimin.com',
  adminPassword: process.env.ADMIN_PASSWORD || 'vortex',
  apiPort: Number(process.env.API_PORT || 4100),
  apiOrigin: process.env.API_ORIGIN || 'http://localhost:3000',
  ingestSecret: required('INGEST_SECRET')
};
