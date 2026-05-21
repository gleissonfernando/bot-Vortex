const { getUserPoint, getEffectiveTotalMs, getPointDays, formatDate, formatDuration, formatLocalDay, POINT_TIME_ZONE } = require('./pontoManager');
const { getUserProfile } = require('./profileManager');

const WEEKDAY_LABELS = [
  { key: 'segunda-feira', label: 'Segunda' },
  { key: 'terca-feira', label: 'Terça' },
  { key: 'quarta-feira', label: 'Quarta' },
  { key: 'quinta-feira', label: 'Quinta' },
  { key: 'sexta-feira', label: 'Sexta' },
  { key: 'sabado', label: 'Sábado' },
  { key: 'domingo', label: 'Domingo' },
];
const DEFAULT_PUBLIC_BASE_URL = 'https://bot-vortex.shardweb.app';
const LOCAL_DATE_PARTS_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: POINT_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const MONTH_LABEL_FORMATTER = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'UTC',
  month: 'long',
  year: 'numeric',
});

function pad2(value) {
  return String(value).padStart(2, '0');
}

function toValidDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function capitalize(value) {
  const text = String(value || '');
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function getLocalDateParts(value = new Date()) {
  const date = toValidDate(value);
  if (!date) return null;
  const parts = LOCAL_DATE_PARTS_FORMATTER.formatToParts(date)
    .reduce((acc, part) => {
      if (part.type !== 'literal') acc[part.type] = part.value;
      return acc;
    }, {});

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
  };
}

function getLocalDateKey(value) {
  const parts = getLocalDateParts(value);
  if (!parts) return null;
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

function getLocalMonthKey(value = new Date()) {
  const parts = getLocalDateParts(value);
  if (!parts) return null;
  return `${parts.year}-${pad2(parts.month)}`;
}

function getCurrentMonthKey() {
  return getLocalMonthKey(new Date()) || new Date().toISOString().slice(0, 7);
}

function formatMonthLabel(monthKey) {
  const match = String(monthKey || '').match(/^(\d{4})-(\d{2})$/);
  if (!match) return 'Mes invalido';
  const year = Number(match[1]);
  const month = Number(match[2]);
  return capitalize(MONTH_LABEL_FORMATTER.format(new Date(Date.UTC(year, month - 1, 1))));
}

function normalizeMonthKey(value, fallback = getCurrentMonthKey()) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{4})-(\d{2})$/);
  if (!match) return fallback;
  const month = Number(match[2]);
  return month >= 1 && month <= 12 ? `${match[1]}-${match[2]}` : fallback;
}

