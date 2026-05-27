import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collection } from '../db.js';

type ProfileData = Record<string, any>;
type RegisteredProfileRef = {
  guildId: string | null;
  userId: string;
};

type JsonDocumentRecord = {
  key?: string;
  data?: unknown;
};

function normalizeDiscordId(value: unknown) {
  const text = String(value || '').trim();
  return /^\d{15,25}$/.test(text) ? text : null;
}

function resolveProfilesPath() {
  const candidates: string[] = [];

  for (const start of [process.cwd(), path.dirname(fileURLToPath(import.meta.url))]) {
    let current = start;
    for (let depth = 0; depth < 10; depth += 1) {
      candidates.push(path.join(current, 'commands', 'perfis.json'));
      const next = path.dirname(current);
      if (next === current) break;
      current = next;
    }
  }

  return candidates.find((candidate) => fs.existsSync(candidate))
    || path.join(process.cwd(), 'commands', 'perfis.json');
}

function readProfilesFromDisk() {
  const filePath = resolveProfilesPath();
  if (!fs.existsSync(filePath)) return {};

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8') || '{}') as ProfileData;
  } catch (error) {
    console.warn('[frequency-api] Nao foi possivel ler commands/perfis.json:', error);
    return {};
  }
}

async function readProfilesFromMongo() {
  try {
    const documents = await collection<JsonDocumentRecord>('jsondocuments');
    const document = await documents.findOne({ key: 'commands/perfis.json' });
    const data = document?.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    return data as ProfileData;
  } catch (error) {
    console.warn('[frequency-api] Nao foi possivel ler commands/perfis.json no MongoDB:', error);
    return null;
  }
}

async function readProfiles() {
  return await readProfilesFromMongo() || readProfilesFromDisk();
}

function hasRegistrationData(profile: any) {
  return Boolean(profile && typeof profile === 'object' && (
    profile.approvedAt
    || profile.registeredManually
    || profile.registeredBy
    || profile.createdAt
    || profile.nomeGame
    || profile.idGame
    || profile.callChannelId
  ));
}

function addProfileRef(refs: RegisteredProfileRef[], seen: Set<string>, guildId: unknown, userId: unknown, profile: any) {
  const normalizedUserId = normalizeDiscordId(userId);
  if (!normalizedUserId || !hasRegistrationData(profile)) return;

  const normalizedGuildId = normalizeDiscordId(guildId);
  const key = `${normalizedGuildId || '*'}:${normalizedUserId}`;
  if (seen.has(key)) return;

  seen.add(key);
  refs.push({ guildId: normalizedGuildId, userId: normalizedUserId });
}

export async function getRegisteredProfileRefs(guildId?: string | null) {
  const data = await readProfiles();
  const refs: RegisteredProfileRef[] = [];
  const seen = new Set<string>();
  const requestedGuildId = normalizeDiscordId(guildId);

  for (const [topKey, topValue] of Object.entries(data)) {
    if (!topValue || typeof topValue !== 'object') continue;

    const directUserId = normalizeDiscordId(topValue.userId) || normalizeDiscordId(topKey);
    if (directUserId && hasRegistrationData(topValue)) {
      addProfileRef(refs, seen, topValue.guildId || null, directUserId, topValue);
      continue;
    }

    for (const [profileKey, profile] of Object.entries(topValue)) {
      if (!profile || typeof profile !== 'object') continue;
      const userId = normalizeDiscordId((profile as any).userId) || normalizeDiscordId(profileKey);
      addProfileRef(refs, seen, (profile as any).guildId || topKey, userId, profile);
    }
  }

  if (!requestedGuildId) return refs;
  return refs.filter((ref) => !ref.guildId || ref.guildId === requestedGuildId);
}

export async function buildRegisteredMemberFilter(guildId?: string | null) {
  const refs = await getRegisteredProfileRefs(guildId);
  if (!refs.length) return { discord_user_id: { $in: [] } };

  const requestedGuildId = normalizeDiscordId(guildId);
  const userIds = [...new Set(refs.map((ref) => ref.userId))];
  if (requestedGuildId) return { discord_user_id: { $in: userIds } };

  const clauses: Record<string, any>[] = refs
    .filter((ref) => ref.guildId)
    .map((ref) => ({ guild_id: ref.guildId, discord_user_id: ref.userId }));
  const globalUserIds = refs.filter((ref) => !ref.guildId).map((ref) => ref.userId);
  if (globalUserIds.length) clauses.push({ discord_user_id: { $in: [...new Set(globalUserIds)] } });

  return clauses.length === 1 ? clauses[0] : { $or: clauses };
}

export async function isRegisteredProfile(guildId: unknown, userId: unknown) {
  const normalizedGuildId = normalizeDiscordId(guildId);
  const normalizedUserId = normalizeDiscordId(userId);
  if (!normalizedUserId) return false;

  return (await getRegisteredProfileRefs(normalizedGuildId)).some((ref) => (
    ref.userId === normalizedUserId && (!normalizedGuildId || !ref.guildId || ref.guildId === normalizedGuildId)
  ));
}
