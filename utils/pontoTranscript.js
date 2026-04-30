const { AttachmentBuilder } = require('discord.js');
const { formatDuration, formatDate, getEffectiveTotalMs } = require('./pontoManager');
const { getUserProfile } = require('./profileManager');

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getMonthKey(date = new Date()) {
  return date.toISOString().slice(0, 7);
}

function getMonthLabel(monthKey) {
  const [year, month] = String(monthKey).split('-').map(Number);
  if (!year || !month) return monthKey;
  return new Date(year, month - 1, 1).toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric',
  });
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

function mapSession(session) {
  const startedAt = getSessionStartedAt(session);
  const closedAt = getSessionClosedAt(session);
  const durationMs = getSessionDurationMs(session);

  return {
    ticketId: session.ticketId || session.ticket || null,
    startedAt,
    closedAt,
    durationMs,
    closedBy: session.closedBy || session.fechadoPor || session.adjustedBy || session.correctedBy || 'Sistema',
    status: closedAt ? 'FECHADO' : 'ABERTO',
    corrected: Boolean(session.corrected || session.adjusted),
    source: getSessionSource(session),
    serverName: session.serverName || null,
    reason: session.reason || null,
    activityName: session.activityName || null,
    activityDetails: session.activityDetails || null,
    activityState: session.activityState || null,
  };
}

function normalizeSessions(sessions) {
  return sessions
    .filter((session) => session.startedAt)
    .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime())
    .map((session, index) => ({
      ...session,
      index: index + 1,
      ticketId: session.ticketId || `PONTO-${String(index + 1).padStart(3, '0')}`,
    }));
}

function getAllSessions(data) {
  const sessions = Array.isArray(data.sessions) ? data.sessions : [];
  const closedSessions = sessions.map(mapSession);

  const activeSession = data.activePointStartedAt
    ? [{
        ticketId: null,
        startedAt: data.activePointStartedAt,
        closedAt: null,
        durationMs: Math.max(0, Date.now() - new Date(data.activePointStartedAt).getTime()),
        closedBy: 'Em andamento',
        status: 'ABERTO',
        corrected: false,
        source: data.activePointSource === 'fivem_metropole_auto' ? 'FiveM automatico' : 'Ponto manual',
        serverName: data.activePointServerName || null,
        reason: data.activePointReason || null,
        activityName: data.activePointActivityName || null,
        activityDetails: data.activePointActivityDetails || null,
        activityState: data.activePointActivityState || null,
      }]
    : [];

  return normalizeSessions([...closedSessions, ...activeSession]);
}

function getMonthlySessions(data, monthKey) {
  return normalizeSessions(getAllSessions(data)
    .filter((session) => String(session.startedAt || '').startsWith(monthKey)));
}

function getMonthlySummary(sessions) {
  const closed = sessions.filter((session) => session.closedAt);
  const open = sessions.filter((session) => !session.closedAt);
  const totalMs = sessions.reduce((sum, session) => sum + session.durationMs, 0);
  const averageMs = sessions.length ? totalMs / sessions.length : 0;
  const smallestMs = sessions.length ? Math.min(...sessions.map((session) => session.durationMs)) : 0;

  return {
    totalPoints: sessions.length,
    closedPoints: closed.length,
    openPoints: open.length,
    totalMs,
    averageMs,
    smallestMs,
  };
}

function getPointDaysFromSessions(sessions) {
  return new Set(sessions.filter((session) => session.startedAt).map((session) => session.startedAt.slice(0, 10))).size;
}

function buildHistoryRows(sessions) {
  if (!sessions.length) {
    return '<tr><td colspan="8" class="empty">Nenhum ponto registrado neste mês. A folha deste usuário está zerada.</td></tr>';
  }

  return sessions.map((session) => `
    <tr>
      <td>#${session.index}</td>
      <td>${escapeHtml(formatDate(session.startedAt))}</td>
      <td>${escapeHtml(session.closedAt ? formatDate(session.closedAt) : 'Em andamento')}</td>
      <td>${escapeHtml(formatDuration(session.durationMs))}</td>
      <td>${escapeHtml(session.ticketId)}</td>
      <td>${escapeHtml(session.closedBy)}</td>
      <td>${escapeHtml([session.source, session.serverName].filter(Boolean).join(' - ') || 'N/A')}</td>
      <td><span class="badge ${session.status === 'ABERTO' ? 'open' : 'closed'}">${escapeHtml(session.status)}</span>${session.corrected ? '<span class="tag">corrigido</span>' : ''}${session.source === 'FiveM automatico' ? '<span class="tag">FiveM</span>' : ''}</td>
    </tr>
  `).join('');
}

