const { getUserPoint, getEffectiveTotalMs, getPointDays, formatDate, formatDuration } = require('./pontoManager');
const { getUserProfile } = require('./profileManager');

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
      firstPointAtFormatted: formatDate(point.firstPointAt),
      lastPointOpenAtFormatted: formatDate(point.lastPointOpenAt),
      lastPointCloseAtFormatted: formatDate(point.lastPointCloseAt),
      totalFormatted: formatDuration(getEffectiveTotalMs(point)),
      days: getPointDays(point),
    },
    summary: {
      all: summarizeSessions(sessions),
      month: summarizeSessions(monthSessions),
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
  <title>Vortex | Folha de ponto</title>
  <style>
    :root{--bg:#0b0d12;--panel:#141922;--line:#263142;--text:#edf2f7;--muted:#98a6ba;--blue:#3b82f6;--green:#22c55e;--red:#ef4444;--yellow:#facc15}
    *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:Arial,Helvetica,sans-serif}
    header{border-bottom:1px solid var(--line);padding:26px 0;background:#10141c}.wrap{width:min(1180px,calc(100% - 32px));margin:0 auto}
    h1{margin:0;font-size:30px}.muted{color:var(--muted)}main{display:grid;gap:16px;padding:22px 0 36px}
    .top{display:flex;align-items:center;justify-content:space-between;gap:16px}.status{border:1px solid var(--line);border-radius:8px;padding:8px 12px;font-weight:700}
    .status.open{color:var(--green)}.status.closed{color:var(--blue)}
    .profile,.card,section{background:var(--panel);border:1px solid var(--line);border-radius:8px}.profile{display:grid;grid-template-columns:auto 1fr;gap:16px;padding:16px}
    .avatar{width:64px;height:64px;border-radius:8px;background:#1d4ed8;object-fit:cover;display:grid;place-items:center;font-weight:700}
    .grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.card{padding:14px}.label{display:block;color:var(--muted);font-size:12px;text-transform:uppercase}
    strong{display:block;margin-top:4px;font-size:22px}.meta{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:10px}
    .meta div{background:#10141c;border:1px solid var(--line);border-radius:8px;padding:10px;overflow-wrap:anywhere}
    section h2{font-size:18px;margin:0;padding:14px 16px;border-bottom:1px solid var(--line)}.table-scroll{overflow:auto}
    table{width:100%;min-width:900px;border-collapse:collapse}th,td{text-align:left;border-bottom:1px solid var(--line);padding:11px 12px;font-size:14px}
    th{color:var(--muted);font-size:12px;text-transform:uppercase}.empty{padding:26px;text-align:center;color:var(--muted)}
    @media(max-width:800px){.top,.profile{grid-template-columns:1fr}.grid,.meta{grid-template-columns:1fr}}
  </style>
</head>
<body>
  <header><div class="wrap top"><div><h1>Folha de ponto</h1><div class="muted" id="subtitle">Carregando...</div></div><div id="status" class="status">...</div></div></header>
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
    fetch(apiPath, { cache: 'no-store' }).then((r) => r.json()).then((data) => {
      if (!data.ok) throw new Error(data.error || 'Falha ao carregar');
      document.getElementById('subtitle').textContent = data.guild.name + ' | Gerado em ' + data.generatedAtFormatted;
      const status = document.getElementById('status');
      status.textContent = data.point.status;
      status.className = 'status ' + (data.point.status === 'ABERTO' ? 'open' : 'closed');
      const avatar = data.user.avatarUrl ? '<img class="avatar" src="' + esc(data.user.avatarUrl) + '" alt="">' : '<div class="avatar">' + esc(data.user.displayName.slice(0,2).toUpperCase()) + '</div>';
      document.getElementById('app').innerHTML =
        '<div class="profile">' + avatar + '<div><h2>' + esc(data.user.displayName) + '</h2><div class="muted">' + esc(data.user.tag) + ' | ' + esc(data.user.id) + '</div><div class="meta">' +
        '<div><span class="label">Cadastro</span>' + fmt(data.profile.status) + '</div><div><span class="label">Nome em game</span>' + fmt(data.profile.nomeGame) + '</div><div><span class="label">ID em game</span>' + fmt(data.profile.idGame) + '</div>' +
        '<div><span class="label">Numero</span>' + fmt(data.profile.numeroGame) + '</div><div><span class="label">Nivel</span>' + fmt(data.profile.nivelGame) + '</div><div><span class="label">Cargo</span>' + fmt(data.user.highestRole) + '</div>' +
        '</div></div></div>' +
        '<div class="grid"><div class="card"><span class="label">Tempo total</span><strong>' + esc(data.point.totalFormatted) + '</strong></div><div class="card"><span class="label">Dias com ponto</span><strong>' + esc(data.point.days) + '</strong></div><div class="card"><span class="label">Pontos no mes</span><strong>' + esc(data.summary.month.total) + '</strong></div><div class="card"><span class="label">Ponto atual</span><strong>' + esc(data.point.activeDurationFormatted) + '</strong></div></div>' +
        '<section><h2>Historico do mes</h2><div class="table-scroll"><table><thead><tr><th>#</th><th>Abertura</th><th>Fechamento</th><th>Duracao</th><th>Status</th><th>Origem</th><th>Responsavel</th></tr></thead><tbody>' + renderRows(data.monthSessions) + '</tbody></table></div></section>' +
        '<section><h2>Todos os pontos</h2><div class="table-scroll"><table><thead><tr><th>#</th><th>Abertura</th><th>Fechamento</th><th>Duracao</th><th>Status</th><th>Origem</th><th>Responsavel</th></tr></thead><tbody>' + renderRows(data.sessions) + '</tbody></table></div></section>';
    }).catch((error) => {
      document.getElementById('app').innerHTML = '<div class="empty">' + error.message + '</div>';
    });
  </script>
</body>
</html>`;
}

module.exports = {
  buildPointSiteHtml,
  buildPointSitePayload,
};
