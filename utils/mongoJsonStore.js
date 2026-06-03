const fs = require('fs');
const path = require('path');
const JsonDocument = require('../models/JsonDocument');
const { connectDatabase, getDatabaseStatus, isMongoConnected, isMongoConfigured } = require('./database');
const { logDatabaseError } = require('./databaseErrorLogger');
const { logger } = require('./logger');

const ROOT_DIR = path.resolve(__dirname, '..');
const cache = new Map();
const pendingWrites = new Map();
const skippedEmptyImports = new Set();
const PROFILE_DATA_KEYS = new Set([
  'commands/perfis.json',
  'commands/approvedSetChannels.json',
]);
const RECONNECT_RETRY_MS = 5000;

let installed = false;
let original = null;
let lastDisconnectedLogAt = 0;

function toAbsolutePath(filePath) {
  return path.resolve(String(filePath || ''));
}

function toStoreKey(filePath) {
  const absolutePath = toAbsolutePath(filePath);
  const relativePath = path.relative(ROOT_DIR, absolutePath).replace(/\\/g, '/');
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) return null;
  if (!relativePath.toLowerCase().endsWith('.json')) return null;
  if (relativePath.startsWith('node_modules/')) return null;
  if (relativePath === 'package.json' || relativePath === 'package-lock.json') return null;
  if (relativePath.startsWith('commands/')) return relativePath;
  if (relativePath.startsWith('config/') && relativePath.endsWith('.json')) return relativePath;
  return null;
}

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function stringifyJson(data) {
  return `${JSON.stringify(data ?? {}, null, 2)}\n`;
}

function parseJsonPayload(payload) {
  if (Buffer.isBuffer(payload)) return JSON.parse(payload.toString('utf8') || '{}');
  return JSON.parse(String(payload || '{}') || '{}');
}

function logDisconnected(event, payload, query, params = {}) {
  const now = Date.now();
  if (now - lastDisconnectedLogAt < 30000) return;
  lastDisconnectedLogAt = now;

  logDatabaseError({
    event,
    error: new Error('MongoDB desconectado antes de executar operacao.'),
    payload,
    query,
    params: {
      ...params,
      databaseStatus: getDatabaseStatus(),
    },
  });
}

function getOriginalFs() {
  if (!original) {
    original = {
      existsSync: fs.existsSync.bind(fs),
      readFileSync: fs.readFileSync.bind(fs),
      writeFileSync: fs.writeFileSync.bind(fs),
      appendFileSync: fs.appendFileSync.bind(fs),
      mkdirSync: fs.mkdirSync.bind(fs),
      readdirSync: fs.readdirSync.bind(fs),
      statSync: fs.statSync.bind(fs),
    };
  }
  return original;
}

async function persistKey(key) {
  const query = 'JsonDocument.findOneAndUpdate';

  if (!isMongoConfigured()) return false;
  if (!isMongoConnected()) {
    await connectDatabase().catch(() => false);
  }
  if (!isMongoConnected()) {
    queuePersist(key, RECONNECT_RETRY_MS);
    logDisconnected('connection_event', { key }, query, { key });
    return false;
  }

  const item = cache.get(key);
  if (!item) return false;

  let data;
  try {
    data = clone(item.data);
  } catch (error) {
    logDatabaseError({
      event: 'json_document_payload',
      error,
      payload: { key, sourcePath: item.sourcePath, data: item.data },
      query,
      params: { key },
    });
    return false;
  }

  const filter = { key };
  const update = {
    $set: {
      key,
      sourcePath: item.sourcePath,
      data,
      updatedAt: new Date(),
    },
  };
  const options = { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true };

  try {
    await JsonDocument.findOneAndUpdate(filter, update, options);
    return true;
  } catch (error) {
    if (!isMongoConnected()) queuePersist(key, RECONNECT_RETRY_MS);
    logDatabaseError({
      event: 'json_document_upsert',
      error,
      payload: { key, sourcePath: item.sourcePath, data },
      query,
      params: { filter, update, options },
    });
    return false;
  }
}

function queuePersist(key, delayMs = 25) {
  if (!key || !isMongoConfigured()) return;
  if (pendingWrites.has(key)) clearTimeout(pendingWrites.get(key));
  const timer = setTimeout(() => {
    pendingWrites.delete(key);
    persistKey(key).catch((error) => {
      logDatabaseError({
        event: 'json_document_queue',
        error,
        payload: { key },
        query: 'persistKey',
        params: { key },
      });
    });
  }, delayMs);
  pendingWrites.set(key, timer);
}

