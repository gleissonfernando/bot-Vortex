const {
  listGuildPoints,
  formatDuration,
  formatDate,
  formatLocalDate,
} = require('./pontoManager');

const TIME_ZONE = 'America/Sao_Paulo';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toValidDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getLocalDateKey(value = new Date()) {
  const date = toValidDate(value) || new Date();
  return date.toLocaleDateString('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

function getSessionDurationMs(session) {
  if (Number.isFinite(Number(session.durationMs))) return Number(session.durationMs);
  if (!session.startedAt || !session.closedAt) return 0;
  return Math.max(0, new Date(session.closedAt).getTime() - new Date(session.startedAt).getTime());
}

function isSessionInDay(session, dateKey) {
  const startedKey = session.startedAt ? getLocalDateKey(session.startedAt) : null;
  const closedKey = session.closedAt ? getLocalDateKey(session.closedAt) : null;
  return startedKey === dateKey || closedKey === dateKey;
}

function getActiveDurationForDay(data, dateKey) {
  if (!data.activePointStartedAt) return 0;
  if (getLocalDateKey(data.activePointStartedAt) !== dateKey) return 0;
  return Math.max(0, Date.now() - new Date(data.activePointStartedAt).getTime());
}

function normalizeRow(data, member, dateKey) {
  const sessions = Array.isArray(data.sessions) ? data.sessions.filter((session) => isSessionInDay(session, dateKey)) : [];
  const closedTotalMs = sessions.reduce((sum, session) => sum + getSessionDurationMs(session), 0);
  const activeMs = getActiveDurationForDay(data, dateKey);
  const activePointCount = activeMs > 0 ? 1 : 0;
  const totalMs = closedTotalMs + activeMs;
  const pointCount = sessions.length + activePointCount;

  return {
    userId: String(data.userId || member?.id || ''),
    name: member?.displayName || data.userName || `ID ${data.userId || member?.id || 'N/A'}`,
    tag: member?.user?.tag || member?.user?.username || data.userName || 'N/A',
    roleName: member?.roles?.highest?.name || 'N/A',
    avatarUrl: member?.user?.displayAvatarURL?.({ size: 128, extension: 'png' }) || null,
    status: data.activePointStartedAt ? 'Aberto' : 'Fechado',
    sessions,
    pointCount,
    totalMs,
    totalFormatted: formatDuration(totalMs),
    activeMs,
    activeFormatted: activeMs ? formatDuration(activeMs) : '0min',
    firstEntry: sessions[0]?.startedAt || data.activePointStartedAt || null,
    lastExit: sessions.slice().reverse().find((session) => session.closedAt)?.closedAt || data.lastPointCloseAt || null,
  };
}

async function buildDailyPointReportData(guild, { dateKey = getLocalDateKey(), includeAllMembers = true, includeOnlyActive = true } = {}) {
  const points = await listGuildPoints(guild.id);
  const pointByUserId = new Map(points.map((data) => [String(data.userId), data]));
  let members = new Map();

  if (includeAllMembers) {
    const fetched = await guild.members.fetch().catch(() => guild.members.cache);
    members = fetched instanceof Map ? fetched : new Map(fetched.map((member) => [member.id, member]));
  } else {
    for (const data of points) {
      const member = await guild.members.fetch(data.userId).catch(() => null);
      if (member) members.set(member.id, member);
    }
  }

  const userIds = includeAllMembers
    ? Array.from(members.keys())
    : Array.from(pointByUserId.keys());

  const allRows = userIds
    .map((userId) => {
      const member = members.get(userId) || null;
      if (member?.user?.bot) return null;
      const data = pointByUserId.get(userId) || {
        userId,
        userName: member?.displayName || member?.user?.username || `ID ${userId}`,
        sessions: [],
        totalMs: 0,
      };
      return normalizeRow(data, member, dateKey);
    })
    .filter(Boolean)
    .sort((a, b) => b.totalMs - a.totalMs || a.name.localeCompare(b.name));

  const activeRows = allRows.filter((row) => row.totalMs > 0 || row.pointCount > 0);
  const rows = includeOnlyActive ? activeRows : allRows;
  const totalMs = activeRows.reduce((sum, row) => sum + row.totalMs, 0);
  const totalPoints = activeRows.reduce((sum, row) => sum + row.pointCount, 0);
  const topUser = activeRows[0] || null;
  const averageMs = activeRows.length ? Math.round(totalMs / activeRows.length) : 0;

  return {
    generatedAt: new Date(),
    guild: {
      id: guild.id,
      name: guild.name,
      iconUrl: guild.iconURL?.({ size: 128, extension: 'png' }) || null,
    },
    dateKey,
    dateLabel: formatLocalDate(`${dateKey}T12:00:00.000Z`),
    rows,
    summary: {
      totalRegisteredUsers: allRows.length,
      listedUsers: rows.length,
      activeUsers: activeRows.length,
      totalPoints,
      totalMs,
      totalFormatted: formatDuration(totalMs),
      averageMs,
      averageFormatted: formatDuration(averageMs),
      topUserName: topUser?.name || 'N/A',
      topUserId: topUser?.userId || null,
      topUserTotal: topUser?.totalFormatted || '0min',
    },
  };
}

function renderRows(rows) {
  if (!rows.length) {
    return '<tr><td colspan="7" class="empty-cell">Nenhum usuario encontrado.</td></tr>';
  }

  return rows.map((row, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>
        <div class="user-cell">
          <div class="avatar-sm">${row.avatarUrl ? `<img src="${escapeHtml(row.avatarUrl)}" alt="">` : escapeHtml(row.name.slice(0, 2).toUpperCase())}</div>
          <div>
            <strong>${escapeHtml(row.name)}</strong>
            <span>${escapeHtml(row.tag)}</span>
          </div>
        </div>
      </td>
      <td>${escapeHtml(row.userId)}</td>
      <td>${escapeHtml(row.roleName)}</td>
      <td><span class="badge ${row.status === 'Aberto' ? 'live' : ''}">${escapeHtml(row.status)}</span></td>
      <td>${escapeHtml(String(row.pointCount))}</td>
      <td><strong>${escapeHtml(row.totalFormatted)}</strong></td>
    </tr>
  `).join('');
}

function createDailyPointReportHtml(report) {
  const topUser = report.summary.topUserId
    ? `${report.summary.topUserName} (${report.summary.topUserTotal})`
    : 'N/A';

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Vortex | Relatorio diario</title>
  <style>
    :root{--bg:#08080a;--panel:rgba(21,21,24,.72);--panel2:rgba(35,35,39,.78);--line:rgba(239,68,68,.26);--line2:rgba(255,255,255,.08);--text:#f8fafc;--muted:#a7a7ad;--accent:#ef4444;--accent2:#f87171;--danger:#dc2626;--good:#22c55e;--shadow:0 24px 80px rgba(0,0,0,.42)}
    *{box-sizing:border-box}
    body{margin:0;min-height:100vh;background:radial-gradient(circle at 14% -8%,rgba(239,68,68,.24),transparent 34%),radial-gradient(circle at 92% 0,rgba(120,113,108,.22),transparent 28%),linear-gradient(180deg,#050506,#101012 48%,#070708);color:var(--text);font-family:Inter,Segoe UI,Arial,sans-serif;line-height:1.45}
    body:before{content:"";position:fixed;inset:0;pointer-events:none;background:linear-gradient(rgba(255,255,255,.032) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.026) 1px,transparent 1px);background-size:38px 38px;mask-image:linear-gradient(#000,transparent 78%);opacity:.5}
    .wrap{width:min(1180px,calc(100% - 32px));margin:0 auto}
    header{padding:34px 0 24px;border-bottom:1px solid var(--line);background:linear-gradient(135deg,rgba(10,10,12,.92),rgba(127,29,29,.32));backdrop-filter:blur(18px)}
    .brand{font-size:12px;text-transform:uppercase;letter-spacing:2px;color:var(--accent2);font-weight:800}
    h1{margin:8px 0 6px;font-size:38px;line-height:1.05}
    .muted{color:var(--muted)}
    main{padding:20px 0 42px;display:grid;gap:16px}
    .grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px}
    .card,.panel{background:linear-gradient(180deg,var(--panel),rgba(12,12,14,.86));border:1px solid var(--line);border-radius:8px;box-shadow:var(--shadow);backdrop-filter:blur(18px)}
    .card{padding:14px}
    .card span{display:block;font-size:11px;text-transform:uppercase;font-weight:800;color:var(--muted)}
    .card strong{display:block;margin-top:6px;font-size:18px;overflow-wrap:anywhere}
    .panel{overflow:hidden}
    .panel-head{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:16px;border-bottom:1px solid var(--line2)}
    .panel-head h2{margin:0;font-size:18px}
    .pill,.badge{display:inline-flex;align-items:center;border:1px solid var(--line);background:rgba(239,68,68,.12);border-radius:999px;padding:7px 10px;color:#fecaca;font-size:12px;font-weight:800}
    .badge{padding:5px 9px;color:#e5e7eb;background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.1)}
    .badge.live{color:#bbf7d0;border-color:rgba(34,197,94,.32);background:rgba(34,197,94,.12)}
    .table-wrap{overflow:auto}
    table{width:100%;border-collapse:collapse;min-width:860px}
    th,td{padding:12px 14px;border-bottom:1px solid var(--line2);text-align:left;vertical-align:middle}
    th{font-size:11px;text-transform:uppercase;color:#fca5a5;background:rgba(239,68,68,.08)}
    td{color:#e5e7eb}
    .user-cell{display:flex;align-items:center;gap:10px}
    .user-cell span{display:block;color:var(--muted);font-size:12px;margin-top:2px}
    .avatar-sm{width:36px;height:36px;border-radius:8px;display:grid;place-items:center;background:linear-gradient(135deg,#ef4444,#3f3f46);font-weight:900;overflow:hidden}
    .avatar-sm img{width:100%;height:100%;object-fit:cover}
    .empty-cell{text-align:center;color:var(--muted);padding:24px}
    @media(max-width:900px){.grid{grid-template-columns:1fr 1fr}h1{font-size:30px}}
    @media(max-width:560px){.grid{grid-template-columns:1fr}.panel-head{display:grid}}
  </style>
</head>
<body>
  <header>
    <div class="wrap">
      <div class="brand">Vortex — Relatorio Diario</div>
      <h1>Resumo completo de ponto</h1>
      <div class="muted">${escapeHtml(report.guild.name)} | Data: ${escapeHtml(report.dateLabel)} | Gerado em ${escapeHtml(formatDate(report.generatedAt))}</div>
    </div>
  </header>
  <main class="wrap">
    <section class="grid">
      <div class="card"><span>Pessoas no relatorio</span><strong>${escapeHtml(String(report.summary.listedUsers))}</strong></div>
      <div class="card"><span>Pessoas que logaram no dia</span><strong>${escapeHtml(String(report.summary.activeUsers))}</strong></div>
      <div class="card"><span>Total de pontos criados</span><strong>${escapeHtml(String(report.summary.totalPoints))}</strong></div>
      <div class="card"><span>Tempo total registrado</span><strong>${escapeHtml(report.summary.totalFormatted)}</strong></div>
      <div class="card"><span>Media por usuario</span><strong>${escapeHtml(report.summary.averageFormatted)}</strong></div>
    </section>
    <section class="panel">
      <div class="panel-head">
        <h2>Usuario mais ativo</h2>
        <span class="pill">${escapeHtml(topUser)}</span>
      </div>
    </section>
    <section class="panel">
      <div class="panel-head">
        <h2>Ranking diario de quem logou</h2>
        <span class="pill">${escapeHtml(String(report.rows.length))} usuarios com ponto no dia</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Usuario</th>
              <th>ID Discord</th>
              <th>Cargo</th>
              <th>Status</th>
              <th>Pontos</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>${renderRows(report.rows)}</tbody>
        </table>
      </div>
    </section>
  </main>
</body>
</html>`;
}

module.exports = {
  buildDailyPointReportData,
  createDailyPointReportHtml,
  getLocalDateKey,
};
