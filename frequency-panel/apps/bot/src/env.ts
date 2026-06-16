import dotenv from 'dotenv';

dotenv.config({ path: '../../.env' });
dotenv.config();

function firstValue(names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return '';
}

function requiredAny(names: string[]): string {
  const value = firstValue(names);
  if (!value) throw new Error(`Missing env var ${names.join(' or ')}`);
  return value;
}

export const env = {
  discordToken: requiredAny(['DISCORD_TOKEN', 'DISCORD_BOT_TOKEN', 'TOKEN']),
  discordClientId: requiredAny(['DISCORD_CLIENT_ID', 'CLIENT_ID', 'VITE_DISCORD_CLIENT_ID']),
  discordGuildId: requiredAny(['DISCORD_GUILD_ID', 'GUILD_ID', 'VITE_DISCORD_GUILD_ID']),
  apiUrl: process.env.BOT_API_URL || 'http://localhost:4100',
  ingestSecret: requiredAny(['BOT_INGEST_SECRET', 'INGEST_SECRET'])
};
