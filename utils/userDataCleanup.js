const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const JsonDocument = require('../models/JsonDocument');
const GuildLog = require('../models/GuildLog');
const { connectDatabase, isMongoConfigured, isMongoConnected, getDatabaseStatus } = require('./database');
const { logDatabaseError } = require('./databaseErrorLogger');
const { logger } = require('./logger');
const { isSupabaseEnabled, supabaseRequest } = require('./supabaseClient');

const COMMANDS_DIR = path.join(__dirname, '..', 'commands');
const USER_ID_ARRAY_KEYS = new Set([
  'billingExemptUserIds',
]);
const IDENTITY_FIELDS = [
  'userId',
  'discordUserId',
  'targetUserId',
  'targetId',
  'memberId',
  'discordId',
  'discord_user_id',
  'target_user_id',
];
const GUILD_FIELDS = ['guildId', 'guild_id'];
const REMOVED = Symbol('removed-user-record');

function normalizeDiscordId(value) {
  const text = String(value || '').trim();
  return /^\d{15,25}$/.test(text) ? text : null;
}

function normalizeGuildId(value) {
  return normalizeDiscordId(value);
}

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function getRecordGuildId(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  for (const field of GUILD_FIELDS) {
    const guildId = normalizeGuildId(record[field]);
    if (guildId) return guildId;
  }
  return null;
}

function recordBelongsToGuild(record, guildId) {
  const recordGuildId = getRecordGuildId(record);
  return !recordGuildId || recordGuildId === guildId;
}

function recordHasIdentityUser(record, userId) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return false;
  return IDENTITY_FIELDS.some((field) => String(record[field] || '').trim() === userId);
}

function isOwnedUserRecord(record, guildId, userId) {
  return recordHasIdentityUser(record, userId) && recordBelongsToGuild(record, guildId);
}

function isUserScopedKey(key, guildId, userId) {
  const text = String(key || '');
  return text === userId
    || text === `${guildId}:${userId}`
    || text.startsWith(`${guildId}:${userId}:`)
    || text.includes(`:${userId}:`)
    || text.endsWith(`:${userId}`);
}

function stripUserRecords(value, guildId, userId, keyName = null) {
  if (Array.isArray(value)) {
    if (USER_ID_ARRAY_KEYS.has(String(keyName || ''))) {
      const next = value.filter((item) => String(item || '').trim() !== userId);
      return { value: next, removed: next.length !== value.length };
    }

    let removed = false;
    const next = [];
    for (const item of value) {
      if (isOwnedUserRecord(item, guildId, userId)) {
        removed = true;
        continue;
      }
      const cleaned = stripUserRecords(item, guildId, userId, keyName);
      if (cleaned.value === REMOVED) {
        removed = true;
        continue;
      }
      removed = removed || cleaned.removed;
      next.push(cleaned.value);
    }
    return { value: next, removed };
  }

  if (!value || typeof value !== 'object') {
    return { value, removed: false };
  }

  if (isOwnedUserRecord(value, guildId, userId)) {
    return { value: REMOVED, removed: true };
  }

  let removed = false;
  const next = {};
  for (const [key, item] of Object.entries(value)) {
    if (isUserScopedKey(key, guildId, userId)) {
      removed = true;
      continue;
    }

    const cleaned = stripUserRecords(item, guildId, userId, key);
    if (cleaned.value === REMOVED) {
      removed = true;
      continue;
    }

    removed = removed || cleaned.removed;
    next[key] = cleaned.value;
  }

  return { value: next, removed };
}

function readJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8') || '{}');
  } catch (error) {
    logger.warn(`Nao foi possivel ler ${path.basename(filePath)} para limpeza de usuario: ${error.message}`);
    return null;
  }
}