function buildFrequentLoginRows(sessions) {
  const rows = sessions
    .filter((session) => session.startedAt)
    .map((session) => ({
      day: new Date(session.startedAt).toLocaleDateString('pt-BR', { weekday: 'long' }),
      date: new Date(session.startedAt).toLocaleDateString('pt-BR'),
      startedAt: session.startedAt,
      closedAt: session.closedAt,
      durationMs: session.durationMs,
      source: session.source,
      serverName: session.serverName,
    }));

  if (!rows.length) {
    return '<tr><td colspan="6" class="empty">Nenhum login registrado neste mes.</td></tr>';
  }

  return rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.day.charAt(0).toUpperCase() + row.day.slice(1))}</td>
      <td>${escapeHtml(row.date)}</td>
      <td>${escapeHtml(formatDate(row.startedAt))}</td>
      <td>${escapeHtml(row.closedAt ? formatDate(row.closedAt) : 'Em andamento')}</td>
      <td>${escapeHtml(formatDuration(row.durationMs))}</td>
      <td>${escapeHtml([row.source, row.serverName].filter(Boolean).join(' - ') || 'N/A')}</td>
    </tr>
  `).join('');
}

function buildTimelineRows({ data, sessions, generatedAt }) {
  const lastSession = sessions[sessions.length - 1] || null;
  const rows = [];

  if (data.firstPointAt) rows.push(['Primeiro ponto registrado', formatDate(data.firstPointAt)]);
  if (data.lastPointOpenAt) rows.push(['Última abertura', formatDate(data.lastPointOpenAt)]);
  if (lastSession?.closedAt) rows.push(['Ultimo fechamento', formatDate(lastSession.closedAt)]);
  if (lastSession?.closedBy) rows.push(['Responsavel pelo ultimo fechamento', lastSession.closedBy]);
  rows.push(['Transcript gerado', formatDate(generatedAt)]);

  if (!rows.length) {
    rows.push(['Status', 'Nenhum evento de ponto encontrado para este usuário.']);
  }

  return rows.map(([label, value]) => `
    <div class="timeline-item">
      <strong>${escapeHtml(label)}</strong>
      <span>${escapeHtml(value)}</span>
    </div>
  `).join('');
}

function formatProfileStatus(profile) {
  if (!profile?.approvedAt) return 'Sem cadastro no /set';
  return profile.registeredManually ? 'Cadastro manual' : 'Aprovado no /set';
}

function getInitials(name) {
  const parts = String(name || 'Vortex').trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'VX';
}

function createPointTranscriptHtml({ guild, target, member, data }) {
  const generatedAt = new Date();
  const monthKey = getMonthKey(generatedAt);
  const monthLabel = getMonthLabel(monthKey);
  const profile = getUserProfile(guild.id, target.id);
  const allSessions = getAllSessions(data);
  const sessions = getMonthlySessions(data, monthKey);
  const summary = getMonthlySummary(sessions);
  const allSummary = getMonthlySummary(allSessions);
  const userName = member?.displayName || data.userName || target.username;
  const roleName = member?.roles?.highest?.name || data.role || 'Membro';
  const activeMs = data.activePointStartedAt
    ? Math.max(0, generatedAt.getTime() - new Date(data.activePointStartedAt).getTime())
    : 0;
  const status = data.activePointStartedAt ? 'ABERTO' : 'FECHADO';
  const lastSession = sessions[sessions.length - 1] || null;
  const ticketLabel = lastSession?.ticketId || 'Folha do Mes';
  const effectiveTotalMs = getEffectiveTotalMs(data);
  const totalDays = getPointDaysFromSessions(allSessions);

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Folha de Ponto Vortex - ${escapeHtml(userName)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Rajdhani:wght@400;600;700&family=Share+Tech+Mono&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0a0a0f;
      --panel: #10131d;
      --panel-2: #141a27;
      --line: rgba(59, 130, 246, 0.32);
      --line-soft: rgba(232, 234, 240, 0.10);
      --text: #e8eaf0;
      --muted: #9ca8bd;
      --blue: #3b82f6;
      --blue-dark: #1d4ed8;
      --green: #22c55e;
      --red: #ef4444;
      --yellow: #facc15;
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: 'Rajdhani', Arial, sans-serif;
      font-size: 16px;
      line-height: 1.45;
    }

    header {
      border-bottom: 1px solid var(--line);
      background: #0d111a;
      padding: 28px;
    }

    .wrap {
      width: min(1180px, calc(100% - 32px));
      margin: 0 auto;
    }

    .brand {
      display: flex;
      justify-content: space-between;
      gap: 18px;
      align-items: center;
      margin-bottom: 22px;
    }

    .logo {
      font-family: 'Bebas Neue', Impact, sans-serif;
      font-size: 56px;
      line-height: 0.9;
      color: var(--text);
      text-shadow: 0 0 0 var(--blue), 3px 3px 0 var(--blue-dark);
      letter-spacing: 0;
    }

    .status {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 10px 14px;
      font-family: 'Share Tech Mono', monospace;
      color: ${status === 'ABERTO' ? 'var(--green)' : 'var(--blue)'};
      background: rgba(59, 130, 246, 0.08);
    }

    h1, h2 {
      font-family: 'Bebas Neue', Impact, sans-serif;
      letter-spacing: 0;
      margin: 0;
    }

    h1 { font-size: 42px; }
    h2 { font-size: 26px; padding: 16px 18px; border-bottom: 1px solid var(--line-soft); }

    .subtitle {
      color: var(--muted);
      margin: 6px 0 0;
      font-family: 'Share Tech Mono', monospace;
      font-size: 13px;
    }

    main {
      display: grid;
      gap: 18px;
      padding: 24px 0 36px;
    }

    .profile, section, .card, .notice {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
    }

    .profile {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 16px;
      padding: 18px;
      align-items: center;
    }

    .avatar {
      width: 58px;
      height: 58px;
      border-radius: 8px;
      border: 1px solid var(--line);
      display: grid;
      place-items: center;
      background: var(--blue-dark);
      font-family: 'Bebas Neue', Impact, sans-serif;
      font-size: 28px;
    }

    .meta {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
      margin-top: 10px;
    }

    .meta div, .card {
      padding: 14px;
      background: var(--panel-2);
      border: 1px solid var(--line-soft);
      border-radius: 8px;
    }

    .label {
      display: block;
      color: var(--muted);
      text-transform: uppercase;
      font-size: 12px;
      font-weight: 700;
    }

    .value, code {
      font-family: 'Share Tech Mono', monospace;
      color: var(--text);
      overflow-wrap: anywhere;
    }

    .cards {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
    }

    .card strong {
      display: block;
      margin-top: 6px;
      font-size: 24px;
      font-family: 'Share Tech Mono', monospace;
    }

    .notice {
      padding: 14px 18px;
      border-color: ${profile?.approvedAt ? 'rgba(34, 197, 94, 0.35)' : 'rgba(239, 68, 68, 0.45)'};
      background: ${profile?.approvedAt ? 'rgba(34, 197, 94, 0.07)' : 'rgba(239, 68, 68, 0.08)'};
      color: var(--text);
    }

    section { overflow: hidden; }
    .table-scroll { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; min-width: 980px; }
    th, td { padding: 12px 14px; border-bottom: 1px solid var(--line-soft); text-align: left; }
    th { color: var(--muted); font-size: 12px; text-transform: uppercase; }
    td { font-family: 'Share Tech Mono', monospace; font-size: 13px; }
    tr:last-child td { border-bottom: 0; }

    .badge, .tag {
      display: inline-block;
      border-radius: 6px;
      padding: 3px 8px;
      font-size: 12px;
      margin-right: 6px;
    }

    .badge.open { color: var(--green); border: 1px solid rgba(34, 197, 94, 0.45); }
    .badge.closed { color: var(--blue); border: 1px solid var(--line); }
    .tag { color: var(--yellow); border: 1px solid rgba(250, 204, 21, 0.38); }
    .empty { color: var(--muted); text-align: center; padding: 26px; }

    .timeline {
      padding: 16px 18px;
      display: grid;
      gap: 10px;
    }

    .timeline-item {
      border-left: 2px solid var(--blue);
      padding-left: 12px;
      display: grid;
      gap: 2px;
    }

    .timeline-item span {
      color: var(--muted);
      font-family: 'Share Tech Mono', monospace;
      font-size: 13px;
    }

    footer {
      color: var(--muted);
      text-align: center;
      padding: 18px 0 30px;
      font-size: 13px;
      font-family: 'Share Tech Mono', monospace;
    }

    @media (max-width: 820px) {
      header { padding: 22px 0; }
      .brand { align-items: flex-start; flex-direction: column; }
      .logo { font-size: 44px; }
      .profile, .meta, .cards { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <header>
    <div class="wrap">
      <div class="brand">
        <div class="logo">VORTEX</div>
        <div class="status">${escapeHtml(status)}</div>
      </div>
      <h1>Folha de Ponto</h1>
      <p class="subtitle">Ticket: ${escapeHtml(ticketLabel)} | Mes: ${escapeHtml(monthLabel)} | Documento confidencial</p>
    </div>
  </header>

  <main class="wrap">
    <div class="profile">
      <div class="avatar">${escapeHtml(getInitials(userName))}</div>
      <div>
        <h2>Dados do Usuario</h2>
        <div class="meta">
          <div><span class="label">Nome Discord</span><span class="value">${escapeHtml(userName)}</span></div>
          <div><span class="label">ID Discord</span><span class="value">${escapeHtml(target.id)}</span></div>
          <div><span class="label">Cargo/Role</span><span class="value">${escapeHtml(roleName)}</span></div>
          <div><span class="label">Cadastro</span><span class="value">${escapeHtml(formatProfileStatus(profile))}</span></div>
          <div><span class="label">Nome em game</span><span class="value">${escapeHtml(profile?.nomeGame || data.userName || 'N/A')}</span></div>
          <div><span class="label">ID em game</span><span class="value">${escapeHtml(profile?.idGame || data.registro || 'N/A')}</span></div>
          <div><span class="label">Numero</span><span class="value">${escapeHtml(profile?.numeroGame || 'N/A')}</span></div>
          <div><span class="label">Nivel</span><span class="value">${escapeHtml(profile?.nivelGame || 'N/A')}</span></div>
          <div><span class="label">Call/Canal</span><span class="value">${profile?.callChannelId ? `#${escapeHtml(profile.callChannelId)}` : 'N/A'}</span></div>
          <div><span class="label">Mes de referencia</span><span class="value">${escapeHtml(monthLabel)}</span></div>
          <div><span class="label">Ultimo ponto</span><span class="value">${escapeHtml(formatDate(data.lastPointCloseAt || data.lastPointOpenAt))}</span></div>
          <div><span class="label">Quem fechou ultimo</span><span class="value">${escapeHtml(lastSession?.closedBy || 'N/A')}</span></div>
        </div>
      </div>
    </div>

    <div class="notice">
      <strong>Status do cadastro:</strong> ${escapeHtml(formatProfileStatus(profile))}
      ${profile?.lastProfileUpdateAt ? ` | Ultima atualizacao do perfil: ${escapeHtml(formatDate(profile.lastProfileUpdateAt))}` : ''}
    </div>

    <div class="cards">
      <div class="card"><span class="label">Total geral</span><strong>${escapeHtml(allSummary.totalPoints)}</strong></div>
      <div class="card"><span class="label">Tempo geral</span><strong>${escapeHtml(formatDuration(effectiveTotalMs))}</strong></div>
      <div class="card"><span class="label">Dias com ponto</span><strong>${escapeHtml(totalDays)}</strong></div>
      <div class="card"><span class="label">Status atual</span><strong>${escapeHtml(status)}</strong></div>
    </div>

    <div class="cards">
      <div class="card"><span class="label">Pontos no mes</span><strong>${escapeHtml(summary.totalPoints)}</strong></div>
      <div class="card"><span class="label">Fechados no mes</span><strong>${escapeHtml(summary.closedPoints)}</strong></div>
      <div class="card"><span class="label">Tempo no mes</span><strong>${escapeHtml(formatDuration(summary.totalMs))}</strong></div>
      <div class="card"><span class="label">Media do mes</span><strong>${escapeHtml(formatDuration(summary.averageMs))}</strong></div>
    </div>

    <section>
      <h2>Historico do Mes</h2>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Abertura</th>
              <th>Fechamento</th>
              <th>Duração</th>
              <th>Ticket</th>
              <th>Responsavel</th>
              <th>Origem</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>${buildHistoryRows(sessions)}</tbody>
        </table>
      </div>
    </section>

    <section>
      <h2>Logins Frequentes</h2>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Dia da semana</th>
              <th>Data</th>
              <th>Entrada</th>
              <th>Saida</th>
              <th>Tempo online</th>
              <th>Origem</th>
            </tr>
          </thead>
          <tbody>${buildFrequentLoginRows(sessions)}</tbody>
        </table>
      </div>
    </section>

    <section>
      <h2>Linha do Tempo</h2>
      <div class="timeline">
        ${buildTimelineRows({ data, sessions, generatedAt })}
        ${data.activePointStartedAt ? `
          <div class="timeline-item">
            <strong>Ponto em andamento</strong>
            <span>Aberto ha ${escapeHtml(formatDuration(activeMs))}</span>
          </div>
        ` : ''}
      </div>
    </section>

    <section>
      <h2>Transcricao do Chat</h2>
      <div class="timeline">
        <div class="timeline-item">
          <strong>Sistema</strong>
          <span>Este transcript foi gerado a partir dos registros salvos em JSON. Mensagens completas de ticket ficam disponiveis quando forem salvas junto ao ponto.</span>
        </div>
      </div>
    </section>
  </main>

  <footer>Gerado automaticamente pelo sistema de ponto | VORTEX | Documento confidencial</footer>
</body>
</html>`;
}

function createPointTranscriptAttachment({ guild, target, member, data }) {
  const html = createPointTranscriptHtml({ guild, target, member, data });
  const timestamp = new Date().toISOString().replace(/:/g, '-');

  return new AttachmentBuilder(Buffer.from(html, 'utf8'), {
    name: `${target.id}_${timestamp}_ticket.html`,
  });
}

module.exports = {
  createPointTranscriptAttachment,
  createPointTranscriptHtml,
};