function cacheJson(key, sourcePath, data, persist = false) {
  cache.set(key, {
    sourcePath,
    data: clone(data),
  });
  if (persist) queuePersist(key);
}

function readJsonFromDisk(filePath) {
  const fsOriginal = getOriginalFs();
  if (!fsOriginal.existsSync(filePath)) return null;
  return JSON.parse(fsOriginal.readFileSync(filePath, 'utf8') || '{}');
}

function writeJsonToDisk(filePath, data) {
  const fsOriginal = getOriginalFs();
  const dir = path.dirname(filePath);
  if (!fsOriginal.existsSync(dir)) fsOriginal.mkdirSync(dir, { recursive: true });
  fsOriginal.writeFileSync(filePath, stringifyJson(data), 'utf8');
}

function getLocalSourcePath(key, sourcePath = null) {
  const fallback = path.join(ROOT_DIR, key);
  if (!sourcePath) return fallback;

  const absolutePath = path.resolve(String(sourcePath));
  const relativePath = path.relative(ROOT_DIR, absolutePath);
  if (relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)) {
    return absolutePath;
  }

  return fallback;
}

function normalizeDataForMongo(key, data) {
  return data;
}

function isEmptyJsonData(data) {
  if (Array.isArray(data)) return data.length === 0;
  if (!data || typeof data !== 'object') return data === null || data === undefined || data === '';
  return Object.keys(data).length === 0;
}

function countNestedJsonRecords(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return 0;
  let count = 0;
  for (const value of Object.values(data)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const childValues = Object.values(value);
    const looksNested = childValues.some((item) => item && typeof item === 'object' && !Array.isArray(item));
    count += looksNested ? childValues.length : 1;
  }
  return count;
}

function parseDateTime(value) {
  const timestamp = Date.parse(value || '');
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getRecordTimestamp(record) {
  if (!record || typeof record !== 'object') return 0;
  return Math.max(
    parseDateTime(record.updatedAt),
    parseDateTime(record.lastProfileUpdateAt),
    parseDateTime(record.approvedAt),
    parseDateTime(record.createdAt),
  );
}

function mergeProfileJsonData(mongoData, diskData) {
  const merged = clone(mongoData && typeof mongoData === 'object' && !Array.isArray(mongoData) ? mongoData : {});
  const disk = diskData && typeof diskData === 'object' && !Array.isArray(diskData) ? diskData : {};
  let changed = false;

  for (const [guildId, diskGuildRecords] of Object.entries(disk)) {
    if (!diskGuildRecords || typeof diskGuildRecords !== 'object' || Array.isArray(diskGuildRecords)) continue;
    if (!merged[guildId] || typeof merged[guildId] !== 'object' || Array.isArray(merged[guildId])) {
      merged[guildId] = {};
      changed = true;
    }

    for (const [userId, diskRecord] of Object.entries(diskGuildRecords)) {
      if (!diskRecord || typeof diskRecord !== 'object' || Array.isArray(diskRecord)) continue;
      const mongoRecord = merged[guildId][userId];

      if (!mongoRecord || typeof mongoRecord !== 'object' || Array.isArray(mongoRecord)) {
        merged[guildId][userId] = diskRecord;
        changed = true;
        continue;
      }

      if (getRecordTimestamp(diskRecord) > getRecordTimestamp(mongoRecord)) {
        merged[guildId][userId] = { ...mongoRecord, ...diskRecord };
        changed = true;
      }
    }
  }

  return { data: merged, changed };
}

function chooseJsonDataForHydration(key, mongoData, diskData) {
  if (!PROFILE_DATA_KEYS.has(key) || diskData === null) {
    return { data: mongoData ?? {}, source: 'mongo' };
  }

  const merged = mergeProfileJsonData(mongoData, diskData);
  const mongoCount = countNestedJsonRecords(mongoData);
  const diskCount = countNestedJsonRecords(diskData);
  const mergedCount = countNestedJsonRecords(merged.data);
  if (merged.changed || mergedCount !== mongoCount) {
    logger.warn(`Mongo JSON Store uniu ${key}: Mongo ${mongoCount}, local ${diskCount}, final ${mergedCount}.`);
    return { data: merged.data, source: 'merged' };
  }

  return { data: merged.data, source: 'mongo' };
}

function shouldImportLocalJson(key, data) {
  if (!isEmptyJsonData(data)) return true;
  skippedEmptyImports.add(key);
  return false;
}

function installMongoJsonStoreBridge() {
  if (installed) return;
  const fsOriginal = getOriginalFs();
  installed = true;

  fs.existsSync = function existsSyncBridge(filePath) {
    const key = toStoreKey(filePath);
    if (key && cache.has(key)) return true;
    return fsOriginal.existsSync(filePath);
  };

  fs.readFileSync = function readFileSyncBridge(filePath, options) {
    const key = toStoreKey(filePath);
    if (key) {
      if (cache.has(key)) {
        const payload = stringifyJson(cache.get(key).data);
        if (options === null || options === undefined) return Buffer.from(payload, 'utf8');
        return payload;
      }

      const absolutePath = toAbsolutePath(filePath);
      if (fsOriginal.existsSync(absolutePath)) {
        const data = readJsonFromDisk(absolutePath);
        cacheJson(key, absolutePath, data, true);
        const payload = stringifyJson(data);
        if (options === null || options === undefined) return Buffer.from(payload, 'utf8');
        return payload;
      }
    }

    return fsOriginal.readFileSync(filePath, options);
  };

  fs.writeFileSync = function writeFileSyncBridge(filePath, data, options) {
    const key = toStoreKey(filePath);
    if (key) {
      const absolutePath = toAbsolutePath(filePath);
      try {
        cacheJson(key, absolutePath, normalizeDataForMongo(key, parseJsonPayload(data)), true);
      } catch (error) {
        logDatabaseError({
          event: 'json_document_parse',
          error,
          payload: {
            key,
            sourcePath: absolutePath,
            receivedType: Buffer.isBuffer(data) ? 'buffer' : typeof data,
            preview: String(data || '').slice(0, 500),
          },
          query: 'MongoJsonStore.writeFileSyncBridge',
          params: { key, sourcePath: absolutePath },
        });
      }
      return fsOriginal.writeFileSync(filePath, data, options);
    }

    return fsOriginal.writeFileSync(filePath, data, options);
  };

  fs.appendFileSync = function appendFileSyncBridge(filePath, data, options) {
    const appendOptions = typeof options === 'string'
      ? { encoding: options, flag: 'a' }
      : { ...(options || {}), flag: options?.flag || 'a' };

    return fsOriginal.writeFileSync(filePath, data, appendOptions);
  };
}

function listLocalJsonFiles(dir) {
  const fsOriginal = getOriginalFs();
  if (!fsOriginal.existsSync(dir)) return [];
  const entries = fsOriginal.readdirSync(dir);
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const stat = fsOriginal.statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...listLocalJsonFiles(fullPath));
    } else if (entry.toLowerCase().endsWith('.json') && toStoreKey(fullPath)) {
      files.push(fullPath);
    }
  }

  return files;
}

