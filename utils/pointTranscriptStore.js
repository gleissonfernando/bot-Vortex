const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getUserPoint, formatDuration, formatDate } = require('./pontoManager');
const { buildTranscriptData, createPointTranscriptHtml } = require('./pontoTranscript');
const { buildDailyPointReportData, createDailyPointReportHtml } = require('./dailyPointReportTranscript');

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
  const url = new URL(`/ponto/${normalizeTranscriptId(transcriptId)}`, buildBaseUrl());
  return url.toString();
}

function buildDailyReportUrl(transcriptId) {
  const url = new URL(`/relatorio/${normalizeTranscriptId(transcriptId)}`, buildBaseUrl());
  return url.toString();
}

function normalizeTranscriptId(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return path.basename(raw).replace(/\.(html?|txt)$/i, '');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
    kind: 'point-report',
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
      daysWithoutActivity: report.summary.daysWithoutActivity,
      weeklyTotalMs: report.summary.totalMs,
      weeklyTotal: formatDuration(report.summary.totalMs),
      monthlyTotalMs,
      monthlyTotal: formatDuration(monthlyTotalMs),
      openedCount: report.summary.openedCount,
      closedCount: report.summary.closedCount,
      manualAdjustments: report.summary.totalAdjustments,
      latestOpenAt: report.latestSession?.startedAt || null,
      latestOpenAtFormatted: report.latestSession?.startedAt ? formatDate(report.latestSession.startedAt) : 'N/A',
      latestCloseAt: report.latestSession?.closedAt || null,
      latestCloseAtFormatted: report.latestSession?.closedAt ? formatDate(report.latestSession.closedAt) : 'Em andamento',
    },
    publicPath: `/ponto/${transcriptId}`,
    htmlFileName,
    htmlPath,
    html,
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

async function createDailyPointReportRecord({ guild, generatedBy, dateKey = null, includeAllMembers = true, includeOnlyActive = true } = {}) {
  ensureStore();
  const report = await buildDailyPointReportData(guild, { dateKey: dateKey || undefined, includeAllMembers, includeOnlyActive });
  const html = createDailyPointReportHtml(report);
  const token = crypto.randomBytes(24).toString('hex');
  const transcriptId = `vtx-${Date.now().toString(36)}-${crypto.randomBytes(5).toString('hex')}`;
  const htmlFileName = `${transcriptId}.html`;
  const htmlPath = path.join(PUBLIC_TRANSCRIPTS_DIR, htmlFileName);

  const record = {
    id: transcriptId,
    kind: 'daily-report',
    token,
    guildId: guild.id,
    guildName: guild.name,
    generatedById: generatedBy?.id || null,
    generatedByTag: generatedBy?.tag || generatedBy?.username || generatedBy?.id || 'Sistema',
    generatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    periodType: 'day',
    periodKey: report.dateKey,
    periodLabel: report.dateLabel,
    summary: report.summary,
    publicPath: `/relatorio/${transcriptId}`,
    htmlFileName,
    htmlPath,
    html,
    accessLog: [],
  };

  fs.writeFileSync(htmlPath, buildTranscriptShellHtml(html, record), 'utf8');

  const store = readStore();
  store[transcriptId] = record;
  writeStore(store);

  return {
    record,
    report,
    url: buildDailyReportUrl(transcriptId),
  };
}

function getPointTranscriptRecord(id) {
  const transcriptId = normalizeTranscriptId(id);
  return readStore()[transcriptId] || buildFallbackTranscriptRecord(transcriptId);
}

function buildFallbackTranscriptRecord(id) {
  const transcriptId = normalizeTranscriptId(id);
  if (!transcriptId) return null;

  const htmlFileName = `${transcriptId}.html`;
  const htmlPath = path.join(PUBLIC_TRANSCRIPTS_DIR, htmlFileName);
  if (!fs.existsSync(htmlPath)) return null;

  return {
    id: transcriptId,
    kind: 'point-report',
    guildName: 'Vortex',
    targetUserName: 'N/A',
    factionName: 'N/A',
    periodLabel: 'Transcript recuperado do arquivo HTML',
    publicPath: `/ponto/${transcriptId}`,
    htmlFileName,
    htmlPath,
    accessLog: [],
  };
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
  if (record?.htmlShell) return record.htmlShell;
  return buildTranscriptShellHtml(record.html || '<!doctype html><html><body>Transcript indisponivel.</body></html>', record);
}

