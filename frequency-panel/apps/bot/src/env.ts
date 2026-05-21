import dotenv from 'dotenv';

dotenv.config({ path: '../../.env' });
dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var ${name}`);
  return value;
}

export const env = {
  discordToken: required('DISCORD_TOKEN'),
  discordClientId: required('DISCORD_CLIENT_ID'),
  discordGuildId: required('DISCORD_GUILD_ID'),
  apiUrl: process.env.BOT_API_URL || 'http://localhost:4100',
  ingestSecret: required('BOT_INGEST_SECRET')
};
