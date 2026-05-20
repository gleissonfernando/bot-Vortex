const mongoose = require('mongoose');
require('dotenv').config();
const { logger } = require('./logger');
const { logDatabaseError } = require('./databaseErrorLogger');

let connectPromise = null;
let listenersInstalled = false;
let lastError = null;

const READY_STATE_LABELS = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
};

function getMongoUri() {
  return String(
    process.env.MONGODB_URI
    || process.env.MONGO_URI
    || process.env.DATABASE_URL
    || ''
  ).trim();
}

function isMongoConfigured() {
  return Boolean(getMongoUri());
}

function isMongoRequired() {
  return String(process.env.MONGODB_REQUIRED || '').trim().toLowerCase() === 'true';
}

function isMongoConnected() {
  return mongoose.connection.readyState === 1;
}

function getMongoHost() {
  const uri = getMongoUri();
  return (uri.match(/@([^/?]+)/) || [])[1] || null;
}

function getMongoConnectionHint(error) {
  const uri = getMongoUri();
  const details = [
    error?.message,
    error?.code,
    error?.reason?.code,
    error?.syscall,
    error?.reason?.syscall,
  ].filter(Boolean).join(' ');

  if (!uri) {
    return 'Defina MONGODB_URI no .env para ativar o banco de dados.';
  }

  if (uri.includes('<db_password>') || uri.includes('<password>')) {
    return 'A senha do MongoDB ainda parece estar com placeholder. Troque pelo password real do usuario do Atlas.';
  }

  if (/mongodb\+srv:\/\//i.test(uri) && /querySrv|ECONNREFUSED|ENOTFOUND|ETIMEOUT|ESERVFAIL/i.test(details)) {
    return 'Falha no DNS SRV do mongodb+srv. No Atlas, abra Connect > Drivers e desative SRV Connection String para usar a URI mongodb://, ou configure um DNS publico que suporte SRV.';
  }

  if (/auth|authentication|bad auth|invalid credentials/i.test(details)) {
    return 'Falha de autenticacao. Confira usuario/senha do Database User e codifique caracteres especiais da senha na URI.';
  }

  if (/server selection|timed out|ECONNREFUSED|ETIMEDOUT|ENETUNREACH/i.test(details)) {
    return 'Falha de rede. Confira Network Access no Atlas, libere o IP desta maquina e permita saida TCP na porta 27017.';
  }

  return null;
}

function serializeMongoError(error) {
  if (!error) return null;
  return {
    at: new Date().toISOString(),
    name: error.name || 'MongoError',
    code: error.code || error.reason?.code || null,
    message: String(error.message || error).replace(getMongoUri(), '[MONGODB_URI]'),
    hostname: error.hostname || error.reason?.hostname || getMongoHost(),
    syscall: error.syscall || error.reason?.syscall || null,
    hint: getMongoConnectionHint(error),
  };
}

function rememberMongoError(error, context = 'mongodb', details = {}) {
  lastError = serializeMongoError(error);
  logDatabaseError({
    event: context,
    error,
    payload: details.payload ?? lastError,
    query: details.query ?? 'mongoose.connection',
    params: details.params ?? {
      host: getMongoHost(),
      readyState: mongoose.connection.readyState,
      readyStateLabel: READY_STATE_LABELS[mongoose.connection.readyState] || 'unknown',
      lastError,
    },
  });
}

function installMongoEventLogs() {
  if (listenersInstalled) return;
  listenersInstalled = true;

  mongoose.connection.on('connected', () => {
    lastError = null;
    logger.info('MongoDB conectado.', { host: getMongoHost() });
  });

  mongoose.connection.on('reconnected', () => {
    lastError = null;
    logger.info('MongoDB reconectado.', { host: getMongoHost() });
  });

  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB desconectado.', { host: getMongoHost() });
  });

  mongoose.connection.on('error', (error) => {
    rememberMongoError(error, 'connection_event', {
      payload: serializeMongoError(error),
      query: 'mongoose.connection.on("error")',
      params: {
        host: getMongoHost(),
        readyState: mongoose.connection.readyState,
        readyStateLabel: READY_STATE_LABELS[mongoose.connection.readyState] || 'unknown',
      },
    });
  });
}

function getDatabaseStatus() {
  const readyState = mongoose.connection.readyState;
  return {
    configured: isMongoConfigured(),
    required: isMongoRequired(),
    connected: isMongoConnected(),
    readyState,
    readyStateLabel: READY_STATE_LABELS[readyState] || 'unknown',
    host: getMongoHost(),
    lastError,
  };
}

async function connectDatabase() {
  installMongoEventLogs();
  const uri = getMongoUri();
  if (!uri) {
    logger.warn('MongoDB nao configurado. Defina MONGODB_URI ou MONGO_URI para salvar os dados no banco.');
    return false;
  }

  if (isMongoConnected()) return true;
  if (connectPromise) return connectPromise;

  mongoose.set('strictQuery', false);
  connectPromise = mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10000,
  })
    .then(() => {
      logger.info('MongoDB conectado com sucesso.');
      return true;
    })
    .catch((error) => {
      connectPromise = null;
      rememberMongoError(error, 'connect');
      return false;
    });

  return connectPromise;
}

async function disconnectDatabase() {
  if (mongoose.connection.readyState === 0) return;
  await mongoose.disconnect().catch((error) => rememberMongoError(error, 'disconnect'));
}

module.exports = {
  connectDatabase,
  disconnectDatabase,
  getDatabaseStatus,
  getMongoUri,
  isMongoConfigured,
  isMongoRequired,
  isMongoConnected,
  rememberMongoError,
};
