const fs = require('fs');
const path = require('path');
const JsonDocument = require('../models/JsonDocument');
const { getDatabaseStatus, isMongoConnected, isMongoConfigured } = require('./database');
const { logDatabaseError } = require('./databaseErrorLogger');
const { logger } = require('./logger');

const ROOT_DIR = path.resolve(__dirname, '..');
const cache = new Map();
const pendingWrites = new Map();
const skippedEmptyImports = new Set();

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

function queuePersist(key) {
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
  }, 25);
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

function enrichPointTranscriptRecords(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  const fsOriginal = getOriginalFs();
  const next = clone(data);

  for (const record of Object.values(next)) {
    if (!record || typeof record !== 'object') continue;
    if (record.html || record.htmlShell) continue;

    const fileName = record.htmlFileName ? path.basename(record.htmlFileName) : null;
    const candidates = [
      record.htmlPath,
      fileName ? path.join(ROOT_DIR, 'public', 'transcripts', fileName) : null,
    ].filter(Boolean);

    const htmlPath = candidates.find((candidate) => fsOriginal.existsSync(candidate));
    if (!htmlPath) continue;

    try {
      record.htmlShell = fsOriginal.readFileSync(htmlPath, 'utf8');
    } catch {
      // Mantem o registro sem HTML inline se o arquivo estiver bloqueado/indisponivel.
    }
  }

  return next;
}

function normalizeDataForMongo(key, data) {
  if (key === 'commands/pointTranscripts.json') return enrichPointTranscriptRecords(data);
  return data;
}

function isEmptyJsonData(data) {
  if (Array.isArray(data)) return data.length === 0;
  if (!data || typeof data !== 'object') return data === null || data === undefined || data === '';
  return Object.keys(data).length === 0;
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
    const sourcePath = document.sourcePath || path.join(ROOT_DIR, key);
    cacheJson(key, sourcePath, document.data ?? {}, false);

    try {
      writeJsonToDisk(sourcePath, document.data ?? {});
    } catch (error) {
      logger.warn(`Nao foi possivel atualizar backup local de ${key}: ${error.message}`);
    }
  }

  logger.info(`Mongo JSON Store hidratado: ${cache.size} documento(s) em cache.`);
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
  toStoreKey,
};
