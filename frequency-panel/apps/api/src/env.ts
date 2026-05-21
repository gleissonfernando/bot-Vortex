import dotenv from 'dotenv';

dotenv.config({ path: '../../.env' });
dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var ${name}`);
  return value;
}

export const env = {
  databaseUrl: required('DATABASE_URL'),
  jwtSecret: required('JWT_SECRET'),
  adminEmail: process.env.ADMIN_EMAIL || 'admin@vortex.local',
  adminPassword: process.env.ADMIN_PASSWORD || 'admin',
  apiPort: Number(process.env.API_PORT || 4100),
  apiOrigin: process.env.API_ORIGIN || 'http://localhost:3000',
  ingestSecret: required('INGEST_SECRET')
};