async function importLocalJsonFilesToMongo() {
  if (!isMongoConfigured() || !isMongoConnected()) return;
  const roots = [
    path.join(ROOT_DIR, 'commands'),
    path.join(ROOT_DIR, 'config'),
  ];
  const files = roots.flatMap(listLocalJsonFiles);

  for (const filePath of files) {
    const key = toStoreKey(filePath);
    if (!key) continue;

    let exists = null;
    try {
      exists = await JsonDocument.exists({ key });
    } catch (error) {
      logDatabaseError({
        event: 'json_document_exists',
        error,
        payload: { key, sourcePath: filePath },
        query: 'JsonDocument.exists',
        params: { filter: { key } },
      });
      continue;
    }

    if (exists) continue;

    try {
      const data = readJsonFromDisk(filePath);
      if (data === null) continue;
      if (!shouldImportLocalJson(key, data)) continue;
      cacheJson(key, filePath, normalizeDataForMongo(key, data), false);
      await persistKey(key);
    } catch (error) {
      logDatabaseError({
        event: 'json_document_import',
        error,
        payload: { key, sourcePath: filePath },
        query: 'importLocalJsonFilesToMongo',
        params: { key, sourcePath: filePath },
      });
    }
  }
}

async function hydrateMongoJsonStore() {
  if (!isMongoConfigured() || !isMongoConnected()) return;
  let documents = [];

  try {
    documents = await JsonDocument.find({}).lean();
  } catch (error) {
    logDatabaseError({
      event: 'json_document_find',
      error,
      payload: {},
      query: 'JsonDocument.find({}).lean',
      params: { filter: {} },
    });
    return;
  }

  for (const document of documents) {
    const key = toStoreKey(path.join(ROOT_DIR, document.key));
    if (!key) continue;
    const sourcePath = getLocalSourcePath(key, document.sourcePath);
    const diskData = readJsonFromDisk(sourcePath);
    const selected = chooseJsonDataForHydration(key, document.data ?? {}, diskData);
    cacheJson(key, sourcePath, selected.data, false);

    try {
      writeJsonToDisk(sourcePath, selected.data);
      if (selected.source === 'merged') await persistKey(key);
    } catch (error) {
      logger.warn(`Nao foi possivel atualizar backup local de ${key}: ${error.message}`);
    }
  }

  logger.info(`Mongo JSON Store hidratado: ${cache.size} documento(s) em cache.`);
}

