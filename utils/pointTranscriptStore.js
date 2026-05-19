const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getUserPoint, formatDuration, formatDate } = require('./pontoManager');
const { buildTranscriptData, createPointTranscriptHtml } = require('./pontoTranscript');

const STORE_PATH = path.join(__dirname, '..', 'commands', 'pointTranscripts.json');
const PUBLIC_TRANSCRIPTS_DIR = path.join(__dirname, '..', 'public', 'transcripts');

function ensureStore() {
  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(STORE_PATH, `${JSON.stringify({}, null, 2)}\n`, 'utf8');
  }
  if (!fs.existsSync(PUBLIC_TRANSCRIPTS_DIR)) {
    fs.mkdirSync(PUBLIC_TRANSCRIPTS_DIR, { recursive: true });
  }
}

function readStore() {
  ensureStore();
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8') || '{}');
  } catch {
    return {};
  }
}

function writeStore(data) {
  ensureStore();
  fs.writeFileSync(STORE_PATH, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function buildBaseUrl() {
  return String(
    process.env.VORTEX_TRANSCRIPT_BASE_URL
    || process.env.POINT_SITE_BASE_URL
    || process.env.PUBLIC_BASE_URL
    || process.env.SITE_URL
    || 'http://localhost:3000'
  ).trim().replace(/\/+$/, '') || 'http://localhost:3000';
}

function buildTranscriptUrl(transcriptId) {
  const url = new URL(`/transcripts/${normalizeTranscriptId(transcriptId)}`, buildBaseUrl());
  return url.toString();
}

function normalizeTranscriptId(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return path.basename(raw).replace(/\.(html?|txt)$/i, '');
}

function getLocalMonthKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
  });
}

function getSessionDurationMs(session) {
  if (Number.isFinite(Number(session.durationMs))) return Number(session.durationMs);
  if (!session.startedAt || !session.closedAt) return 0;
  return Math.max(0, new Date(session.closedAt).getTime() - new Date(session.startedAt).getTime());
}

function getMonthTotalMs(data, monthKey = getLocalMonthKey()) {
  const sessions = Array.isArray(data.sessions) ? data.sessions : [];
  return sessions
    .filter((session) => getLocalMonthKey(session.startedAt) === monthKey)
    .reduce((sum, session) => sum + getSessionDurationMs(session), 0);
}

async function createPointTranscriptRecord({ guild, target, generatedBy, monthKey = null }) {
  ensureStore();
  const member = await guild.members.fetch(target.id).catch(() => null);
  const data = await getUserPoint(guild.id, target.id);
  const report = buildTranscriptData({ guild, target, member, data, monthKey });
  const html = createPointTranscriptHtml({ guild, target, member, data, monthKey });
  const token = crypto.randomBytes(24).toString('hex');
  const transcriptId = `vtx-${Date.now().toString(36)}-${crypto.randomBytes(5).toString('hex')}`;
  const htmlFileName = `${transcriptId}.html`;
  const htmlPath = path.join(PUBLIC_TRANSCRIPTS_DIR, htmlFileName);
  const monthlyTotalMs = getMonthTotalMs(data, report.periodType === 'month' ? report.periodKey : undefined);
  const userName = member?.displayName || report.profile?.displayName || target.username || target.id;

  const record = {
    id: transcriptId,
    token,
    guildId: guild.id,
    guildName: guild.name,
    targetUserId: target.id,
    targetUserName: userName,
    generatedById: generatedBy.id,
    generatedByTag: generatedBy.tag || generatedBy.username || generatedBy.id,
    generatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    weekStartKey: report.weekStartKey,
    weekEndKey: report.weekEndKey,
    periodType: report.periodType,
    periodKey: report.periodKey,
    periodLabel: report.periodLabel,
    roleName: member?.roles?.highest?.name || 'N/A',
    factionName: member?.roles?.highest?.name || 'N/A',
    summary: {
      daysWithPoints: report.summary.daysWithPoints,
      daysWithoutPoint: report.summary.daysWithoutPoint,
      daysWithoutActivity: report.summary.daysWithoutPoint,
      weeklyTotalMs: report.summary.totalMs,
      weeklyTotal: formatDuration(report.summary.totalMs),
      monthlyTotalMs,
      monthlyTotal: formatDuration(monthlyTotalMs),
      openedCount: report.summary.totalPoints,
      closedCount: report.sessions.filter((session) => session.closedAt).length,
      manualAdjustments: report.summary.totalAdjustments,
    },
    publicPath: `/transcripts/${transcriptId}`,
    htmlFileName,
    htmlPath,
    accessLog: [],
  };

  fs.writeFileSync(htmlPath, buildTranscriptShellHtml(html, record), 'utf8');

  const store = readStore();
  store[transcriptId] = record;
  writeStore(store);

  return {
    record,
    url: buildTranscriptUrl(transcriptId),
  };
}

