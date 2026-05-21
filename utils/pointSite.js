const { getUserPoint, getEffectiveTotalMs, getPointDays, formatDate, formatDuration, formatLocalDay } = require('./pontoManager');
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
const DEFAULT_PUBLIC_BASE_URL = 'https://vortex.shardweb.app';

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
  return date.toISOString().slice(0, 7);
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

async function buildPointSitePayload({ client, guildId, userId }) {
  const point = await getUserPoint(guildId, userId);
  const profile = getUserProfile(guildId, userId);
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;
  const user = member?.user || await client.users.fetch(userId).catch(() => null);
  const sessions = buildSessions(point);
  const monthKey = getMonthKey();
  const monthSessions = sessions.filter((session) => String(session.startedAt || '').startsWith(monthKey));
  const activeMs = point.activePointStartedAt ? Math.max(0, Date.now() - new Date(point.activePointStartedAt).getTime()) : 0;
  const lastActivityAt = getLastActivityAt(point, profile);
  const offlineMs = lastActivityAt ? Math.max(0, Date.now() - new Date(lastActivityAt).getTime()) : 0;
  const weekdaySummary = buildWeekdaySummary(monthSessions);

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
      weekdays: weekdaySummary,
    },
    sessions: sessions.map((session) => ({
      ...session,
      startedAtDate: session.startedAt ? session.startedAt.slice(0, 10) : null,
    })),
    monthSessions,
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
    :root{--bg:#02050c;--panel:#07101f;--panel2:#0b1528;--line:#12356e;--text:#F5F5F5;--muted:#9fb5d8;--blue:#005DFF;--blue2:#0066FF;--green:#22c55e;--red:#ef4444;--yellow:#facc15}
    *{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 18% 0%,rgba(0,93,255,.34),transparent 28%),linear-gradient(135deg,#02050c,#05070d 58%,#00133a);color:var(--text);font-family:Inter,Arial,Helvetica,sans-serif;line-height:1.45}
    body:before{content:"";position:fixed;inset:0;opacity:.12;background-image:linear-gradient(45deg,rgba(255,255,255,.05) 25%,transparent 25%),linear-gradient(-45deg,rgba(255,255,255,.035) 25%,transparent 25%);background-size:18px 18px;pointer-events:none}
    .chain{position:fixed;color:rgba(0,102,255,.34);font-size:42px;text-shadow:0 0 24px var(--blue);z-index:0}.c1{top:16px;left:16px}.c2{top:16px;right:16px}.c3{bottom:16px;left:16px}.c4{bottom:16px;right:16px}
    .hero{min-height:290px;background:linear-gradient(90deg,rgba(2,5,12,.94),rgba(2,5,12,.66)),url("/assets/IMG_4234.png") center/cover no-repeat;border-bottom:1px solid rgba(0,102,255,.55);display:flex;align-items:flex-end;box-shadow:0 0 42px rgba(0,93,255,.22)}
    .wrap{width:min(1220px,calc(100% - 32px));margin:0 auto}.hero-inner{padding:30px 0 28px;display:grid;gap:18px}
    .brand{display:flex;align-items:center;justify-content:space-between;gap:18px}.brand-title{font-size:14px;letter-spacing:3px;text-transform:uppercase;color:var(--blue2);font-weight:900;text-shadow:0 0 16px var(--blue)}
    .brand-title i,.status i,.label i{margin-right:8px}
    h1{font-size:42px;margin:0;letter-spacing:0}.muted{color:var(--muted)}main{display:grid;gap:16px;padding:22px 0 38px}
    .status{border:1px solid rgba(0,102,255,.45);border-radius:8px;padding:9px 14px;font-weight:900;background:rgba(7,16,31,.82);box-shadow:0 0 22px rgba(0,93,255,.18)}
    .status.open{color:var(--green);border-color:rgba(34,197,94,.45)}.status.closed{color:var(--blue2);border-color:rgba(0,102,255,.55)}
    .profile,.card,section{background:linear-gradient(180deg,rgba(7,16,31,.92),rgba(5,10,20,.92));border:1px solid rgba(0,102,255,.35);border-radius:8px;box-shadow:0 14px 40px rgba(0,0,0,.28),0 0 24px rgba(0,93,255,.13)}
    .profile{display:grid;grid-template-columns:auto 1fr;gap:18px;padding:18px}.avatar{width:72px;height:72px;border-radius:8px;background:linear-gradient(135deg,var(--blue),#5bb4ff);object-fit:cover;display:grid;place-items:center;font-weight:900;box-shadow:0 0 20px rgba(0,93,255,.35)}
    .profile h2{margin:0;font-size:24px}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.card{padding:16px}.label{display:block;color:var(--muted);font-size:12px;text-transform:uppercase;font-weight:800}
    .weekday-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:10px}
    .weekday-card{background:var(--panel2);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:12px}
    .weekday-card strong{font-size:16px}
    strong{display:block;margin-top:4px;font-size:24px}.meta{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:12px}
    .meta div{background:var(--panel2);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:11px;overflow-wrap:anywhere}
    .toolbar{display:flex;gap:10px;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line);padding-right:16px}.toolbar h2{border-bottom:0}.pill{border:1px solid rgba(0,102,255,.5);color:var(--blue2);border-radius:999px;padding:6px 10px;font-size:12px;font-weight:900;box-shadow:0 0 14px rgba(0,93,255,.16)}
    section h2{font-size:18px;margin:0;padding:15px 16px;border-bottom:1px solid var(--line)}.table-scroll{overflow:auto}
    table{width:100%;min-width:920px;border-collapse:collapse}th,td{text-align:left;border-bottom:1px solid var(--line);padding:12px 13px;font-size:14px}
    th{color:var(--muted);font-size:12px;text-transform:uppercase}tbody tr:hover{background:rgba(112,0,255,.12)}.empty{padding:28px;text-align:center;color:var(--muted)}
    @media(max-width:1100px){.weekday-grid{grid-template-columns:repeat(4,minmax(0,1fr))}}
    @media(max-width:800px){.brand,.profile,.toolbar{grid-template-columns:1fr;display:grid}.grid,.meta,.weekday-grid{grid-template-columns:1fr 1fr}h1{font-size:34px}.hero{min-height:220px}}
    @media(max-width:620px){.grid,.meta,.weekday-grid{grid-template-columns:1fr}}
  </style>
</head>
<body>
  <div class="chain c1">⛓</div><div class="chain c2">⛓</div><div class="chain c3">⛓</div><div class="chain c4">⛓</div>
  <header class="hero"><div class="wrap hero-inner"><div class="brand"><div><div class="brand-title"><i class="fa-solid fa-shield-halved"></i> Vortex Management</div><h1><i class="fa-solid fa-chart-line"></i> Relatorio de pontos</h1><div class="muted" id="subtitle">Carregando...</div></div><div id="status" class="status"><i class="fa-solid fa-circle-notch fa-spin"></i> ...</div></div></div></header>
  <main class="wrap" id="app"><div class="empty">Carregando folha de ponto...</div></main>
  <script>
    const apiPath = ${JSON.stringify(safeApiPath)};
    const esc = (v) => String(v || 'N/A').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const fmt = (v) => esc(v || 'N/A');
    const cell = (v) => esc(v || 'N/A');
    function renderRows(rows) {
      if (!rows.length) return '<tr><td colspan="7" class="empty">Nenhum ponto registrado.</td></tr>';
      return rows.map((row) => '<tr><td>#' + row.index + '</td><td>' + cell(row.startedAtFormatted) + '</td><td>' + cell(row.closedAtFormatted) + '</td><td>' + cell(row.durationFormatted) + '</td><td>' + cell(row.status) + '</td><td>' + cell(row.origin) + '</td><td>' + cell(row.closedBy) + '</td></tr>').join('');
    }
    function renderPointData(data) {
      document.getElementById('subtitle').textContent = data.guild.name + ' | Gerado em ' + data.generatedAtFormatted;
      const status = document.getElementById('status');
      status.textContent = data.point.status;
      status.className = 'status ' + (data.point.status === 'ABERTO' ? 'open' : 'closed');
      const avatar = data.user.avatarUrl ? '<img class="avatar" src="' + esc(data.user.avatarUrl) + '" alt="">' : '<div class="avatar">' + esc(data.user.displayName.slice(0,2).toUpperCase()) + '</div>';
      document.getElementById('app').innerHTML =
        '<div class="profile">' + avatar + '<div><h2>' + esc(data.user.displayName) + '</h2><div class="muted"><i class="fa-solid fa-id-card"></i> ' + esc(data.user.tag) + ' | ' + esc(data.user.id) + '</div><div class="meta">' +
        '<div><span class="label"><i class="fa-solid fa-circle-check"></i> Cadastro</span>' + fmt(data.profile.status) + '</div><div><span class="label"><i class="fa-solid fa-user"></i> Nome em game</span>' + fmt(data.profile.nomeGame) + '</div><div><span class="label"><i class="fa-solid fa-hashtag"></i> ID em game</span>' + fmt(data.profile.idGame) + '</div>' +
        '<div><span class="label"><i class="fa-solid fa-list-ol"></i> Numero</span>' + fmt(data.profile.numeroGame) + '</div><div><span class="label"><i class="fa-solid fa-layer-group"></i> Nivel</span>' + fmt(data.profile.nivelGame) + '</div><div><span class="label"><i class="fa-solid fa-user-shield"></i> Cargo</span>' + fmt(data.user.highestRole) + '</div>' +
        '</div></div></div>' +
        '<div class="grid"><div class="card"><span class="label"><i class="fa-solid fa-clock"></i> Tempo total</span><strong>' + esc(data.point.totalFormatted) + '</strong></div><div class="card"><span class="label"><i class="fa-solid fa-calendar-check"></i> Dias com ponto</span><strong>' + esc(data.point.days) + '</strong></div><div class="card"><span class="label"><i class="fa-solid fa-calendar-days"></i> Pontos no mes</span><strong>' + esc(data.summary.month.total) + '</strong></div><div class="card"><span class="label"><i class="fa-solid fa-play"></i> Ponto atual</span><strong>' + esc(data.point.activeDurationFormatted) + '</strong></div><div class="card"><span class="label"><i class="fa-solid fa-fire"></i> Última atividade</span><strong>' + esc(data.point.lastActivityFormatted) + '</strong></div><div class="card"><span class="label"><i class="fa-solid fa-stopwatch"></i> Tempo sem logar</span><strong>' + esc(data.point.offlineDurationFormatted) + '</strong></div><div class="card"><span class="label"><i class="fa-solid fa-calendar-day"></i> Dia da última atividade</span><strong>' + esc(data.point.lastActivityDay) + '</strong></div><div class="card"><span class="label"><i class="fa-solid fa-circle-info"></i> Status do ponto</span><strong>' + esc(data.point.status) + '</strong></div></div>' +
        '<section><div class="toolbar"><h2>Dias da semana</h2><span class="pill">Resumo do período</span></div><div class="weekday-grid">' + data.summary.weekdays.map((item) => '<div class="weekday-card"><span class="label">' + esc(item.label) + '</span><strong>' + esc(String(item.count)) + ' ponto(s)</strong><div class="muted">' + esc(item.totalFormatted) + '</div></div>').join('') + '</div></section>' +
        '<section><div class="toolbar"><h2>Historico do mes</h2><span class="pill">' + esc(data.summary.month.totalFormatted) + '</span></div><div class="table-scroll"><table><thead><tr><th>#</th><th>Abertura</th><th>Fechamento</th><th>Duracao</th><th>Status</th><th>Origem</th><th>Responsavel</th></tr></thead><tbody>' + renderRows(data.monthSessions) + '</tbody></table></div></section>' +
        '<section><div class="toolbar"><h2>Todos os pontos</h2><span class="pill">' + esc(data.summary.all.totalFormatted) + '</span></div><div class="table-scroll"><table><thead><tr><th>#</th><th>Abertura</th><th>Fechamento</th><th>Duracao</th><th>Status</th><th>Origem</th><th>Responsavel</th></tr></thead><tbody>' + renderRows(data.sessions) + '</tbody></table></div></section>';
    }
    async function loadPointData() {
      try {
        const response = await fetch(apiPath, { cache: 'no-store' });
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