function writeJsonFile(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data ?? {}, null, 2)}\n`, 'utf8');
}

async function cleanupLocalJsonUserData(guildId, userId) {
  const normalizedGuildId = normalizeGuildId(guildId);
  const normalizedUserId = normalizeDiscordId(userId);
  if (!normalizedGuildId || !normalizedUserId || !fs.existsSync(COMMANDS_DIR)) {
    return { cleanedFiles: 0, files: [] };
  }

  const files = fs.readdirSync(COMMANDS_DIR)
    .filter((fileName) => fileName.toLowerCase().endsWith('.json'))
    .map((fileName) => path.join(COMMANDS_DIR, fileName));

  const changedFiles = [];
  for (const filePath of files) {
    const data = readJsonFile(filePath);
    if (data === null) continue;

    const cleaned = stripUserRecords(data, normalizedGuildId, normalizedUserId);
    if (!cleaned.removed || cleaned.value === REMOVED) continue;

    writeJsonFile(filePath, cleaned.value);
    changedFiles.push(path.basename(filePath));
  }

  return { cleanedFiles: changedFiles.length, files: changedFiles };
}

async function cleanupJsonDocuments(guildId, userId) {
  const documents = await JsonDocument.find({}).lean();
  let updated = 0;

  for (const document of documents) {
    const cleaned = stripUserRecords(clone(document.data || {}), guildId, userId);
    if (!cleaned.removed || cleaned.value === REMOVED) continue;

    await JsonDocument.updateOne(
      { _id: document._id },
      {
        $set: {
          data: cleaned.value,
          updatedAt: new Date(),
        },
      }
    );
    updated += 1;
  }

  return updated;
}

async function deleteDashboardCollections(guildId, userId) {
  const db = mongoose.connection.db;
  if (!db) return {};

  const results = {};
  const members = db.collection('discord_members');
  const memberDocs = await members.find(
    { guild_id: guildId, discord_user_id: userId },
    { projection: { id: 1 } }
  ).toArray();
  const memberIds = memberDocs.map((member) => member.id).filter(Boolean);

  results.discord_members = (await members.deleteMany({
    guild_id: guildId,
    discord_user_id: userId,
  })).deletedCount || 0;

  results.city_presence = (await db.collection('city_presence').deleteMany({
    guild_id: guildId,
    discord_user_id: userId,
  })).deletedCount || 0;

  const memberIdFilter = memberIds.length ? [{ member_id: { $in: memberIds } }] : [];
  results.attendance_sessions = (await db.collection('attendance_sessions').deleteMany({
    $or: [
      ...memberIdFilter,
      { guild_id: guildId, discord_user_id: userId },
    ],
  })).deletedCount || 0;

  results.absence_records = (await db.collection('absence_records').deleteMany({
    $or: [
      ...memberIdFilter,
      { guild_id: guildId, discord_user_id: userId },
    ],
  })).deletedCount || 0;

  results.audit_events = (await db.collection('audit_events').deleteMany({
    $or: [
      { guild_id: guildId, actor_id: userId },
      { 'payload.guildId': guildId, 'payload.discordUserId': userId },
      { 'payload.member.guildId': guildId, 'payload.member.discordUserId': userId },
      ...(memberIds.length ? [{ 'payload.session.member_id': { $in: memberIds } }] : []),
    ],
  })).deletedCount || 0;

  return results;
}

async function deleteGuildLogs(guildId, userId) {
  const result = await GuildLog.deleteMany({
    guildId,
    $or: [
      { userId },
      { 'metadata.userId': userId },
      { 'metadata.memberId': userId },
      { 'metadata.targetId': userId },
      { 'metadata.discordUserId': userId },
    ],
  });

  return result.deletedCount || 0;
}

async function deleteSupabaseGuildLogs(guildId, userId) {
  if (!isSupabaseEnabled()) return false;

  await supabaseRequest('guild_logs', {
    method: 'DELETE',
    query: {
      guild_id: `eq.${guildId}`,
      user_id: `eq.${userId}`,
    },
    headers: { Prefer: 'return=minimal' },
  });
  return true;
}

async function cleanupDeletedUserDatabaseData(guildId, userId) {
  const normalizedGuildId = normalizeGuildId(guildId);
  const normalizedUserId = normalizeDiscordId(userId);
  if (!normalizedGuildId || !normalizedUserId) {
    return { ok: false, skipped: true, reason: 'invalid_ids' };
  }

  if (!isMongoConfigured()) {
    return { ok: true, skipped: true, reason: 'mongo_not_configured' };
  }

  if (!isMongoConnected()) {
    await connectDatabase().catch(() => false);
  }

  if (!isMongoConnected()) {
    return {
      ok: false,
      skipped: true,
      reason: 'mongo_not_connected',
      databaseStatus: getDatabaseStatus(),
    };
  }

  try {
    const jsonDocumentsUpdated = await cleanupJsonDocuments(normalizedGuildId, normalizedUserId);
    const guildLogsDeleted = await deleteGuildLogs(normalizedGuildId, normalizedUserId);
    const supabaseGuildLogsCleared = await deleteSupabaseGuildLogs(normalizedGuildId, normalizedUserId).catch((error) => {
      logDatabaseError({
        event: 'deleted_user_supabase_log_cleanup',
        error,
        payload: { guildId: normalizedGuildId, userId: normalizedUserId },
        query: error.query || 'DELETE guild_logs',
        params: error.params || { guildId: normalizedGuildId, userId: normalizedUserId },
      });
      return false;
    });
    const dashboardDeleted = await deleteDashboardCollections(normalizedGuildId, normalizedUserId);

    return {
      ok: true,
      skipped: false,
      jsonDocumentsUpdated,
      guildLogsDeleted,
      supabaseGuildLogsCleared,
      dashboardDeleted,
    };
  } catch (error) {
    logDatabaseError({
      event: 'deleted_user_database_cleanup',
      error,
      payload: { guildId: normalizedGuildId, userId: normalizedUserId },
      query: 'cleanupDeletedUserDatabaseData',
      params: { guildId: normalizedGuildId, userId: normalizedUserId },
    });
    return { ok: false, skipped: false, reason: error.message };
  }
}

module.exports = {
  cleanupDeletedUserDatabaseData,
  cleanupLocalJsonUserData,
  stripUserRecords,
};