function getPointTranscriptRecord(id) {
  return readStore()[normalizeTranscriptId(id)] || null;
}

function validateTranscriptAccess(record, token) {
  if (!record) return { ok: false, status: 404, message: 'Transcript nao encontrado.' };
  if (record.expiresAt && new Date(record.expiresAt).getTime() < Date.now()) {
    return { ok: false, status: 410, message: 'Transcript expirado.' };
  }
  if (record.token && String(token || '') !== record.token) {
    return { ok: false, status: 403, message: 'Token invalido.' };
  }
  return { ok: true };
}

function registerTranscriptAccess(id, details = {}) {
  const store = readStore();
  const transcriptId = normalizeTranscriptId(id);
  const record = store[transcriptId];
  if (!record) return null;
  record.accessLog = [
    ...(Array.isArray(record.accessLog) ? record.accessLog : []),
    {
      at: new Date().toISOString(),
      ip: details.ip || null,
      userAgent: details.userAgent || null,
    },
  ].slice(-100);
  store[transcriptId] = record;
  writeStore(store);
  return record;
}

function resolveTranscriptFile(record, pathKey, fileNameKey) {
  if (record?.[pathKey] && fs.existsSync(record[pathKey])) return record[pathKey];
  const fileName = record?.[fileNameKey] ? path.basename(record[fileNameKey]) : '';
  if (!fileName) return null;
  const fallbackPath = path.join(PUBLIC_TRANSCRIPTS_DIR, fileName);
  return fs.existsSync(fallbackPath) ? fallbackPath : null;
}

function buildTranscriptFilePayload(record) {
  const files = [];
  const htmlPath = resolveTranscriptFile(record, 'htmlPath', 'htmlFileName');

  if (htmlPath) {
    files.push({
      attachment: htmlPath,
      name: record.htmlFileName || `${record.id || 'transcript'}.html`,
    });
  }

  return files;
}

function buildTranscriptShell(record) {
  if (record?.htmlPath && fs.existsSync(record.htmlPath)) {
    return fs.readFileSync(record.htmlPath, 'utf8');
  }
  if (record?.htmlFileName) {
    const filePath = path.join(PUBLIC_TRANSCRIPTS_DIR, record.htmlFileName);
    if (fs.existsSync(filePath)) return fs.readFileSync(filePath, 'utf8');
  }
  return buildTranscriptShellHtml(record.html || '<!doctype html><html><body>Transcript indisponivel.</body></html>', record);
}

function buildTranscriptShellHtml(html, record = {}) {
  const filters = `
    <div style="position:fixed;right:16px;bottom:16px;z-index:9;display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;font-family:Arial,Helvetica,sans-serif">
      <button onclick="window.print()" style="background:linear-gradient(135deg,#005DFF,#00D9FF);color:#fff;border:1px solid rgba(255,255,255,.22);border-radius:8px;padding:11px 13px;font-weight:900;box-shadow:0 0 28px rgba(0,93,255,.55);cursor:pointer">Baixar PDF</button>
      <button onclick="navigator.clipboard.writeText(location.href)" style="background:rgba(7,17,31,.94);color:#F5F5F5;border:1px solid rgba(0,217,255,.55);border-radius:8px;padding:11px 13px;font-weight:900;box-shadow:0 0 22px rgba(0,93,255,.28);cursor:pointer">Copiar link</button>
    </div>
    <div style="max-width:1220px;margin:16px auto 0;padding:0 16px;font-family:Arial,Helvetica,sans-serif">
      <div style="border:1px solid rgba(0,93,255,.35);background:linear-gradient(90deg,rgba(0,93,255,.18),rgba(7,17,31,.78));box-shadow:0 0 28px rgba(0,93,255,.2);border-radius:8px;padding:12px 14px;color:#d6e2ff">
        <strong style="color:#fff">Filtros web</strong>
        <span style="color:#8fb5ff"> | periodo ${record.periodLabel || `${record.weekStartKey} ate ${record.weekEndKey}`} | usuario ${record.targetUserName} | faccao ${record.factionName}</span>
      </div>
    </div>
  `;
  return String(html || '').replace('<body>', `<body>${filters}`);
}

module.exports = {
  createPointTranscriptRecord,
  getPointTranscriptRecord,
  validateTranscriptAccess,
  registerTranscriptAccess,
  buildTranscriptShell,
  buildTranscriptUrl,
  buildTranscriptFilePayload,
  normalizeTranscriptId,
  formatDate,
};
