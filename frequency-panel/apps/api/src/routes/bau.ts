import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';

const chestMeta = {
  membros: { id: 'membros', label: 'Bau Membros', description: 'Estoque dos membros cadastrados.' },
  gerencia: { id: 'gerencia', label: 'Bau Gerencia', description: 'Estoque reservado para a gerencia.' }
};

function findRepoRoot() {
  let current = process.cwd();
  for (let index = 0; index < 8; index += 1) {
    if (fs.existsSync(path.join(current, 'commands'))) return current;
    const next = path.dirname(current);
    if (next === current) break;
    current = next;
  }
  return process.cwd();
}

const rootDir = findRepoRoot();
const storagePath = path.join(rootDir, 'commands', 'bauStorage.json');

function readStorage(): Record<string, any> {
  try {
    return JSON.parse(fs.readFileSync(storagePath, 'utf8') || '{}');
  } catch {
    return { version: 1, guilds: {} };
  }
}

function toNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
}

function normalizeItems(chest: Record<string, any>) {
  return Object.values(chest?.items || {})
    .filter((item: any) => item && item.id)
    .map((item: any) => ({
      id: String(item.id),
      name: String(item.name || item.id),
      quantity: toNumber(item.quantity),
      createdAt: item.createdAt || null,
      createdBy: item.createdBy || null,
      updatedAt: item.updatedAt || null,
      updatedBy: item.updatedBy || null
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

function normalizeChest(guildData: Record<string, any>, chestKey: keyof typeof chestMeta) {
  const meta = chestMeta[chestKey];
  const chest = guildData?.chests?.[chestKey] || {};
  const items = normalizeItems(chest);
  return {
    ...meta,
    items,
    totalItems: items.length,
    totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
    updatedAt: chest.updatedAt || null
  };
}

function normalizeEvent(event: Record<string, any>) {
  const source = event && typeof event === 'object' ? event : {};
  const userId = source.userId ? String(source.userId) : '';
  const actorName = source.profileName || source.memberDisplayName || source.userTag || userId || 'Sistema';

  return {
    ...source,
    userId: userId || null,
    userTag: source.userTag || null,
    memberDisplayName: source.memberDisplayName || null,
    profileName: source.profileName || null,
    actorName,
    actorId: userId || null
  };
}

function pickGuildData(storage: Record<string, any>, requestedGuildId: string) {
  const guilds = storage.guilds && typeof storage.guilds === 'object' ? storage.guilds : {};
  const fallbackGuildId = process.env.DISCORD_GUILD_ID || process.env.VITE_DISCORD_GUILD_ID || Object.keys(guilds)[0] || '';
  const guildId = requestedGuildId || fallbackGuildId;
  return {
    guildId,
    guildData: guilds[guildId] || { chests: {}, events: [] }
  };
}

export const bauRouter = Router();

bauRouter.get('/', (req, res) => {
  const storage = readStorage();
  const requestedGuildId = String(req.query.guildId || '').trim();
  const { guildId, guildData } = pickGuildData(storage, requestedGuildId);
  const chests = [normalizeChest(guildData, 'membros'), normalizeChest(guildData, 'gerencia')];
  const events = Array.isArray(guildData.events) ? guildData.events.slice(-300).reverse().map(normalizeEvent) : [];

  res.json({
    ok: true,
    guildId,
    chests,
    events
  });
});