function buildTranscriptShellHtml(html, record = {}) {
  const metaText = record.kind === 'daily-report'
    ? `relatorio diario ${record.periodLabel || record.periodKey || 'N/A'} | servidor ${record.guildName || 'Vortex'}`
    : `periodo ${record.periodLabel || `${record.weekStartKey} ate ${record.weekEndKey}`} | usuario ${record.targetUserName || 'N/A'} | faccao ${record.factionName || 'N/A'}`;
  const themeStyle = `
    <style id="vortex-transcript-red-theme">
      :root{--accent:#ef4444!important;--accent2:#f87171!important;--line:#7f1d1d!important;--line2:#ef4444!important;--panel:#151518!important;--panel2:#232327!important;--panel3:#2f2f35!important;--muted:#a7a7ad!important;--shadow:0 24px 80px rgba(0,0,0,.42)!important}
      body{background:radial-gradient(circle at 14% -8%,rgba(239,68,68,.24),transparent 34%),radial-gradient(circle at 92% 0,rgba(120,113,108,.22),transparent 28%),linear-gradient(180deg,#050506,#101012 48%,#070708)!important;color:#f8fafc!important}
      header.hero{background:linear-gradient(135deg,rgba(10,10,12,.94),rgba(127,29,29,.36)),url("/assets/IMG_4234.png") center/cover no-repeat!important;border-bottom-color:rgba(239,68,68,.42)!important;box-shadow:0 24px 80px rgba(0,0,0,.42)!important}
      .brand,.day-header h3,.section-title{color:#fff!important;text-shadow:none!important}
      .brand{color:#fca5a5!important}
      .brand:before,.avatar{background:linear-gradient(135deg,#ef4444,#3f3f46)!important;box-shadow:0 0 24px rgba(239,68,68,.35)!important}
      .profile,.summary,.day,.history,.card,.panel{background:linear-gradient(180deg,rgba(21,21,24,.74),rgba(12,12,14,.9))!important;border-color:rgba(239,68,68,.28)!important;box-shadow:0 24px 80px rgba(0,0,0,.34)!important;backdrop-filter:blur(18px)}
      .profile:before,.summary:before,.day:before,.history:before{background:linear-gradient(90deg,transparent,#ef4444,#7f1d1d,transparent)!important}
      .meta-item,.summary-item,.point-card,.adjustment,.history-item{background:linear-gradient(180deg,rgba(35,35,39,.78),rgba(15,15,17,.88))!important;border-color:rgba(239,68,68,.2)!important}
      .meta-item span,.summary-item span,.point-grid span,.adjustment-grid span,.history-grid span{color:#fca5a5!important}
      .pill{background:rgba(239,68,68,.12)!important;border-color:rgba(239,68,68,.32)!important;color:#fecaca!important}
      .day-header{background:linear-gradient(90deg,rgba(239,68,68,.14),transparent)!important;border-bottom-color:rgba(239,68,68,.18)!important}
      button{background:linear-gradient(135deg,#ef4444,#7f1d1d)!important;border-color:rgba(255,255,255,.18)!important;box-shadow:0 18px 50px rgba(0,0,0,.36)!important}
    </style>
  `;
  const filters = `
    <div style="position:fixed;right:16px;bottom:16px;z-index:9;display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;font-family:Arial,Helvetica,sans-serif">
      <button onclick="window.print()" style="background:linear-gradient(135deg,#ef4444,#7f1d1d);color:#fff;border:1px solid rgba(255,255,255,.22);border-radius:8px;padding:11px 13px;font-weight:900;box-shadow:0 18px 50px rgba(0,0,0,.36);cursor:pointer">Baixar PDF</button>
      <button onclick="navigator.clipboard.writeText(location.href)" style="background:rgba(21,21,24,.94);color:#F5F5F5;border:1px solid rgba(239,68,68,.45);border-radius:8px;padding:11px 13px;font-weight:900;box-shadow:0 18px 50px rgba(0,0,0,.28);cursor:pointer">Copiar link</button>
    </div>
    <div style="max-width:1220px;margin:16px auto 0;padding:0 16px;font-family:Arial,Helvetica,sans-serif">
      <div style="border:1px solid rgba(239,68,68,.28);background:linear-gradient(90deg,rgba(239,68,68,.14),rgba(21,21,24,.78));box-shadow:0 24px 80px rgba(0,0,0,.26);border-radius:8px;padding:12px 14px;color:#e5e7eb;backdrop-filter:blur(16px)">
        <strong style="color:#fff">Filtros web</strong>
        <span style="color:#fca5a5"> | ${escapeHtml(metaText)}</span>
      </div>
    </div>
  `;
  const withTheme = String(html || '').includes('</head>')
    ? String(html || '').replace('</head>', `${themeStyle}</head>`)
    : `${themeStyle}${String(html || '')}`;
  return withTheme.replace('<body>', `<body>${filters}`);
}

module.exports = {
  createPointTranscriptRecord,
  createDailyPointReportRecord,
  getPointTranscriptRecord,
  validateTranscriptAccess,
  registerTranscriptAccess,
  buildTranscriptShell,
  buildTranscriptUrl,
  buildDailyReportUrl,
  buildTranscriptFilePayload,
  normalizeTranscriptId,
  formatDate,
};
