const { AttachmentBuilder } = require('discord.js');
const { formatDuration, formatDate, formatLocalDay, formatTime, getEffectiveTotalMs } = require('./pontoManager');
const { getUserProfile } = require('./profileManager');

const TIME_ZONE = 'America/Sao_Paulo';
const WEEKDAY_ORDER = [
  'segunda-feira',
  'terca-feira',
  'quarta-feira',
  'quinta-feira',
  'sexta-feira',
  'sabado',
  'domingo',
];

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function pad(value, size) {
  const text = String(value ?? '');
  return text.length > size ? `${text.slice(0, size - 3)}...` : text.padEnd(size, ' ');
}

function toValidDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getLocalParts(value = new Date()) {
  const date = toValidDate(value) || new Date();
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long',
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
}

function getLocalDateKey(date = new Date()) {
  const parts = getLocalParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function getWeekdayIndexFromDate(date = new Date()) {
  const safeDate = toValidDate(date) || new Date();
  const weekday = new Intl.DateTimeFormat('pt-BR', {
    timeZone: TIME_ZONE,
    weekday: 'long',
  }).format(safeDate).toLowerCase();

  const normalized = weekday.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (normalized === 'domingo') return 6;
  const index = WEEKDAY_ORDER.indexOf(normalized);
  return index >= 0 ? index : 0;
}

function shiftDateKey(dateKey, offsetDays) {
  const [year, month, day] = String(dateKey).split('-').map(Number);
  const base = Date.UTC(year, month - 1, day);
  return new Date(base + offsetDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function dateKeyToDate(dateKey) {
  return new Date(`${dateKey}T12:00:00Z`);
}

function formatDateKey(dateKey) {
  return dateKeyToDate(dateKey).toLocaleDateString('pt-BR', { timeZone: TIME_ZONE });
}

function formatWeekdayLabel(dateKey) {
  const label = dateKeyToDate(dateKey).toLocaleDateString('pt-BR', {
    timeZone: TIME_ZONE,
    weekday: 'long',
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function formatMomentValue(value) {
  return value ? formatDate(value) : 'N/A';
}

function buildWeekRange(referenceDate = new Date()) {
  const currentKey = getLocalDateKey(referenceDate);
  const weekStartKey = shiftDateKey(currentKey, -getWeekdayIndexFromDate(referenceDate));
  const weekEndKey = shiftDateKey(weekStartKey, 6);
  return { currentKey, weekStartKey, weekEndKey };
}

function getMonthRange(monthKey = '') {
  const match = String(monthKey || '').trim().match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));
  return {
    monthKey: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`,
    startKey: start.toISOString().slice(0, 10),
    endKey: end.toISOString().slice(0, 10),
  };
}

function getSessionStartedAt(session) {
  return session.startedAt || session.abertura || session.openedAt || null;
}

function getSessionClosedAt(session) {
  return session.closedAt || session.fechamento || session.endedAt || null;
}

function getSessionDurationMs(session) {
  const explicit = Number(session.durationMs || session.duracaoMs || 0);
  if (explicit > 0) return explicit;
  const startedAt = getSessionStartedAt(session);
  const closedAt = getSessionClosedAt(session);
  if (!startedAt || !closedAt) return 0;
  return Math.max(0, new Date(closedAt).getTime() - new Date(startedAt).getTime());
}

function getSessionPointId(session, fallbackKey = null) {
  return session.pointId || session.id || session.sessionId || fallbackKey || null;
}

function getSessionOrigin(session) {
  if (session.source === 'fivem_metropole_auto') return 'FiveM automatico';
  if (session.adjusted || session.corrected) return 'Ajuste manual';
  return session.source || 'Ponto manual';
}

function normalizeSession(session, index = 0) {
  const startedAt = getSessionStartedAt(session);
  const closedAt = getSessionClosedAt(session);
  const durationMs = getSessionDurationMs(session);
  const pointId = getSessionPointId(session, startedAt ? `${startedAt}-${closedAt || 'open'}` : null);
  const dayKey = startedAt ? getLocalDateKey(startedAt) : null;

  return {
    index: index + 1,
    pointId,
    startedAt,
    closedAt,
    durationMs,
    dayKey,
    dayLabel: startedAt ? formatWeekdayLabel(dayKey) : 'N/A',
    startedAtTime: startedAt ? formatTime(startedAt) : 'N/A',
    closedAtTime: closedAt ? formatTime(closedAt) : 'Em andamento',
    durationFormatted: formatDuration(durationMs),
    status: closedAt ? 'FECHADO' : 'ABERTO',
    origin: getSessionOrigin(session),
    serverName: session.serverName || null,
    reason: session.reason || session.pointReason || null,
    activityName: session.activityName || null,
    activityDetails: session.activityDetails || null,
    activityState: session.activityState || null,
    adjusted: Boolean(session.adjusted || session.corrected),
    adjustedBy: session.adjustedBy || session.correctedBy || session.closedBy || null,
    adjustedByTag: session.adjustedByTag || session.adjustedByName || null,
    adjustedByDisplayName: session.adjustedByDisplayName || session.adjustedByName || null,
    adjustedByRoleIds: Array.isArray(session.adjustedByRoleIds) ? session.adjustedByRoleIds.map(String) : [],
    adjustedByPermissions: Array.isArray(session.adjustedByPermissions) ? session.adjustedByPermissions.map(String) : [],
  };
}

function getAllSessions(data) {
  const closedSessions = Array.isArray(data.sessions) ? data.sessions.map(normalizeSession) : [];
  const activeSession = data.activePointStartedAt
    ? [normalizeSession({
        pointId: data.activePointId || `active-${data.activePointStartedAt}`,
        startedAt: data.activePointStartedAt,
        closedAt: null,
        durationMs: Math.max(0, Date.now() - new Date(data.activePointStartedAt).getTime()),
        source: data.activePointSource,
        pointReason: data.activePointReason,
        serverName: data.activePointServerName,
        activityName: data.activePointActivityName,
        activityDetails: data.activePointActivityDetails,
        activityState: data.activePointActivityState,
      }, closedSessions.length)]
    : [];

  return [...closedSessions, ...activeSession]
    .filter((session) => session.startedAt)
    .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime())
    .map((session, index) => ({ ...session, index: index + 1 }));
}

function getAllAdjustments(data, guildId, userId) {
  const source = Array.isArray(data.adjustments) && data.adjustments.length
    ? data.adjustments
    : Array.isArray(data.corrections)
      ? data.corrections
      : [];

  return source.map((entry, index) => normalizeAdjustment(entry, guildId, userId, index))
    .filter((entry) => entry.adjustedAt || entry.newStartedAt || entry.oldStartedAt);
}

function getFallbackPointId(entry, guildId, userId) {
  const baseDate = entry.newStartedAt || entry.startedAt || entry.oldStartedAt || entry.activePointStartedAt || entry.adjustedAt || new Date().toISOString();
  return `pt-${String(guildId || 'guild').replace(/[^a-zA-Z0-9]/g, '')}-${String(userId || entry.ownerUserId || 'user').replace(/[^a-zA-Z0-9]/g, '')}-${String(baseDate).replace(/[:.]/g, '-')}`;
}

function normalizeAdjustment(entry, guildId, userId, index = 0) {
  const oldStartedAt = entry.oldStartedAt || entry.startedAt || entry.activePointStartedAt || entry.previousActiveStartedAt || null;
  const oldClosedAt = entry.oldClosedAt || entry.closedAt || entry.previousClosedAt || null;
  const newStartedAt = entry.newStartedAt || entry.startedAt || entry.activePointStartedAt || oldStartedAt || null;
  const newClosedAt = entry.newClosedAt || entry.closedAt || null;
  const adjustedAt = entry.adjustedAt || entry.correctedAt || entry.createdAt || entry.timestamp || null;
  const pointId = entry.pointId || entry.sessionId || getFallbackPointId(entry, guildId, userId);
  const typeRaw = String(entry.type || entry.adjustmentType || '').toLowerCase();
  const type = typeRaw.includes('observ') ? 'observacao'
    : typeRaw.includes('abert') ? 'abertura'
    : typeRaw.includes('fech') || typeRaw.includes('close') ? 'fechamento'
    : 'tempo total';
  const dayKey = getLocalDateKey(newStartedAt || oldStartedAt || adjustedAt || new Date());

  return {
    index: index + 1,
    id: entry.id || pointId,
    pointId,
    ownerUserId: String(entry.ownerUserId || userId || entry.userId || 'N/A'),
    guildId: String(entry.guildId || guildId || 'N/A'),
    type,
    reason: String(entry.reason || entry.motive || entry.motivo || '').trim() || 'N/A',
    adjustedBy: entry.adjustedBy || entry.correctedBy || entry.decidedBy || entry.createdBy || null,
    adjustedByTag: entry.adjustedByTag || entry.adjustedByName || null,
    adjustedByDisplayName: entry.adjustedByDisplayName || entry.adjustedByName || null,
    adjustedByRoleIds: Array.isArray(entry.adjustedByRoleIds) ? entry.adjustedByRoleIds.map(String) : [],
    adjustedByPermissions: Array.isArray(entry.adjustedByPermissions) ? entry.adjustedByPermissions.map(String) : [],
    oldStartedAt,
    oldClosedAt,
    newStartedAt,
    newClosedAt,
    adjustedAt,
    durationMs: Number(entry.durationMs || entry.duration || 0),
    dayKey,
    dayLabel: formatWeekdayLabel(dayKey),
    flexibleInput: entry.flexibleInput || null,
    extra: entry.extra || null,
  };
}

function groupBy(list, keyGetter) {
  return list.reduce((acc, item) => {
    const key = keyGetter(item);
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});
}

function getWeekDayKeys(referenceDate = new Date()) {
  const { currentKey, weekStartKey, weekEndKey } = buildWeekRange(referenceDate);
  const keys = [];
  let cursor = weekStartKey;
  for (let i = 0; i < 7; i += 1) {
    keys.push(cursor);
    cursor = shiftDateKey(cursor, 1);
  }
  return { currentKey, weekStartKey, weekEndKey, keys };
}

function getDateKeysBetween(startKey, endKey) {
  const keys = [];
  let cursor = startKey;
  while (cursor <= endKey) {
    keys.push(cursor);
    cursor = shiftDateKey(cursor, 1);
  }
  return keys;
}

function getReportDayKeys({ referenceDate = new Date(), monthKey = null } = {}) {
  const currentKey = getLocalDateKey(referenceDate);
  const monthRange = monthKey ? getMonthRange(monthKey) : null;
  if (monthRange) {
    return {
      currentKey: currentKey < monthRange.startKey
        ? monthRange.startKey
        : currentKey > monthRange.endKey
          ? monthRange.endKey
          : currentKey,
      weekStartKey: monthRange.startKey,
      weekEndKey: monthRange.endKey,
      keys: getDateKeysBetween(monthRange.startKey, monthRange.endKey),
      periodType: 'month',
      periodKey: monthRange.monthKey,
      periodLabel: formatMonthLabel(monthRange.monthKey),
    };
  }
  const week = getWeekDayKeys(referenceDate);
  return {
    ...week,
    periodType: 'week',
    periodKey: `${week.weekStartKey}:${week.weekEndKey}`,
    periodLabel: `Semana ${formatDateKey(week.weekStartKey)} ate ${formatDateKey(week.weekEndKey)}`,
  };
}

function formatMonthLabel(monthKey) {
  const range = getMonthRange(monthKey);
  if (!range) return 'Mes invalido';
  const date = dateKeyToDate(range.startKey);
  const label = date.toLocaleDateString('pt-BR', {
    timeZone: TIME_ZONE,
    month: 'long',
    year: 'numeric',
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function getDisplayWeekdayFromKey(dateKey) {
  return formatWeekdayLabel(dateKey);
}

function formatActor(adjustment) {
  const display = adjustment.adjustedByDisplayName || adjustment.adjustedByTag || adjustment.adjustedBy || 'Sistema';
  const roles = adjustment.adjustedByRoleIds.length ? adjustment.adjustedByRoleIds.map((id) => `<@&${id}>`).join(' ') : 'N/A';
  const perms = adjustment.adjustedByPermissions.length ? adjustment.adjustedByPermissions.join(', ') : 'N/A';
  return `${display} | cargos: ${roles} | permissao: ${perms}`;
}

function getPointAdjustmentsForSession(adjustments, session) {
  const pointId = String(session.pointId || '');
  const startedKey = session.startedAt ? getLocalDateKey(session.startedAt) : null;
  return adjustments.filter((adjustment) => {
    if (adjustment.pointId && String(adjustment.pointId) === pointId) return true;
    if (!startedKey || !adjustment.dayKey) return false;
    return adjustment.dayKey === startedKey;
  });
}

function groupSessionsByDay(sessions, weekKeys) {
  const byDay = {};
  for (const key of weekKeys) byDay[key] = [];
  for (const session of sessions) {
    if (!session.dayKey || !byDay[session.dayKey]) continue;
    byDay[session.dayKey].push(session);
  }
  for (const key of weekKeys) {
    byDay[key].sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
  }
  return byDay;
}

function formatPointLine(label, value) {
  return `- ${label}: ${value}`;
}

function buildDayText(dayKey, sessions, adjustments) {
  const dayLabel = getDisplayWeekdayFromKey(dayKey);
  const lines = [`${dayLabel}:`];

  if (!sessions.length) {
    lines.push('- Nao abriu ponto');
    return lines;
  }

  sessions.forEach((session, index) => {
    const sessionAdjustments = getPointAdjustmentsForSession(adjustments, session);
    lines.push(`Ponto ${index + 1}:`);
    lines.push(formatPointLine('Abriu as', session.startedAtTime || 'N/A'));
    lines.push(formatPointLine('Fechou as', session.closedAtTime || 'Em andamento'));
    lines.push(formatPointLine('Tempo total', session.durationFormatted));
    lines.push(formatPointLine('Ajustes feitos no ponto', String(sessionAdjustments.length)));
    lines.push(formatPointLine('ID do ponto', session.pointId || 'N/A'));

    if (!sessionAdjustments.length) {
      lines.push(formatPointLine('Motivo do ajuste', 'Nenhum'));
    } else {
      sessionAdjustments.forEach((adjustment, adjustmentIndex) => {
    lines.push(`Ajuste ${adjustmentIndex + 1}:`);
    lines.push(formatPointLine('Tipo do ajuste', adjustment.type));
    lines.push(formatPointLine('Quem fez o ajuste', formatActor(adjustment)));
    lines.push(formatPointLine('Horario antigo', formatMomentValue(adjustment.oldClosedAt || adjustment.oldStartedAt)));
    lines.push(formatPointLine('Horario novo', formatMomentValue(adjustment.newClosedAt || adjustment.newStartedAt)));
    lines.push(formatPointLine('Motivo do ajuste', adjustment.reason));
    lines.push(formatPointLine('Data e hora do ajuste', formatMomentValue(adjustment.adjustedAt)));
    lines.push(formatPointLine('Usuario dono', `<@${adjustment.ownerUserId}>`));
    lines.push(formatPointLine('Cargo/permissao', adjustment.adjustedByRoleIds.length ? adjustment.adjustedByRoleIds.map((id) => `<@&${id}>`).join(' ') : (adjustment.adjustedByPermissions.join(', ') || 'N/A')));
  });
    }
  });

  const totalMs = sessions.reduce((sum, session) => sum + Number(session.durationMs || 0), 0);
  lines.push(`Total do dia: ${formatDuration(totalMs)}`);
  lines.push(`Ajustes do dia: ${sessions.reduce((sum, session) => sum + getPointAdjustmentsForSession(adjustments, session).length, 0)}`);

  return lines;
}

function buildWeeklySummary({ sessions, adjustments, currentKey, weekKeys, weekStartKey, weekEndKey }) {
  const daysWithPoints = new Set(sessions.map((session) => session.dayKey).filter(Boolean));
  const daysWithActivity = new Set([
    ...sessions.map((session) => session.dayKey).filter(Boolean),
    ...adjustments.map((adjustment) => adjustment.dayKey).filter(Boolean),
  ]);
  const weekSessions = sessions.filter((session) => weekKeys.includes(session.dayKey));
  const totalMs = weekSessions.reduce((sum, session) => sum + Number(session.durationMs || 0), 0);
  const totalAdjustments = adjustments.length;
  const lastSession = weekSessions[weekSessions.length - 1] || null;
  const daysWithoutPoint = weekKeys.filter((key) => !daysWithPoints.has(key)).length;
  const daysWithoutActivity = weekKeys.filter((key) => !daysWithActivity.has(key)).length;
  const keysUntilToday = weekKeys.filter((key) => key <= currentKey);
  const daysWithoutPointUntilToday = keysUntilToday.filter((key) => !daysWithPoints.has(key)).length;
  const closedCount = weekSessions.filter((session) => session.closedAt).length;
  const weekdaysWithPoints = weekKeys
    .filter((key) => daysWithPoints.has(key))
    .map((key) => formatWeekdayLabel(key));

  return {
    weekStartKey,
    weekEndKey,
    totalMs,
    totalAdjustments,
    daysWithPoints: daysWithPoints.size,
    daysWithoutPoint,
    daysWithoutActivity,
    totalPoints: weekSessions.length,
    openedCount: weekSessions.length,
    closedCount,
    lastSession,
    daysWithoutPointUntilToday,
    weekdaysWithPoints,
  };
}

function buildAdjustmentHistoryText(adjustments) {
  if (!adjustments.length) return ['Histórico completo dos ajustes:', '- Nenhum ajuste registrado nesta semana.'];

  const lines = ['Historico completo dos ajustes:'];
  adjustments.forEach((adjustment, index) => {
    lines.push(`${index + 1}. ${adjustment.dayLabel} - ${adjustment.adjustedAt ? formatDate(adjustment.adjustedAt) : 'N/A'}`);
    lines.push(formatPointLine('ID do ponto', adjustment.pointId));
    lines.push(formatPointLine('Usuario dono', `<@${adjustment.ownerUserId}>`));
    lines.push(formatPointLine('Quem fez o ajuste', formatActor(adjustment)));
    lines.push(formatPointLine('Tipo do ajuste', adjustment.type));
    lines.push(formatPointLine('Horario antigo', formatMomentValue(adjustment.oldClosedAt || adjustment.oldStartedAt)));
    lines.push(formatPointLine('Horario novo', formatMomentValue(adjustment.newClosedAt || adjustment.newStartedAt)));
    lines.push(formatPointLine('Motivo', adjustment.reason));
    lines.push(formatPointLine('Data e hora', formatMomentValue(adjustment.adjustedAt)));
    lines.push(formatPointLine('Cargo/permissao', adjustment.adjustedByRoleIds.length ? adjustment.adjustedByRoleIds.map((id) => `<@&${id}>`).join(' ') : (adjustment.adjustedByPermissions.join(', ') || 'N/A')));
  });
  return lines;
}

function buildTranscriptData({ guild, target, member, data, monthKey = null }) {
  const generatedAt = new Date();
  const {
    currentKey,
    weekStartKey,
    weekEndKey,
    keys: weekKeys,
    periodType,
    periodKey,
    periodLabel,
  } = getReportDayKeys({ referenceDate: generatedAt, monthKey });
  const profile = getUserProfile(guild.id, target.id);
  const allSessions = getAllSessions(data);
  const sessions = allSessions.filter((session) => session.dayKey && weekKeys.includes(session.dayKey));
  const adjustments = getAllAdjustments(data, guild.id, target.id)
    .filter((adjustment) => adjustment.dayKey && adjustment.dayKey >= weekStartKey && adjustment.dayKey <= weekEndKey)
    .sort((a, b) => new Date(a.adjustedAt || 0).getTime() - new Date(b.adjustedAt || 0).getTime());
  const sessionsByDay = groupSessionsByDay(sessions, weekKeys);
  const summary = buildWeeklySummary({ sessions, adjustments, currentKey, weekKeys, weekStartKey, weekEndKey });
  const currentMonthKey = currentKey.slice(0, 7);
  const daySessions = allSessions.filter((session) => session.dayKey === currentKey);
  const monthSessions = allSessions.filter((session) => String(session.dayKey || '').startsWith(currentMonthKey));
  const latestSession = sessions[sessions.length - 1] || allSessions[allSessions.length - 1] || null;
  const statistics = {
    dayMs: daySessions.reduce((sum, session) => sum + Number(session.durationMs || 0), 0),
    weekMs: summary.totalMs,
    monthMs: monthSessions.reduce((sum, session) => sum + Number(session.durationMs || 0), 0),
    totalAccumulatedMs: getEffectiveTotalMs(data),
    pauseMs: 0,
    totalSessions: allSessions.length,
  };
  const lastActivityAt = data.lastPointCloseAt
    || data.lastPointOpenAt
    || data.firstPointAt
    || profile?.lastProfileUpdateAt
    || profile?.approvedAt
    || data.updatedAt
    || null;
  const offlineDurationFormatted = lastActivityAt ? formatDuration(Date.now() - new Date(lastActivityAt).getTime()) : 'N/A';

  return {
    generatedAt,
    guild,
    target,
    member,
    profile,
    sessions,
    allSessions,
    adjustments,
    weekKeys,
    sessionsByDay,
    summary,
    statistics,
    latestSession,
    currentKey,
    weekStartKey,
    weekEndKey,
    periodType,
    periodKey,
    periodLabel,
    lastActivityAt,
    offlineDurationFormatted,
  };
}

function buildTextBody(report) {
  const { generatedAt, guild, target, member, profile, sessionsByDay, summary, weekStartKey, weekEndKey, adjustments } = report;
  const userName = member?.displayName || profile?.displayName || target.username;
  const lines = [
    `Usuario: ${userName}`,
    `Discord ID: ${target.id}`,
    '',
    `Periodo: ${report.periodLabel || `${formatDateKey(weekStartKey)} ate ${formatDateKey(weekEndKey)}`}`,
    `Gerado em: ${formatDate(generatedAt)}`,
    `Servidor: ${guild.name}`,
    '',
  ];

  for (const dayKey of report.weekKeys) {
    lines.push(...buildDayText(dayKey, sessionsByDay[dayKey] || [], adjustments));
    lines.push('');
  }

  lines.push('Resumo da semana:');
  lines.push(formatPointLine('Dias que abriu ponto', String(summary.daysWithPoints)));
  lines.push(formatPointLine('Dias sem abrir ponto', String(summary.daysWithoutPoint)));
  lines.push(formatPointLine('Dias sem atividade', String(summary.daysWithoutActivity)));
  lines.push(formatPointLine('Total de pontos abertos', String(summary.totalPoints)));
  lines.push(formatPointLine('Total de pontos fechados', String(summary.closedCount)));
  lines.push(formatPointLine('Total de horas na semana', formatDuration(summary.totalMs)));
  lines.push(formatPointLine('Total de ajustes feitos', String(summary.totalAdjustments)));
  lines.push(formatPointLine('Ultimo ponto aberto', summary.lastSession ? `${summary.lastSession.dayLabel} as ${summary.lastSession.startedAtTime}` : 'N/A'));
  lines.push(formatPointLine('Dias sem abrir ponto ate hoje', String(summary.daysWithoutPointUntilToday)));
  lines.push(formatPointLine('Dias da semana com ponto', summary.weekdaysWithPoints.join(', ') || 'N/A'));
  lines.push(formatPointLine('Ultima atividade', report.lastActivityAt ? formatDate(report.lastActivityAt) : 'N/A'));
  lines.push(formatPointLine('Tempo sem logar', report.offlineDurationFormatted));
  lines.push('');
  lines.push(...buildAdjustmentHistoryText(adjustments));

  return `${lines.join('\n')}\n`;
}

function renderPointAdjustmentHtml(adjustment) {
  return `
    <div class="adjustment">
      <div class="adjustment-title">${escapeHtml(adjustment.adjustedAt ? formatDate(adjustment.adjustedAt) : 'N/A')} - ${escapeHtml(adjustment.type)}</div>
      <div class="adjustment-grid">
        <div><span>ID do ponto</span><strong>${escapeHtml(adjustment.pointId)}</strong></div>
        <div><span>Usuario dono</span><strong>${escapeHtml(adjustment.ownerUserId)}</strong></div>
        <div><span>Quem fez o ajuste</span><strong>${escapeHtml(adjustment.adjustedByDisplayName || adjustment.adjustedByTag || adjustment.adjustedBy || 'Sistema')}</strong></div>
        <div><span>Cargo/permissao</span><strong>${escapeHtml((adjustment.adjustedByRoleIds || []).join(' ') || (adjustment.adjustedByPermissions || []).join(', ') || 'N/A')}</strong></div>
        <div><span>Horario antigo</span><strong>${escapeHtml(formatMomentValue(adjustment.oldClosedAt || adjustment.oldStartedAt))}</strong></div>
        <div><span>Horario novo</span><strong>${escapeHtml(formatMomentValue(adjustment.newClosedAt || adjustment.newStartedAt))}</strong></div>
        <div><span>Motivo</span><strong>${escapeHtml(adjustment.reason)}</strong></div>
        <div><span>Data e hora</span><strong>${escapeHtml(formatMomentValue(adjustment.adjustedAt))}</strong></div>
      </div>
    </div>`;
}

function buildHtmlBody(report) {
  const { generatedAt, guild, target, member, profile, sessionsByDay, summary, statistics, latestSession, weekStartKey, weekEndKey, adjustments } = report;
  const userName = member?.displayName || profile?.displayName || target.username;
  const profileStatus = profile ? (profile.registeredManually ? 'Cadastro manual' : 'Aprovado no /set') : 'Sem cadastro no /set';
  const avatarUrl = typeof target.displayAvatarURL === 'function'
    ? target.displayAvatarURL({ size: 256, extension: 'png' })
    : null;

  const dayBlocks = report.weekKeys.map((dayKey) => {
    const sessions = sessionsByDay[dayKey] || [];
    const dayAdjustments = adjustments.filter((adjustment) => adjustment.dayKey === dayKey);
    const pointBlocks = sessions.length
      ? sessions.map((session, index) => {
          const sessionAdjustments = getPointAdjustmentsForSession(adjustments, session);
          const adjustmentItems = sessionAdjustments.length
            ? sessionAdjustments.map((adjustment) => `
                <li>
                  <strong>${escapeHtml(adjustment.type)}</strong>
                  <div>ID do ponto: ${escapeHtml(adjustment.pointId)}</div>
                  <div>Quem fez: ${escapeHtml(adjustment.adjustedByDisplayName || adjustment.adjustedByTag || adjustment.adjustedBy || 'Sistema')}</div>
                  <div>Cargo/permissao: ${escapeHtml((adjustment.adjustedByRoleIds || []).join(' ') || (adjustment.adjustedByPermissions || []).join(', ') || 'N/A')}</div>
                  <div>Horario antigo: ${escapeHtml(formatMomentValue(adjustment.oldClosedAt || adjustment.oldStartedAt))}</div>
                  <div>Horario novo: ${escapeHtml(formatMomentValue(adjustment.newClosedAt || adjustment.newStartedAt))}</div>
                  <div>Motivo: ${escapeHtml(adjustment.reason)}</div>
                  <div>Data/hora: ${escapeHtml(formatMomentValue(adjustment.adjustedAt))}</div>
                </li>
              `).join('')
            : '<li><strong>Sem ajustes</strong></li>';

          return `
            <div class="point-card">
              <h4>Ponto ${index + 1}</h4>
              <div class="point-grid">
                <div><span>Abriu as</span><strong>${escapeHtml(session.startedAtTime)}</strong></div>
                <div><span>Fechou as</span><strong>${escapeHtml(session.closedAtTime)}</strong></div>
                <div><span>Tempo total</span><strong>${escapeHtml(session.durationFormatted)}</strong></div>
                <div><span>Status</span><strong>${escapeHtml(session.status)}</strong></div>
                <div><span>Origem</span><strong>${escapeHtml(session.origin || 'Ponto manual')}</strong></div>
                <div><span>Servidor/Cidade</span><strong>${escapeHtml(session.serverName || 'N/A')}</strong></div>
                <div><span>Responsavel</span><strong>${escapeHtml(session.adjustedByDisplayName || session.adjustedByTag || session.adjustedBy || 'Sistema')}</strong></div>
                <div><span>Ajustes no ponto</span><strong>${escapeHtml(String(sessionAdjustments.length))}</strong></div>
                <div><span>ID do ponto</span><strong>${escapeHtml(session.pointId || 'N/A')}</strong></div>
              </div>
              <div class="adjustments">
                <div class="subheading">Ajustes deste ponto</div>
                <ul>${adjustmentItems}</ul>
              </div>
            </div>`;
        }).join('')
      : '<div class="empty">Nao abriu ponto.</div>';

    return `
      <section class="day">
        <header class="day-header">
          <h3>${escapeHtml(formatWeekdayLabel(dayKey))}</h3>
          <div class="day-meta">${escapeHtml(formatDateKey(dayKey))} | Ajustes do dia: ${escapeHtml(String(dayAdjustments.length))}</div>
        </header>
        <div class="day-body">
          ${pointBlocks}
          <div class="day-total">Total do dia: ${escapeHtml(formatDuration(sessions.reduce((sum, session) => sum + Number(session.durationMs || 0), 0)))}</div>
        </div>
      </section>`;
  }).join('');

  const historyBlocks = adjustments.length
    ? adjustments.map((adjustment, index) => `
        <div class="history-item">
          <div class="history-title">${index + 1}. ${escapeHtml(adjustment.dayLabel)} | ${escapeHtml(adjustment.adjustedAt ? formatDate(adjustment.adjustedAt) : 'N/A')}</div>
          <div class="history-grid">
            <div><span>ID do ponto</span><strong>${escapeHtml(adjustment.pointId)}</strong></div>
            <div><span>Usuario dono</span><strong>${escapeHtml(adjustment.ownerUserId)}</strong></div>
            <div><span>Quem fez</span><strong>${escapeHtml(adjustment.adjustedByDisplayName || adjustment.adjustedByTag || adjustment.adjustedBy || 'Sistema')}</strong></div>
            <div><span>Cargo/permissao</span><strong>${escapeHtml((adjustment.adjustedByRoleIds || []).join(' ') || (adjustment.adjustedByPermissions || []).join(', ') || 'N/A')}</strong></div>
            <div><span>Tipo</span><strong>${escapeHtml(adjustment.type)}</strong></div>
            <div><span>Motivo</span><strong>${escapeHtml(adjustment.reason)}</strong></div>
            <div><span>Horario antigo</span><strong>${escapeHtml(formatMomentValue(adjustment.oldClosedAt || adjustment.oldStartedAt))}</strong></div>
            <div><span>Horario novo</span><strong>${escapeHtml(formatMomentValue(adjustment.newClosedAt || adjustment.newStartedAt))}</strong></div>
          </div>
        </div>`).join('')
    : '<div class="empty">Nenhum ajuste registrado nesta semana.</div>';

  const actionHistoryBlocks = report.sessions.length
    ? report.sessions.map((session, index) => `
        <div class="history-item">
          <div class="history-title">${index + 1}. ${escapeHtml(session.dayLabel)} | ${escapeHtml(session.startedAt ? formatDate(session.startedAt) : 'N/A')}</div>
          <div class="history-grid">
            <div><span>Entrada registrada</span><strong>${escapeHtml(formatMomentValue(session.startedAt))}</strong></div>
            <div><span>Pausa iniciada</span><strong>Nenhuma pausa registrada</strong></div>
            <div><span>Pausa encerrada</span><strong>Nenhuma pausa registrada</strong></div>
            <div><span>Saida registrada</span><strong>${escapeHtml(session.closedAt ? formatMomentValue(session.closedAt) : 'Em andamento')}</strong></div>
            <div><span>Tempo total</span><strong>${escapeHtml(session.durationFormatted)}</strong></div>
            <div><span>Origem</span><strong>${escapeHtml(session.origin || 'Ponto manual')}</strong></div>
            <div><span>Status</span><strong>${escapeHtml(session.status)}</strong></div>
            <div><span>ID do ponto</span><strong>${escapeHtml(session.pointId || 'N/A')}</strong></div>
          </div>
        </div>`).join('')
    : '<div class="empty">Nenhuma ação registrada neste periodo.</div>';

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Vortex | Relatorio completo</title>
  <link rel="stylesheet" href="/vendor/fontawesome/css/all.min.css">
  <style>
    :root{--bg:#03060d;--panel:#07111f;--panel2:#0b1728;--panel3:#101d33;--line:#163a75;--line2:#005dff;--text:#f5f7ff;--muted:#a9b8d4;--accent:#005dff;--accent2:#00d9ff;--accent3:#0066ff;--good:#22c55e;--warn:#facc15;--danger:#ff2d6f;--shadow:0 0 34px rgba(0,93,255,.24)}
    *{box-sizing:border-box}
    html{scroll-behavior:smooth}
    body{margin:0;background:radial-gradient(circle at 18% 0,rgba(0,93,255,.32),transparent 34%),radial-gradient(circle at 86% 12%,rgba(0,217,255,.16),transparent 30%),linear-gradient(180deg,#02040a 0%,#050a14 42%,#03060d 100%);color:var(--text);font-family:Arial,Helvetica,sans-serif;line-height:1.45;min-height:100vh}
    body:before{content:"";position:fixed;inset:0;pointer-events:none;opacity:.28;background-image:linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.025) 1px,transparent 1px);background-size:38px 38px;mask-image:linear-gradient(180deg,#000,transparent 82%);z-index:-1}
    header.hero{position:relative;padding:34px 0 30px;border-bottom:1px solid rgba(0,93,255,.55);background:linear-gradient(135deg,rgba(3,6,13,.95),rgba(0,35,92,.74)),url("/assets/IMG_4234.png") center/cover no-repeat;box-shadow:0 20px 80px rgba(0,93,255,.18);overflow:hidden}
    header.hero:before,header.hero:after{content:"";position:absolute;width:180px;height:22px;border-top:5px double rgba(245,247,255,.34);border-bottom:5px double rgba(0,217,255,.22);transform:rotate(-34deg);filter:drop-shadow(0 0 12px rgba(0,93,255,.8));opacity:.82}
    header.hero:before{left:-38px;top:22px}
    header.hero:after{right:-44px;bottom:26px}
    .wrap{width:min(1220px,calc(100% - 32px));margin:0 auto}
    .hero-top{display:flex;justify-content:space-between;align-items:flex-start;gap:18px}
    .brand{display:inline-flex;align-items:center;gap:10px;font-size:12px;letter-spacing:3px;text-transform:uppercase;color:var(--accent2);font-weight:800;text-shadow:0 0 18px rgba(0,217,255,.72)}
    .brand:before{content:"V";display:grid;place-items:center;width:34px;height:34px;border-radius:8px;background:linear-gradient(135deg,var(--accent),var(--accent2));color:#fff;letter-spacing:0;box-shadow:0 0 22px rgba(0,93,255,.72)}
    h1{margin:10px 0 0;font-size:44px;line-height:1.02;letter-spacing:0;text-shadow:0 0 26px rgba(0,93,255,.58)}
    .subtitle{color:#d6e2ff;margin-top:7px;font-size:13px}
    .status{align-self:flex-start;border:1px solid rgba(0,217,255,.48);border-radius:8px;padding:11px 15px;font-weight:800;background:rgba(5,13,26,.82);box-shadow:var(--shadow);color:#fff;text-transform:uppercase;font-size:12px}
    main{display:grid;gap:16px;padding:22px 0 40px}
    .profile,.summary,.day,.history{background:linear-gradient(180deg,rgba(7,17,31,.96),rgba(5,10,20,.98));border:1px solid rgba(0,93,255,.34);border-radius:8px;box-shadow:var(--shadow);position:relative;overflow:hidden}
    .profile:before,.summary:before,.day:before,.history:before{content:"";position:absolute;inset:0 0 auto;height:2px;background:linear-gradient(90deg,transparent,var(--accent2),var(--accent),transparent);opacity:.85}
    .profile{padding:18px}
    .profile-grid,.summary-grid,.point-grid,.adjustment-grid,.history-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
    .profile-head{display:flex;gap:16px;align-items:center}
    .avatar{width:68px;height:68px;border-radius:8px;background:linear-gradient(135deg,var(--accent),var(--accent2));display:grid;place-items:center;font-weight:900;font-size:22px;border:1px solid rgba(255,255,255,.24);box-shadow:0 0 26px rgba(0,93,255,.6);overflow:hidden}
    .avatar img{width:100%;height:100%;object-fit:cover;display:block}
    .meta-item,.summary-item,.point-card,.adjustment,.history-item{background:linear-gradient(180deg,rgba(16,29,51,.9),rgba(8,18,34,.92));border:1px solid rgba(0,93,255,.28);border-radius:8px;padding:12px;box-shadow:0 10px 24px rgba(0,0,0,.24)}
    .meta-item span,.summary-item span,.point-grid span,.adjustment-grid span,.history-grid span{display:block;color:#8fb5ff;font-size:11px;text-transform:uppercase;font-weight:800}
    .meta-item strong,.summary-item strong,.point-grid strong,.adjustment-grid strong,.history-grid strong{display:block;margin-top:4px;font-size:14px;overflow-wrap:anywhere;color:var(--text)}
    .summary{padding:14px 16px}
    .summary-grid{grid-template-columns:repeat(4,minmax(0,1fr))}
    .summary-title{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
    .pill{border:1px solid rgba(0,217,255,.45);color:#fff;border-radius:999px;padding:7px 12px;font-size:12px;font-weight:800;background:rgba(0,93,255,.18);box-shadow:0 0 20px rgba(0,93,255,.22)}
    .day{overflow:hidden}
    .day-header{padding:16px 16px 12px;border-bottom:1px solid rgba(0,93,255,.28);background:linear-gradient(90deg,rgba(0,93,255,.18),transparent)}
    .day-header h3{margin:0;font-size:20px;color:#fff;text-shadow:0 0 16px rgba(0,93,255,.45)}
    .day-meta{margin-top:6px;color:#b8c8e8;font-size:12px}
    .day-body{padding:16px;display:grid;gap:12px}
    .point-card h4{margin:0 0 10px;font-size:15px}
    .adjustments,.day-total,.empty{border-top:1px solid rgba(0,93,255,.25);padding-top:12px}
    .day-total{color:#fff;font-weight:800}
    .subheading{font-size:12px;color:#8fb5ff;text-transform:uppercase;font-weight:800;margin-bottom:8px}
    .adjustments ul{margin:0;padding-left:18px}
    .adjustments li{margin-bottom:10px}
    .history{padding:16px}
    .history-grid{grid-template-columns:repeat(4,minmax(0,1fr))}
    .history-title{font-weight:700;margin-bottom:10px}
    .section-title{font-size:18px;margin:0 0 12px}
    .empty{color:var(--muted);background:rgba(0,93,255,.06);border-radius:8px;padding:14px;border:1px dashed rgba(0,93,255,.28)}
    .stack{display:grid;gap:16px}
    .muted{color:var(--muted)}
    @media print{body{background:#fff;color:#111}header.hero,.profile,.summary,.day,.history{box-shadow:none}button{display:none!important}}
    @media(max-width:900px){
      .hero-top,.profile-head{grid-template-columns:1fr;display:grid}
      .profile-grid,.summary-grid,.point-grid,.adjustment-grid,.history-grid{grid-template-columns:1fr 1fr}
      h1{font-size:32px}
    }
    @media(max-width:620px){
      .profile-grid,.summary-grid,.point-grid,.adjustment-grid,.history-grid{grid-template-columns:1fr}
      .hero-top{gap:12px}
    }
  </style>
</head>
<body>
  <header class="hero">
    <div class="wrap hero-top">
      <div>
        <div class="brand"><i class="fa-solid fa-shield-halved"></i> Vortex Management</div>
        <h1><i class="fa-solid fa-file-lines"></i> VORTEX — Relatorio Completo</h1>
        <div class="subtitle">Usuario: ${escapeHtml(userName)} | Discord ID: ${escapeHtml(target.id)}</div>
        <div class="subtitle">Periodo: ${escapeHtml(report.periodLabel || `${formatDateKey(weekStartKey)} ate ${formatDateKey(weekEndKey)}`)}</div>
        <div class="subtitle">Gerado em: ${escapeHtml(formatDate(generatedAt))}</div>
      </div>
      <div class="status"><i class="fa-solid fa-circle-info"></i> ${escapeHtml(summary.lastSession ? `${summary.lastSession.status} / ${summary.lastSession.dayLabel}` : 'Sem ponto')}</div>
    </div>
  </header>

  <main class="wrap stack">
    <section class="profile">
      <div class="profile-head">
        <div class="avatar">${avatarUrl ? `<img src="${escapeHtml(avatarUrl)}" alt="Avatar de ${escapeHtml(userName)}">` : escapeHtml((userName || 'VX').slice(0, 2).toUpperCase())}</div>
        <div>
          <h2 style="margin:0 0 4px;font-size:22px;"><i class="fa-solid fa-user"></i> Dados do usuario</h2>
          <div class="muted">${escapeHtml(profile ? (profile.registeredManually ? 'Cadastro manual' : 'Aprovado no /set') : 'Sem cadastro no /set')}</div>
        </div>
      </div>
      <div class="profile-grid" style="margin-top:16px;">
        <div class="meta-item"><span>Nome Discord</span><strong>${escapeHtml(userName)}</strong></div>
        <div class="meta-item"><span>Discord ID</span><strong>${escapeHtml(target.id)}</strong></div>
        <div class="meta-item"><span>Tag</span><strong>${escapeHtml(target.tag || target.username)}</strong></div>
        <div class="meta-item"><span>Role principal</span><strong>${escapeHtml(member?.roles?.highest?.name || 'N/A')}</strong></div>
        <div class="meta-item"><span>Nome em game</span><strong>${escapeHtml(profile?.nomeGame || 'N/A')}</strong></div>
        <div class="meta-item"><span>ID em game</span><strong>${escapeHtml(profile?.idGame || 'N/A')}</strong></div>
        <div class="meta-item"><span>Numero</span><strong>${escapeHtml(profile?.numeroGame || 'N/A')}</strong></div>
        <div class="meta-item"><span>Nivel</span><strong>${escapeHtml(profile?.nivelGame || 'N/A')}</strong></div>
      </div>
    </section>

    <section class="summary">
      <div class="summary-title">
        <h2 class="section-title" style="margin:0;">Estatisticas de ponto</h2>
        <div class="pill">Vortex - relatorio completo</div>
      </div>
      <div class="summary-grid">
        <div class="summary-item"><span>Data</span><strong>${escapeHtml(formatDateKey(report.currentKey))}</strong></div>
        <div class="summary-item"><span>Entrada</span><strong>${escapeHtml(latestSession?.startedAt ? formatDate(latestSession.startedAt) : 'N/A')}</strong></div>
        <div class="summary-item"><span>Saida</span><strong>${escapeHtml(latestSession?.closedAt ? formatDate(latestSession.closedAt) : 'Em andamento')}</strong></div>
        <div class="summary-item"><span>Tempo em pausa</span><strong>${escapeHtml(formatDuration(statistics.pauseMs))}</strong></div>
        <div class="summary-item"><span>Horas do dia</span><strong>${escapeHtml(formatDuration(statistics.dayMs))}</strong></div>
        <div class="summary-item"><span>Horas semanais</span><strong>${escapeHtml(formatDuration(statistics.weekMs))}</strong></div>
        <div class="summary-item"><span>Horas mensais</span><strong>${escapeHtml(formatDuration(statistics.monthMs))}</strong></div>
        <div class="summary-item"><span>Total acumulado</span><strong>${escapeHtml(formatDuration(statistics.totalAccumulatedMs))}</strong></div>
        <div class="summary-item"><span>Dias que abriu ponto</span><strong>${escapeHtml(String(summary.daysWithPoints))}</strong></div>
        <div class="summary-item"><span>Dias sem abrir ponto</span><strong>${escapeHtml(String(summary.daysWithoutPoint))}</strong></div>
        <div class="summary-item"><span>Dias sem atividade</span><strong>${escapeHtml(String(summary.daysWithoutActivity))}</strong></div>
        <div class="summary-item"><span>Total de pontos abertos</span><strong>${escapeHtml(String(summary.totalPoints))}</strong></div>
        <div class="summary-item"><span>Total de pontos fechados</span><strong>${escapeHtml(String(summary.closedCount))}</strong></div>
        <div class="summary-item"><span>Total de horas na semana</span><strong>${escapeHtml(formatDuration(summary.totalMs))}</strong></div>
        <div class="summary-item"><span>Total de ajustes feitos</span><strong>${escapeHtml(String(summary.totalAdjustments))}</strong></div>
        <div class="summary-item"><span>Ultimo ponto aberto</span><strong>${escapeHtml(summary.lastSession ? `${summary.lastSession.dayLabel} as ${summary.lastSession.startedAtTime}` : 'N/A')}</strong></div>
        <div class="summary-item"><span>Dias sem abrir ate hoje</span><strong>${escapeHtml(String(summary.daysWithoutPointUntilToday))}</strong></div>
        <div class="summary-item"><span>Tempo geral salvo</span><strong>${escapeHtml(formatDuration(summary.totalMs))}</strong></div>
        <div class="summary-item"><span>Dias da semana com ponto</span><strong>${escapeHtml(summary.weekdaysWithPoints.join(', ') || 'N/A')}</strong></div>
        <div class="summary-item"><span>Última atividade</span><strong>${escapeHtml(report.lastActivityAt ? formatDate(report.lastActivityAt) : 'N/A')}</strong></div>
        <div class="summary-item"><span>Tempo sem logar</span><strong>${escapeHtml(report.offlineDurationFormatted)}</strong></div>
      </div>
    </section>

    ${dayBlocks}

    <section class="history">
      <h2 class="section-title">Historico de acoes</h2>
      ${actionHistoryBlocks}
    </section>

    <section class="history">
      <h2 class="section-title">Historico completo dos ajustes</h2>
      ${historyBlocks}
    </section>
  </main>
</body>
</html>`;
}

function createPointTranscriptText({ guild, target, member, data, monthKey = null }) {
  const report = buildTranscriptData({ guild, target, member, data, monthKey });
  return buildTextBody(report);
}

function createPointTranscriptHtml({ guild, target, member, data, monthKey = null }) {
  const report = buildTranscriptData({ guild, target, member, data, monthKey });
  return buildHtmlBody(report);
}

function createPointTranscriptAttachment({ guild, target, member, data }) {
  const html = createPointTranscriptHtml({ guild, target, member, data });
  const timestamp = new Date().toISOString().replace(/:/g, '-');
  return new AttachmentBuilder(Buffer.from(html, 'utf8'), {
    name: `${target.id}_${timestamp}_ticket.html`,
  });
}

function createPointTranscriptTextAttachment({ guild, target, member, data }) {
  const text = createPointTranscriptText({ guild, target, member, data });
  const timestamp = new Date().toISOString().replace(/:/g, '-');
  return new AttachmentBuilder(Buffer.from(text, 'utf8'), {
    name: `${target.id}_${timestamp}_folha-ponto.txt`,
  });
}

module.exports = {
  buildTranscriptData,
  createPointTranscriptAttachment,
  createPointTranscriptHtml,
  createPointTranscriptText,
  createPointTranscriptTextAttachment,
};