async function refreshMongoJsonKeys(keys = []) {
  const normalizedKeys = Array.from(new Set((Array.isArray(keys) ? keys : [keys])
    .map((key) => String(key || '').replace(/\\/g, '/').trim())
    .filter(Boolean)));

  if (!normalizedKeys.length || !isMongoConfigured() || !isMongoConnected()) return [];

  let documents = [];
  try {
    documents = await JsonDocument.find({ key: { $in: normalizedKeys } }).lean();
  } catch (error) {
    logDatabaseError({
      event: 'json_document_refresh',
      error,
      payload: { keys: normalizedKeys },
      query: 'JsonDocument.find({ key: { $in: keys } }).lean',
      params: { keys: normalizedKeys },
    });
    return [];
  }

  const refreshed = [];
  for (const document of documents) {
    const key = toStoreKey(path.join(ROOT_DIR, document.key));
    if (!key) continue;

    const sourcePath = getLocalSourcePath(key, document.sourcePath);
    const diskData = readJsonFromDisk(sourcePath);
    const selected = chooseJsonDataForHydration(key, document.data ?? {}, diskData);
    cacheJson(key, sourcePath, selected.data, false);

    try {
      writeJsonToDisk(sourcePath, selected.data);
      if (selected.source === 'merged') await persistKey(key);
      refreshed.push(key);
    } catch (error) {
      logDatabaseError({
        event: 'json_document_refresh_write',
        error,
        payload: { key, sourcePath },
        query: 'writeJsonToDisk',
        params: { key, sourcePath },
      });
    }
  }

  return refreshed;
}

function refreshLocalJsonKeys(keys = []) {
  const normalizedKeys = Array.from(new Set((Array.isArray(keys) ? keys : [keys])
    .map((key) => String(key || '').replace(/\\/g, '/').trim())
    .filter(Boolean)));

  const refreshed = [];
  for (const key of normalizedKeys) {
    const sourcePath = getLocalSourcePath(key);
    const storeKey = toStoreKey(sourcePath);
    if (!storeKey) continue;

    try {
      const data = readJsonFromDisk(sourcePath);
      if (data === null) continue;
      cacheJson(storeKey, sourcePath, normalizeDataForMongo(storeKey, data), false);
      refreshed.push(storeKey);
    } catch (error) {
      logDatabaseError({
        event: 'json_document_local_refresh',
        error,
        payload: { key: storeKey, sourcePath },
        query: 'refreshLocalJsonKeys',
        params: { key: storeKey, sourcePath },
      });
    }
  }

  return refreshed;
}

async function initializeMongoJsonStore() {
  installMongoJsonStoreBridge();
  if (!isMongoConfigured() || !isMongoConnected()) return;
  await hydrateMongoJsonStore();
  await importLocalJsonFilesToMongo();
  if (skippedEmptyImports.size > 0) {
    logger.warn(`Mongo JSON Store ignorou ${skippedEmptyImports.size} JSON local vazio para evitar sobrescrever dados: ${[...skippedEmptyImports].join(', ')}`);
  }
}

async function flushMongoJsonStore() {
  for (const timer of pendingWrites.values()) clearTimeout(timer);
  const keys = Array.from(new Set([...pendingWrites.keys(), ...cache.keys()]));
  pendingWrites.clear();
  await Promise.all(keys.map((key) => persistKey(key)));
}

function getMongoJsonStoreStatus() {
  return {
    installed,
    cachedKeys: cache.size,
    pendingWrites: pendingWrites.size,
    keys: Array.from(cache.keys()).sort(),
    skippedEmptyImports: Array.from(skippedEmptyImports).sort(),
  };
}

module.exports = {
  installMongoJsonStoreBridge,
  initializeMongoJsonStore,
  flushMongoJsonStore,
  getMongoJsonStoreStatus,
  refreshLocalJsonKeys,
  refreshMongoJsonKeys,
  toStoreKey,
};
