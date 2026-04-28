const fs = require('fs');
const path = require('path');
const { logger } = require('./logger');

const PONTOS_PATH = path.join(__dirname, '..', 'commands', 'pontos.json');
const POINT_TIME_ZONE = 'America/Sao_Paulo';
const DATE_TIME_FORMAT = {
  timeZone: POINT_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
};
const DATE_FORMAT = {
  timeZone: POINT_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
};
const WEEKDAY_FORMAT = {
  timeZone: POINT_TIME_ZONE,
  weekday: 'long',
};
const TIME_FORMAT = {
  timeZone: POINT_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
};

function ensureFile() {
  if (!fs.existsSync(PONTOS_PATH)) {
    fs.writeFileSync(PONTOS_PATH, `${JSON.stringify({}, null, 2)}\n`, 'utf8');
  }
}

function readLocal() {
  ensureFile();
  try {
    return JSON.parse(fs.readFileSync(PONTOS_PATH, 'utf8') || '{}');
  } catch (error) {
    logger.error('Erro ao ler pontos.json:', error);
    return {};
  }
}

function writeLocal(data) {
  ensureFile();
  fs.writeFileSync(PONTOS_PATH, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function emptyUser(guildId, userId) {
  return {
    guildId,
    userId,
    firstSeenAt: null,
    firstPointAt: null,
    lastPointOpenAt: null,
    lastPointCloseAt: null,
    activePointStartedAt: null,
    activePointDate: null,
    activePointDay: null,
    activePointStartTime: null,
    totalMs: 0,
    sessions: [],
    updatedAt: new Date().toISOString(),
  };
}

function toDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatLocalDate(value) {
  const date = toDate(value);
  return date ? date.toLocaleDateString('pt-BR', DATE_FORMAT) : 'N/A';
}

function formatLocalDay(value) {
  const date = toDate(value);
  if (!date) return 'N/A';
  const day = date.toLocaleDateString('pt-BR', WEEKDAY_FORMAT);
  return day.charAt(0).toUpperCase() + day.slice(1);
}

function formatLocalTime(value) {
  const date = toDate(value);
  return date ? date.toLocaleTimeString('pt-BR', TIME_FORMAT) : 'N/A';
}

function buildPointMoment(value) {
  const date = toDate(value);
  if (!date) {
    return {
      iso: null,
      date: 'N/A',
      day: 'N/A',
      time: 'N/A',
      dateTime: 'N/A',
      timezone: POINT_TIME_ZONE,
    };
  }

  return {
    iso: date.toISOString(),
    date: formatLocalDate(date),
    day: formatLocalDay(date),
    time: formatLocalTime(date),
    dateTime: formatDate(date),
    timezone: POINT_TIME_ZONE,
  };
}

function buildSessionMetadata(startedAtValue, closedAtValue = null) {
  const started = buildPointMoment(startedAtValue);
  const closed = closedAtValue ? buildPointMoment(closedAtValue) : null;

  return {
    pointDate: started.date,
    pointDay: started.day,
    startedAtTime: started.time,
    startedAtDateTime: started.dateTime,
    timezone: POINT_TIME_ZONE,
    ...(closed ? {
      closedAtTime: closed.time,
      closedAtDateTime: closed.dateTime,
    } : {}),
  };
}

async function getUserPoint(guildId, userId) {
  const data = readLocal();
  return {
    ...emptyUser(guildId, userId),
    ...(((data[guildId] || {})[userId]) || {}),
    guildId,
    userId,
  };
}

async function listGuildPoints(guildId) {
  const data = readLocal();
  return Object.entries(data[guildId] || {}).map(([userId, userData]) => ({
    ...emptyUser(guildId, userId),
    ...userData,
    guildId,
    userId,
  }));
}

async function saveUserPoint(guildId, userId, userData) {
  const next = {
    ...emptyUser(guildId, userId),
    ...userData,
    guildId,
    userId,
    updatedAt: new Date().toISOString(),
  };

  const data = readLocal();
  if (!data[guildId]) data[guildId] = {};
  data[guildId][userId] = next;
  writeLocal(data);
  return next;
}

async function deleteUserPoint(guildId, userId) {
  const data = readLocal();
  const existed = Boolean(data[guildId]?.[userId]);

  if (data[guildId]) {
    delete data[guildId][userId];
    if (Object.keys(data[guildId]).length === 0) {
      delete data[guildId];
    }
  }

  writeLocal(data);
  return existed;
}

function parseBrazilDateTime(input, now = new Date()) {
  const raw = String(input || '').trim();
  const fullMatch = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  const timeOnlyMatch = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);

  let day;
  let month;
  let year;
  let hour;
  let minute;
  let second;

  if (fullMatch) {
    day = Number(fullMatch[1]);
    month = Number(fullMatch[2]) - 1;
    year = Number(fullMatch[3]);
    hour = Number(fullMatch[4]);
    minute = Number(fullMatch[5]);
    second = fullMatch[6] === undefined ? 0 : Number(fullMatch[6]);
  } else if (timeOnlyMatch) {
    day = now.getDate();
    month = now.getMonth();
    year = now.getFullYear();
    hour = Number(timeOnlyMatch[1]);
    minute = Number(timeOnlyMatch[2]);
    second = timeOnlyMatch[3] === undefined ? 0 : Number(timeOnlyMatch[3]);
  } else {
    return null;
  }

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  if (second < 0 || second > 59) return null;

  const parsed = new Date(year, month, day, hour, minute, second, 0);
  if (Number.isNaN(parsed.getTime())) return null;
  if (
    parsed.getDate() !== day ||
    parsed.getMonth() !== month ||
    parsed.getFullYear() !== year ||
    parsed.getHours() !== hour ||
    parsed.getMinutes() !== minute ||
    parsed.getSeconds() !== second
  ) {
    return null;
  }

  return parsed;
}

async function correctOpenPointCloseTime(guildId, userId, closedAtInput, correctedBy = null) {
  const current = await getUserPoint(guildId, userId);
  if (!current.activePointStartedAt) {
    return { ok: false, code: 'not_open', message: 'Este usuário não possui ponto aberto para corrigir.', data: current };
  }

  const startedAt = new Date(current.activePointStartedAt);
  if (Number.isNaN(startedAt.getTime())) {
    return { ok: false, code: 'invalid_start', message: 'O horário de abertura salvo está inválido.', data: current };
  }

  const closedAt = parseBrazilDateTime(closedAtInput);
  if (!closedAt) {
    return { ok: false, code: 'invalid_close', message: 'Horário inválido. Use `HH:mm:ss` ou `DD/MM/AAAA HH:mm:ss`. Os segundos são opcionais.', data: current };
  }

  if (closedAt.getTime() <= startedAt.getTime()) {
    return { ok: false, code: 'before_start', message: 'O horário de fechamento precisa ser depois da abertura do ponto.', data: current };
  }

  if (closedAt.getTime() > Date.now()) {
    return { ok: false, code: 'future_close', message: 'O horário de fechamento não pode estar no futuro.', data: current };
  }

  const durationMs = Math.max(0, closedAt.getTime() - startedAt.getTime());
  const nowIso = new Date().toISOString();
  const session = {
    startedAt: current.activePointStartedAt,
    closedAt: closedAt.toISOString(),
    durationMs,
    ...buildSessionMetadata(current.activePointStartedAt, closedAt),
    corrected: true,
    correctedBy: correctedBy ? String(correctedBy) : null,
    correctedAt: nowIso,
  };

  const next = await saveUserPoint(guildId, userId, {
    ...current,
    activePointStartedAt: null,
    activePointDate: null,
    activePointDay: null,
    activePointStartTime: null,
    lastPointCloseAt: closedAt.toISOString(),
    totalMs: Number(current.totalMs || 0) + durationMs,
    sessions: [...(current.sessions || []), session].slice(-300),
    corrections: [
      ...(current.corrections || []),
      {
        type: 'manual_close',
        activePointStartedAt: current.activePointStartedAt,
        closedAt: closedAt.toISOString(),
        durationMs,
        ...buildSessionMetadata(current.activePointStartedAt, closedAt),
        correctedBy: correctedBy ? String(correctedBy) : null,
        correctedAt: nowIso,
      },
    ].slice(-100),
  });

  return { ok: true, action: 'corrected_closed', durationMs, closedAt: closedAt.toISOString(), data: next };
}

async function adjustPointSession(guildId, userId, startedAtInput, closedAtInput, adjustedBy = null) {
  const startedAt = parseBrazilDateTime(startedAtInput);
  const closedAt = parseBrazilDateTime(closedAtInput, startedAt || new Date());
  const current = await getUserPoint(guildId, userId);

  if (!startedAt) {
    return { ok: false, code: 'invalid_start', message: 'Horário de abertura inválido. Use `HH:mm:ss` ou `DD/MM/AAAA HH:mm:ss`. Os segundos são opcionais.', data: current };
  }

  if (!closedAt) {
    return { ok: false, code: 'invalid_close', message: 'Horário de fechamento inválido. Use `HH:mm:ss` ou `DD/MM/AAAA HH:mm:ss`. Os segundos são opcionais.', data: current };
  }

  if (closedAt.getTime() <= startedAt.getTime()) {
    return { ok: false, code: 'before_start', message: 'O horário de fechamento precisa ser depois da abertura do ponto.', data: current };
  }

  if (closedAt.getTime() > Date.now()) {
    return { ok: false, code: 'future_close', message: 'O horário de fechamento não pode estar no futuro.', data: current };
  }

  const durationMs = Math.max(0, closedAt.getTime() - startedAt.getTime());
  const nowIso = new Date().toISOString();
  const session = {
    startedAt: startedAt.toISOString(),
    closedAt: closedAt.toISOString(),
    durationMs,
    ...buildSessionMetadata(startedAt, closedAt),
    adjusted: true,
    adjustedBy: adjustedBy ? String(adjustedBy) : null,
    adjustedAt: nowIso,
  };

  const previousActiveStartedAt = current.activePointStartedAt;
  const next = await saveUserPoint(guildId, userId, {
    ...current,
    firstPointAt: current.firstPointAt || startedAt.toISOString(),
    lastPointOpenAt: startedAt.toISOString(),
    lastPointCloseAt: closedAt.toISOString(),
    activePointStartedAt: null,
    activePointDate: null,
    activePointDay: null,
    activePointStartTime: null,
    totalMs: Number(current.totalMs || 0) + durationMs,
    sessions: [...(current.sessions || []), session].slice(-300),
    corrections: [
      ...(current.corrections || []),
      {
        type: 'manual_readjust',
        startedAt: startedAt.toISOString(),
        closedAt: closedAt.toISOString(),
        previousActiveStartedAt,
        durationMs,
        ...buildSessionMetadata(startedAt, closedAt),
        adjustedBy: adjustedBy ? String(adjustedBy) : null,
        adjustedAt: nowIso,
      },
    ].slice(-100),
  });

  return {
    ok: true,
    action: 'readjusted',
    durationMs,
    startedAt: startedAt.toISOString(),
    closedAt: closedAt.toISOString(),
    data: next,
  };
}

async function togglePoint(guildId, userId) {
  const current = await getUserPoint(guildId, userId);
  const now = new Date();

  if (current.activePointStartedAt) {
    const startedAt = new Date(current.activePointStartedAt);
    const durationMs = Math.max(0, now.getTime() - startedAt.getTime());
    const session = {
      startedAt: current.activePointStartedAt,
      closedAt: now.toISOString(),
      durationMs,
      ...buildSessionMetadata(current.activePointStartedAt, now),
    };

    const next = await saveUserPoint(guildId, userId, {
      ...current,
      activePointStartedAt: null,
      activePointDate: null,
      activePointDay: null,
      activePointStartTime: null,
      lastPointCloseAt: now.toISOString(),
      totalMs: Number(current.totalMs || 0) + durationMs,
      sessions: [...(current.sessions || []), session].slice(-300),
    });

    return { action: 'closed', durationMs, data: next };
  }

  const next = await saveUserPoint(guildId, userId, {
    ...current,
    firstPointAt: current.firstPointAt || now.toISOString(),
    lastPointOpenAt: now.toISOString(),
    activePointStartedAt: now.toISOString(),
    activePointDate: formatLocalDate(now),
    activePointDay: formatLocalDay(now),
    activePointStartTime: formatLocalTime(now),
  });

  return { action: 'opened', durationMs: 0, data: next };
}

async function openPoint(guildId, userId, profile = {}) {
  const current = await getUserPoint(guildId, userId);
  if (current.activePointStartedAt) {
    return { action: 'already_open', durationMs: 0, data: current };
  }

  const now = new Date();
  const moment = buildPointMoment(now);
  const next = await saveUserPoint(guildId, userId, {
    ...current,
    userName: profile.userName || current.userName || null,
    userMention: profile.userMention || current.userMention || `<@${userId}>`,
    registro: profile.registro || current.registro || current.idRegistro || userId,
    firstPointAt: current.firstPointAt || now.toISOString(),
    lastPointOpenAt: now.toISOString(),
    activePointStartedAt: now.toISOString(),
    activePointDate: moment.date,
    activePointDay: moment.day,
    activePointStartTime: moment.time,
  });

  return { action: 'opened', durationMs: 0, data: next };
}

async function closePoint(guildId, userId) {
  const current = await getUserPoint(guildId, userId);
  if (!current.activePointStartedAt) {
    return { action: 'already_closed', durationMs: 0, data: current };
  }

  const now = new Date();
  const startedAt = new Date(current.activePointStartedAt);
  const durationMs = Math.max(0, now.getTime() - startedAt.getTime());
  const session = {
    startedAt: current.activePointStartedAt,
    closedAt: now.toISOString(),
    durationMs,
    ...buildSessionMetadata(current.activePointStartedAt, now),
  };

  const next = await saveUserPoint(guildId, userId, {
    ...current,
    activePointStartedAt: null,
    activePointDate: null,
    activePointDay: null,
    activePointStartTime: null,
    lastPointCloseAt: now.toISOString(),
    totalMs: Number(current.totalMs || 0) + durationMs,
    sessions: [...(current.sessions || []), session].slice(-300),
  });

  return { action: 'closed', durationMs, data: next };
}

function getEffectiveTotalMs(data) {
  let total = Number(data.totalMs || 0);
  if (data.activePointStartedAt) {
    total += Math.max(0, Date.now() - new Date(data.activePointStartedAt).getTime());
  }
  return total;
}

function getPointDays(data) {
  const days = new Set();
  for (const session of data.sessions || []) {
    if (session.startedAt) days.add(session.startedAt.slice(0, 10));
  }
  if (data.activePointStartedAt) days.add(data.activePointStartedAt.slice(0, 10));
  return days.size;
}

function formatDuration(ms = 0) {
  const totalMinutes = Math.max(0, Math.round(Number(ms || 0) / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours <= 0) return `${minutes}min`;
  if (minutes <= 0) return `${hours}h`;
  return `${hours}h ${minutes}min`;
}

function formatDate(value) {
  if (!value) return 'N/A';
  const date = toDate(value);
  return date ? date.toLocaleString('pt-BR', DATE_TIME_FORMAT) : 'N/A';
}

function formatPanelDate(value) {
  if (!value) return 'N/A';
  return formatDate(value);
}

function formatTime(value = new Date()) {
  return formatLocalTime(value);
}

module.exports = {
  getUserPoint,
  listGuildPoints,
  saveUserPoint,
  deleteUserPoint,
  correctOpenPointCloseTime,
  adjustPointSession,
  parseBrazilDateTime,
  togglePoint,
  openPoint,
  closePoint,
  getEffectiveTotalMs,
  getPointDays,
  formatDuration,
  formatDate,
  formatPanelDate,
  formatTime,
  formatLocalDate,
  formatLocalDay,
  POINT_TIME_ZONE,
};