function getIsoWeekKey(value) {
  const parts = getLocalDateParts(value);
  if (!parts) return null;
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const dayNumber = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNumber);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNumber = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${pad2(weekNumber)}`;
}

function normalizeWeekKey(value) {
  const match = String(value || '').trim().match(/^(\d{4})-W(\d{1,2})$/i);
  if (!match) return null;
  const week = Number(match[2]);
  if (week < 1 || week > 53) return null;
  return `${match[1]}-W${pad2(week)}`;
}

function getWeekStartDate(weekKey) {
  const match = String(weekKey || '').match(/^(\d{4})-W(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const week = Number(match[2]);
  const simple = new Date(Date.UTC(year, 0, 1 + (week - 1) * 7));
  const dayOfWeek = simple.getUTCDay() || 7;
  const monday = new Date(simple);
  if (dayOfWeek <= 4) monday.setUTCDate(simple.getUTCDate() - dayOfWeek + 1);
  else monday.setUTCDate(simple.getUTCDate() + 8 - dayOfWeek);
  return monday;
}

function getWeekMonthKey(weekKey) {
  const monday = getWeekStartDate(weekKey);
  if (!monday) return null;
  return `${monday.getUTCFullYear()}-${pad2(monday.getUTCMonth() + 1)}`;
}

function formatUtcShortDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return 'N/A';
  return `${pad2(date.getUTCDate())}/${pad2(date.getUTCMonth() + 1)}`;
}

function formatWeekLabel(weekKey) {
  const monday = getWeekStartDate(weekKey);
  if (!monday) return 'Semana invalida';
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return `Semana ${formatUtcShortDate(monday)} ate ${formatUtcShortDate(sunday)}`;
}

function buildPointSiteUrl(guildId, userId) {
  const configuredBaseUrl = process.env.POINT_SITE_BASE_URL || process.env.APP_URL || process.env.PUBLIC_BASE_URL || process.env.SITE_URL || DEFAULT_PUBLIC_BASE_URL;
  const baseUrl = String(configuredBaseUrl).trim().replace(/\/+$/, '') || DEFAULT_PUBLIC_BASE_URL;
  const url = new URL(`/relatorio/ponto/${userId}`, baseUrl);
  url.searchParams.set('guildId', guildId);
  if (process.env.POINT_SITE_TOKEN) url.searchParams.set('token', process.env.POINT_SITE_TOKEN);
  return url.toString();
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

function getSessionSource(session) {
  if (session.source === 'fivem_metropole_auto') return 'FiveM automatico';
  if (session.adjusted || session.corrected) return 'Ajuste manual';
  return session.source || 'Ponto manual';
}

function normalizeSession(session, index) {
  const startedAt = getSessionStartedAt(session);
  const closedAt = getSessionClosedAt(session);
  const durationMs = getSessionDurationMs(session);
  const source = getSessionSource(session);
  return {
    index: index + 1,
    startedAt,
    startedAtFormatted: formatDate(startedAt),
    closedAt,
    closedAtFormatted: closedAt ? formatDate(closedAt) : 'Em andamento',
    durationMs,
    durationFormatted: formatDuration(durationMs),
    status: closedAt ? 'FECHADO' : 'ABERTO',
    source,
    serverName: session.serverName || null,
    origin: [source, session.serverName].filter(Boolean).join(' - ') || 'N/A',
    closedBy: session.closedBy || session.fechadoPor || session.adjustedBy || session.correctedBy || 'Sistema',
    corrected: Boolean(session.corrected || session.adjusted),
    reason: session.reason || null,
  };
}

function buildSessions(point) {
  const closed = Array.isArray(point.sessions) ? point.sessions.map(normalizeSession) : [];
  const active = point.activePointStartedAt
    ? [normalizeSession({
        startedAt: point.activePointStartedAt,
        closedAt: null,
        durationMs: Math.max(0, Date.now() - new Date(point.activePointStartedAt).getTime()),
        source: point.activePointSource,
        serverName: point.activePointServerName,
        reason: point.activePointReason,
      }, closed.length)]
    : [];

  return [...closed, ...active].sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
}

function getMonthKey(date = new Date()) {
  return getLocalMonthKey(date) || date.toISOString().slice(0, 7);
}

function summarizeSessions(sessions) {
  const totalMs = sessions.reduce((sum, session) => sum + Number(session.durationMs || 0), 0);
  const closed = sessions.filter((session) => session.closedAt);
  const open = sessions.filter((session) => !session.closedAt);
  return {
    total: sessions.length,
    closed: closed.length,
    open: open.length,
    totalMs,
    totalFormatted: formatDuration(totalMs),
    averageFormatted: formatDuration(sessions.length ? totalMs / sessions.length : 0),
  };
}

function enrichSession(session) {
  return {
    ...session,
    startedAtDate: getLocalDateKey(session.startedAt),
    monthKey: getLocalMonthKey(session.startedAt),
    weekKey: getIsoWeekKey(session.startedAt),
  };
}

function buildPeriodOptions(sessions) {
  const monthMap = new Map();
  const weekMap = new Map();

  for (const session of sessions) {
    const monthKey = session.monthKey;
    const weekKey = session.weekKey;
    const durationMs = Number(session.durationMs || 0);

    if (monthKey) {
      const month = monthMap.get(monthKey) || { key: monthKey, total: 0, totalMs: 0 };
      month.total += 1;
      month.totalMs += durationMs;
      monthMap.set(monthKey, month);
    }

    if (weekKey) {
      const week = weekMap.get(weekKey) || {
        key: weekKey,
        monthKey: monthKey || getWeekMonthKey(weekKey),
        total: 0,
        totalMs: 0,
      };
      week.total += 1;
      week.totalMs += durationMs;
      if (!week.monthKey && monthKey) week.monthKey = monthKey;
      weekMap.set(weekKey, week);
    }
  }

  return {
    months: Array.from(monthMap.values())
      .sort((a, b) => b.key.localeCompare(a.key))
      .map((month) => ({
        ...month,
        label: formatMonthLabel(month.key),
        totalFormatted: formatDuration(month.totalMs),
      })),
    weeks: Array.from(weekMap.values())
      .sort((a, b) => b.key.localeCompare(a.key))
      .map((week) => ({
        ...week,
        monthKey: week.monthKey || getWeekMonthKey(week.key),
        label: formatWeekLabel(week.key),
        totalFormatted: formatDuration(week.totalMs),
      })),
  };
}

function ensureSelectedMonthOption(months, monthKey) {
  if (months.some((month) => month.key === monthKey)) return months;
  return [{
    key: monthKey,
    label: formatMonthLabel(monthKey),
    total: 0,
    totalMs: 0,
    totalFormatted: '0min',
  }, ...months];
}

function ensureSelectedWeekOption(weeks, weekKey) {
  if (!weekKey || weeks.some((week) => week.key === weekKey)) return weeks;
  return [{
    key: weekKey,
    monthKey: getWeekMonthKey(weekKey),
    label: formatWeekLabel(weekKey),
    total: 0,
    totalMs: 0,
    totalFormatted: '0min',
  }, ...weeks];
}

function getLastActivityAt(point, profile) {
  return point.lastPointCloseAt
    || point.lastPointOpenAt
    || point.firstPointAt
    || profile?.lastProfileUpdateAt
    || profile?.approvedAt
    || point.updatedAt
    || null;
}

function buildWeekdaySummary(sessions) {
  const groups = new Map(WEEKDAY_LABELS.map(({ key, label }) => [key, { key, label, count: 0, totalMs: 0, totalFormatted: '0min' }]));

  for (const session of sessions) {
    if (!session.startedAt) continue;
    const weekday = formatLocalDay(session.startedAt).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const group = groups.get(weekday);
    if (!group) continue;
    group.count += 1;
    group.totalMs += Number(session.durationMs || 0);
  }

  return Array.from(groups.values()).map((group) => ({
    ...group,
    totalFormatted: formatDuration(group.totalMs),
  }));
}

async function buildPointSitePayload({ client, guildId, userId, month, week }) {
  const point = await getUserPoint(guildId, userId);
  const profile = getUserProfile(guildId, userId);
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;
  const user = member?.user || await client.users.fetch(userId).catch(() => null);
  const sessions = buildSessions(point).map(enrichSession);
  const requestedWeekKey = normalizeWeekKey(week);
  const fallbackMonthKey = requestedWeekKey ? getWeekMonthKey(requestedWeekKey) || getCurrentMonthKey() : getCurrentMonthKey();
  const monthKey = normalizeMonthKey(month, fallbackMonthKey);
  const monthSessions = sessions.filter((session) => session.monthKey === monthKey);
  const weekSessions = requestedWeekKey
    ? sessions.filter((session) => session.weekKey === requestedWeekKey)
    : [];
  const selectedSessions = requestedWeekKey ? weekSessions : monthSessions;
  const activeMs = point.activePointStartedAt ? Math.max(0, Date.now() - new Date(point.activePointStartedAt).getTime()) : 0;
  const lastActivityAt = getLastActivityAt(point, profile);
  const offlineMs = lastActivityAt ? Math.max(0, Date.now() - new Date(lastActivityAt).getTime()) : 0;
  const weekdaySummary = buildWeekdaySummary(selectedSessions);
  const periodOptions = buildPeriodOptions(sessions);
  const availableMonths = ensureSelectedMonthOption(periodOptions.months, monthKey);
  const availableWeeks = ensureSelectedWeekOption(periodOptions.weeks, requestedWeekKey);
  const selectedSummary = summarizeSessions(selectedSessions);

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    generatedAtFormatted: formatDate(new Date()),
    guild: {
      id: guildId,
      name: guild?.name || 'Vortex',
      iconUrl: guild?.iconURL?.({ dynamic: true, size: 128 }) || null,
    },
    user: {
      id: userId,
      tag: user?.tag || profile?.discordTag || userId,
      username: user?.username || profile?.displayName || point.userName || userId,
      displayName: member?.displayName || profile?.displayName || point.userName || user?.username || userId,
      avatarUrl: user?.displayAvatarURL?.({ dynamic: true, size: 256 }) || profile?.avatarUrl || null,
      joinedAt: member?.joinedAt?.toISOString?.() || null,
      joinedAtFormatted: member?.joinedAt ? formatDate(member.joinedAt) : 'N/A',
      highestRole: member?.roles?.highest?.name || 'N/A',
    },
    profile: profile ? {
      status: profile.registeredManually ? 'Cadastro manual' : 'Aprovado no /set',
      nomeGame: profile.nomeGame || null,
      idGame: profile.idGame || null,
      numeroGame: profile.numeroGame || null,
      nivelGame: profile.nivelGame || null,
      callChannelId: profile.callChannelId || null,
      lastProfileUpdateAt: profile.lastProfileUpdateAt || null,
      lastProfileUpdateFormatted: profile.lastProfileUpdateAt ? formatDate(profile.lastProfileUpdateAt) : 'N/A',
    } : {
      status: 'Sem cadastro no /set',
    },
    point: {
      status: point.activePointStartedAt ? 'ABERTO' : 'FECHADO',
      activePointStartedAt: point.activePointStartedAt || null,
      activeDurationFormatted: point.activePointStartedAt ? formatDuration(activeMs) : 'N/A',
      lastActivityAt,
      lastActivityFormatted: lastActivityAt ? formatDate(lastActivityAt) : 'N/A',
      offlineDurationFormatted: lastActivityAt ? formatDuration(offlineMs) : 'N/A',
      lastActivityDay: lastActivityAt ? formatLocalDay(lastActivityAt) : 'N/A',
      firstPointAtFormatted: formatDate(point.firstPointAt),
      lastPointOpenAtFormatted: formatDate(point.lastPointOpenAt),
      lastPointCloseAtFormatted: formatDate(point.lastPointCloseAt),
      totalFormatted: formatDuration(getEffectiveTotalMs(point)),
      days: getPointDays(point),
    },
    summary: {
      all: summarizeSessions(sessions),
      month: summarizeSessions(monthSessions),
      week: summarizeSessions(weekSessions),
      selected: selectedSummary,
      weekdays: weekdaySummary,
    },
    filters: {
      monthKey,
      monthLabel: formatMonthLabel(monthKey),
      weekKey: requestedWeekKey,
      weekLabel: requestedWeekKey ? formatWeekLabel(requestedWeekKey) : null,
      periodLabel: requestedWeekKey ? formatWeekLabel(requestedWeekKey) : formatMonthLabel(monthKey),
      availableMonths,
      availableWeeks,
    },
    sessions,
    monthSessions,
    weekSessions,
    selectedSessions,
  };
}

function buildPointSiteHtml({ userId, apiPath }) {
  const safeUserId = String(userId).replace(/[^0-9]/g, '');
  const safeApiPath = String(apiPath || `/api/ponto/${safeUserId}`).replace(/</g, '%3C');
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Vortex | Relatorio de Pontos</title>
  <link rel="stylesheet" href="/vendor/fontawesome/css/all.min.css">
  <style>
    :root{--bg:#030712;--panel:#07111f;--panel2:#0b1728;--panel3:#0f2038;--line:rgba(76,145,255,.24);--line2:rgba(255,255,255,.08);--text:#f8fafc;--muted:#9db2d3;--blue:#0b6bff;--blue2:#4aa3ff;--green:#22c55e;--red:#ef4444;--yellow:#facc15;--shadow:0 22px 70px rgba(0,0,0,.36)}
    *{box-sizing:border-box}
    html{scroll-behavior:smooth}
    body{margin:0;min-height:100vh;background:linear-gradient(180deg,#020617,#061121 46%,#030712);color:var(--text);font-family:Inter,Segoe UI,Arial,Helvetica,sans-serif;line-height:1.45}
    body:before{content:"";position:fixed;inset:0;pointer-events:none;background:linear-gradient(rgba(255,255,255,.03) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.022) 1px,transparent 1px);background-size:36px 36px;opacity:.48;mask-image:linear-gradient(#000,transparent 82%)}
    .wrap{width:min(1220px,calc(100% - 32px));margin:0 auto}
    .topbar{position:sticky;top:0;z-index:5;border-bottom:1px solid var(--line);background:linear-gradient(135deg,rgba(3,7,18,.96),rgba(7,17,31,.94)),url("/assets/IMG_4234.png") center/cover no-repeat;box-shadow:var(--shadow);backdrop-filter:blur(18px)}
    .topbar-inner{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 0}
    .brand{display:flex;align-items:center;gap:12px;min-width:0}
    .brand-mark{width:42px;height:42px;border-radius:8px;display:grid;place-items:center;background:linear-gradient(135deg,#0b6bff,#003a94);font-weight:900;box-shadow:0 0 28px rgba(11,107,255,.34)}
    h1{margin:0;font-size:23px;line-height:1.08;letter-spacing:0}
    h2{margin:0;font-size:17px;line-height:1.2}
    .muted{color:var(--muted)}
    .nav-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
    button,.nav-link{height:40px;border-radius:8px;border:1px solid rgba(255,255,255,.12);display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:0 12px;color:var(--text);font:inherit;font-weight:800;text-decoration:none;cursor:pointer;background:rgba(255,255,255,.06)}
    button.primary,.nav-link.primary{background:linear-gradient(135deg,#0b6bff,#0047b8);border-color:rgba(92,167,255,.45);box-shadow:0 10px 28px rgba(11,107,255,.18)}
    button:disabled{opacity:.65;cursor:wait}
    main{position:relative;display:grid;gap:14px;padding:18px 0 38px}
    .profile,.filters,.tabs,.card,.panel{background:linear-gradient(180deg,rgba(7,17,31,.92),rgba(4,9,18,.94));border:1px solid var(--line);border-radius:8px;box-shadow:var(--shadow)}
    .profile{display:grid;grid-template-columns:auto 1fr auto;gap:16px;padding:16px;align-items:center}
    .avatar{width:76px;height:76px;border-radius:8px;background:linear-gradient(135deg,var(--blue),#6cb6ff);object-fit:cover;display:grid;place-items:center;font-weight:900;font-size:22px;box-shadow:0 0 24px rgba(11,107,255,.28)}
    .profile h2{font-size:24px;margin-bottom:4px}
    .status{min-width:118px;border:1px solid rgba(76,145,255,.36);border-radius:8px;padding:9px 12px;text-align:center;font-weight:900;background:rgba(11,23,40,.9)}
    .status.open{color:var(--green);border-color:rgba(34,197,94,.42)}
    .status.closed{color:var(--blue2)}
    .meta{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:12px}
    .meta div,.filter-field{background:var(--panel2);border:1px solid var(--line2);border-radius:8px;padding:11px;overflow-wrap:anywhere}
    .label{display:block;color:var(--muted);font-size:11px;text-transform:uppercase;font-weight:900;margin-bottom:5px}
    .label i,.status i,.pill i{margin-right:7px}
    .filters{display:grid;grid-template-columns:1fr 1fr auto;gap:10px;padding:12px;align-items:end}
    .filter-field{padding:9px}
    select{width:100%;height:38px;border-radius:8px;border:1px solid rgba(255,255,255,.1);background:#07111f;color:var(--text);font:inherit;outline:none;padding:0 10px}
    select option{background:#07111f;color:#fff}
    .tabs{display:flex;gap:8px;padding:8px;overflow:auto}
    .tabs a{white-space:nowrap;border:1px solid rgba(76,145,255,.28);border-radius:8px;color:#dbeafe;text-decoration:none;padding:8px 11px;font-weight:800;background:rgba(11,107,255,.08)}
    .grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
    .card{padding:15px;min-height:96px}
    strong{display:block;margin-top:4px;font-size:23px;overflow-wrap:anywhere}
    .panel{overflow:hidden}
    .panel-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;border-bottom:1px solid var(--line2)}
    .pill{border:1px solid rgba(76,145,255,.36);color:#bfdbfe;background:rgba(11,107,255,.1);border-radius:999px;padding:6px 10px;font-size:12px;font-weight:900;white-space:nowrap}
    .weekday-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:10px;padding:14px}
    .weekday-card{background:var(--panel2);border:1px solid var(--line2);border-radius:8px;padding:12px}
    .weekday-card strong{font-size:16px}
    .table-scroll{overflow:auto}
    table{width:100%;min-width:960px;border-collapse:collapse}
    th,td{text-align:left;border-bottom:1px solid var(--line2);padding:12px 13px;font-size:14px;vertical-align:middle}
    th{color:#93c5fd;font-size:11px;text-transform:uppercase;background:rgba(11,107,255,.08)}
    tbody tr:hover{background:rgba(11,107,255,.08)}
    .empty{padding:28px;text-align:center;color:var(--muted)}
    @media(max-width:1100px){.grid{grid-template-columns:repeat(3,minmax(0,1fr))}.weekday-grid{grid-template-columns:repeat(4,minmax(0,1fr))}}
    @media(max-width:840px){.topbar-inner,.profile,.filters{grid-template-columns:1fr;display:grid}.nav-actions{justify-content:flex-start}.grid,.meta,.weekday-grid{grid-template-columns:1fr 1fr}.profile{align-items:start}h1{font-size:21px}}
    @media(max-width:620px){.grid,.meta,.weekday-grid{grid-template-columns:1fr}.panel-head{display:grid}.tabs{padding-bottom:10px}}
  </style>
</head>
<body>
  <header class="topbar">
    <div class="wrap topbar-inner">
      <div class="brand">
        <div class="brand-mark">V</div>
        <div>
          <h1>Relatorio de pontos</h1>
          <div class="muted" id="subtitle">Carregando...</div>
        </div>
      </div>
      <div class="nav-actions">
        <button type="button" id="backButton"><i class="fa-solid fa-arrow-left"></i> Voltar</button>
        <a class="nav-link primary" href="/transcripts"><i class="fa-solid fa-table-list"></i> Arquivo</a>
      </div>
    </div>
  </header>
  <main class="wrap" id="app"><div class="empty">Carregando folha de ponto...</div></main>
  <script>
    const apiPath = ${JSON.stringify(safeApiPath)};
    let selectedMonth = new URLSearchParams(location.search).get('month') || '';
    let selectedWeek = new URLSearchParams(location.search).get('week') || '';
    const esc = (v) => String(v ?? 'N/A').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const fmt = (v) => esc(v || 'N/A');
    const cell = (v) => esc(v || 'N/A');
    document.getElementById('backButton').addEventListener('click', () => {
      if (history.length > 1) history.back();
      else location.href = '/transcripts';
    });
    function buildApiUrl() {
      const url = new URL(apiPath, location.origin);
      if (selectedMonth) url.searchParams.set('month', selectedMonth);
      else url.searchParams.delete('month');
      if (selectedWeek) url.searchParams.set('week', selectedWeek);
      else url.searchParams.delete('week');
      return url;
    }
    function updateBrowserUrl() {
      const url = new URL(location.href);
      if (selectedMonth) url.searchParams.set('month', selectedMonth);
      else url.searchParams.delete('month');
      if (selectedWeek) url.searchParams.set('week', selectedWeek);
      else url.searchParams.delete('week');
      history.replaceState(null, '', url.toString());
    }
    function renderMonthOptions(filters) {
      return (filters.availableMonths || []).map((item) => '<option value="' + esc(item.key) + '"' + (item.key === filters.monthKey ? ' selected' : '') + '>' + esc(item.label) + ' - ' + esc(item.total) + ' ponto(s)</option>').join('');
    }
    function renderWeekOptions(filters) {
      const weeks = (filters.availableWeeks || []).filter((item) => !filters.monthKey || item.monthKey === filters.monthKey || item.key === filters.weekKey);
      return '<option value=""' + (!filters.weekKey ? ' selected' : '') + '>Mes inteiro</option>' + weeks.map((item) => '<option value="' + esc(item.key) + '"' + (item.key === filters.weekKey ? ' selected' : '') + '>' + esc(item.label) + ' - ' + esc(item.total) + ' ponto(s)</option>').join('');
    }
    function renderRows(rows) {
      if (!rows.length) return '<tr><td colspan="8" class="empty">Nenhum ponto registrado.</td></tr>';
      return rows.map((row) => '<tr><td>#' + row.index + '</td><td>' + cell(row.startedAtFormatted) + '</td><td>' + cell(row.closedAtFormatted) + '</td><td>' + cell(row.durationFormatted) + '</td><td>' + cell(row.status) + '</td><td>' + cell(row.origin) + '</td><td>' + cell(row.closedBy) + '</td><td>' + cell(row.weekKey) + '</td></tr>').join('');
    }
    function bindFilters() {
      const monthFilter = document.getElementById('monthFilter');
      const weekFilter = document.getElementById('weekFilter');
      const refreshButton = document.getElementById('refreshButton');
      monthFilter.addEventListener('change', () => {
        selectedMonth = monthFilter.value;
        selectedWeek = '';
        updateBrowserUrl();
        loadPointData();
      });
      weekFilter.addEventListener('change', () => {
        selectedWeek = weekFilter.value;
        updateBrowserUrl();
        loadPointData();
      });
      refreshButton.addEventListener('click', () => loadPointData());
    }
    function renderPointData(data) {
      const filters = data.filters || {};
      selectedMonth = filters.monthKey || selectedMonth;
      selectedWeek = filters.weekKey || '';
      document.getElementById('subtitle').textContent = data.guild.name + ' | ' + (filters.periodLabel || 'Periodo atual') + ' | ' + data.generatedAtFormatted;
      const initials = String(data.user.displayName || data.user.username || 'VX').slice(0, 2).toUpperCase();
      const avatar = data.user.avatarUrl ? '<img class="avatar" src="' + esc(data.user.avatarUrl) + '" alt="">' : '<div class="avatar">' + esc(initials) + '</div>';
      const statusClass = data.point.status === 'ABERTO' ? 'open' : 'closed';
      document.getElementById('app').innerHTML =
        '<section class="profile" id="perfil">' + avatar + '<div><h2>' + esc(data.user.displayName) + '</h2><div class="muted"><i class="fa-solid fa-id-card"></i> ' + esc(data.user.tag) + ' | ' + esc(data.user.id) + '</div><div class="meta">' +
        '<div><span class="label"><i class="fa-solid fa-circle-check"></i> Cadastro</span>' + fmt(data.profile.status) + '</div><div><span class="label"><i class="fa-solid fa-user"></i> Nome em game</span>' + fmt(data.profile.nomeGame) + '</div><div><span class="label"><i class="fa-solid fa-hashtag"></i> ID em game</span>' + fmt(data.profile.idGame) + '</div>' +
        '<div><span class="label"><i class="fa-solid fa-list-ol"></i> Numero</span>' + fmt(data.profile.numeroGame) + '</div><div><span class="label"><i class="fa-solid fa-layer-group"></i> Nivel</span>' + fmt(data.profile.nivelGame) + '</div><div><span class="label"><i class="fa-solid fa-user-shield"></i> Cargo</span>' + fmt(data.user.highestRole) + '</div>' +
        '</div></div><div class="status ' + statusClass + '"><i class="fa-solid ' + (statusClass === 'open' ? 'fa-circle-play' : 'fa-circle-check') + '"></i>' + esc(data.point.status) + '</div></section>' +
        '<section class="filters" id="filtros"><div class="filter-field"><span class="label"><i class="fa-solid fa-calendar-days"></i> Mes</span><select id="monthFilter">' + renderMonthOptions(filters) + '</select></div><div class="filter-field"><span class="label"><i class="fa-solid fa-calendar-week"></i> Semana</span><select id="weekFilter">' + renderWeekOptions(filters) + '</select></div><button class="primary" type="button" id="refreshButton"><i class="fa-solid fa-rotate"></i> Atualizar</button></section>' +
        '<nav class="tabs" aria-label="Abas do relatorio"><a href="#resumo"><i class="fa-solid fa-chart-simple"></i> Resumo</a><a href="#semana"><i class="fa-solid fa-calendar-week"></i> Semana</a><a href="#periodo"><i class="fa-solid fa-table"></i> Periodo</a><a href="#historico"><i class="fa-solid fa-clock-rotate-left"></i> Historico</a></nav>' +
        '<section class="grid" id="resumo"><div class="card"><span class="label"><i class="fa-solid fa-clock"></i> Tempo no periodo</span><strong>' + esc(data.summary.selected.totalFormatted) + '</strong></div><div class="card"><span class="label"><i class="fa-solid fa-calendar-check"></i> Pontos no periodo</span><strong>' + esc(data.summary.selected.total) + '</strong></div><div class="card"><span class="label"><i class="fa-solid fa-chart-line"></i> Media do periodo</span><strong>' + esc(data.summary.selected.averageFormatted) + '</strong></div><div class="card"><span class="label"><i class="fa-solid fa-play"></i> Ponto atual</span><strong>' + esc(data.point.activeDurationFormatted) + '</strong></div><div class="card"><span class="label"><i class="fa-solid fa-database"></i> Tempo total</span><strong>' + esc(data.point.totalFormatted) + '</strong></div><div class="card"><span class="label"><i class="fa-solid fa-calendar-day"></i> Dias com ponto</span><strong>' + esc(data.point.days) + '</strong></div><div class="card"><span class="label"><i class="fa-solid fa-fire"></i> Ultima atividade</span><strong>' + esc(data.point.lastActivityFormatted) + '</strong></div><div class="card"><span class="label"><i class="fa-solid fa-stopwatch"></i> Tempo sem logar</span><strong>' + esc(data.point.offlineDurationFormatted) + '</strong></div></section>' +
        '<section class="panel" id="semana"><div class="panel-head"><h2>Dias da semana</h2><span class="pill"><i class="fa-solid fa-layer-group"></i>' + esc(filters.periodLabel || 'Periodo') + '</span></div><div class="weekday-grid">' + data.summary.weekdays.map((item) => '<div class="weekday-card"><span class="label">' + esc(item.label) + '</span><strong>' + esc(String(item.count)) + ' ponto(s)</strong><div class="muted">' + esc(item.totalFormatted) + '</div></div>').join('') + '</div></section>' +
        '<section class="panel" id="periodo"><div class="panel-head"><h2>Pontos do periodo</h2><span class="pill"><i class="fa-solid fa-stopwatch"></i>' + esc(data.summary.selected.totalFormatted) + '</span></div><div class="table-scroll"><table><thead><tr><th>#</th><th>Abertura</th><th>Fechamento</th><th>Duracao</th><th>Status</th><th>Origem</th><th>Responsavel</th><th>Semana</th></tr></thead><tbody>' + renderRows(data.selectedSessions || []) + '</tbody></table></div></section>' +
        '<section class="panel" id="historico"><div class="panel-head"><h2>Todos os pontos</h2><span class="pill"><i class="fa-solid fa-database"></i>' + esc(data.summary.all.totalFormatted) + '</span></div><div class="table-scroll"><table><thead><tr><th>#</th><th>Abertura</th><th>Fechamento</th><th>Duracao</th><th>Status</th><th>Origem</th><th>Responsavel</th><th>Semana</th></tr></thead><tbody>' + renderRows(data.sessions || []) + '</tbody></table></div></section>';
      bindFilters();
    }
    async function loadPointData() {
      try {
        const response = await fetch(buildApiUrl().toString(), { cache: 'no-store' });
        const data = await response.json().catch(() => ({ ok: false, error: 'Resposta invalida da API' }));
        if (!response.ok) throw new Error(data.error || 'API retornou erro ' + response.status);
        if (!data.ok) throw new Error(data.error || 'Falha ao carregar');
        renderPointData(data);
      } catch (error) {
        document.getElementById('app').innerHTML = '<div class="empty">Nao foi possivel carregar os dados do ponto: ' + esc(error.message) + '</div>';
      }
    }
    loadPointData();
    setInterval(loadPointData, 15000);
  </script>
</body>
</html>`;
}

module.exports = {
  buildPointSiteUrl,
  buildPointSiteHtml,
  buildPointSitePayload,
};
