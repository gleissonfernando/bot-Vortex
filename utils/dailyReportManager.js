const fs = require('fs');
const path = require('path');
const { AttachmentBuilder, EmbedBuilder } = require('discord.js');
const {
  listGuildPoints,
  formatDuration,
  formatDate,
  POINT_TIME_ZONE,
} = require('./pontoManager');
const { AUTO_POINT_SOURCE, TARGET_SERVER_NAME } = require('./fivemActivityAlertManager');
const { logger } = require('./logger');
const { isPrimaryGuild, isPrimaryGuildChannel } = require('./guildScope');

const CONFIG_PATH = path.join(__dirname, '..', 'commands', 'config.json');
const STATE_PATH = path.join(__dirname, '..', 'commands', 'dailyReportState.json');
const DEFAULT_REPORT_HOUR = 23;
const DEFAULT_REPORT_MINUTE = 59;

let interval = null;

function readJSON(filePath, fallback = {}) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8') || '{}');
  } catch {
    return fallback;
  }
}

function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function readConfig() {
  return readJSON(CONFIG_PATH, {});
}

function saveConfig(config) {
  writeJSON(CONFIG_PATH, config);
}

function ensureDailyReportConfig(config = readConfig()) {
  if (!config.DAILY_REPORT || typeof config.DAILY_REPORT !== 'object') {
    config.DAILY_REPORT = {};
  }

  config.DAILY_REPORT.reportChannelId = String(config.DAILY_REPORT.reportChannelId || '').trim();
  config.DAILY_REPORT.logChannelId = String(config.DAILY_REPORT.logChannelId || '').trim();
  config.DAILY_REPORT.staffChannelId = String(config.DAILY_REPORT.staffChannelId || '').trim();
  config.DAILY_REPORT.testChannelId = String(config.DAILY_REPORT.testChannelId || '').trim();
  config.DAILY_REPORT.hour = Number.isInteger(config.DAILY_REPORT.hour) ? config.DAILY_REPORT.hour : DEFAULT_REPORT_HOUR;
  config.DAILY_REPORT.minute = Number.isInteger(config.DAILY_REPORT.minute) ? config.DAILY_REPORT.minute : DEFAULT_REPORT_MINUTE;
  config.DAILY_REPORT.enabled = config.DAILY_REPORT.enabled !== false;

  return config;
}

function getDailyReportConfig(config = readConfig()) {
  return ensureDailyReportConfig(config).DAILY_REPORT;
}

function setDailyReportChannel(type, channelId) {
  const allowed = ['reportChannelId', 'logChannelId', 'staffChannelId', 'testChannelId'];
  if (!allowed.includes(type)) throw new Error(`Canal de relatorio invalido: ${type}`);
  const config = ensureDailyReportConfig(readConfig());
  config.DAILY_REPORT[type] = String(channelId || '').trim();
  saveConfig(config);
  return config.DAILY_REPORT;
}

function getLocalParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: POINT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date).reduce((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value;
    return acc;
  }, {});

  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function localDateKey(value) {
  if (!value) return '';
  return getLocalParts(new Date(value)).dateKey;
}

function getWeekStartKey(date = new Date()) {
  const local = new Date(date.toLocaleString('en-US', { timeZone: POINT_TIME_ZONE }));
  const day = local.getDay();
  const diff = day === 0 ? 6 : day - 1;
  local.setDate(local.getDate() - diff);
  local.setHours(0, 0, 0, 0);
  return getLocalParts(local).dateKey;
}

function isAutoCitySession(session) {
  return session?.source === AUTO_POINT_SOURCE || String(session?.serverName || '').includes('Metr');
}

function sessionOverlapsDate(session, dateKey) {
  return localDateKey(session.startedAt) === dateKey || localDateKey(session.closedAt) === dateKey;
}

function getSessionMs(session) {
  if (Number.isFinite(Number(session.durationMs))) return Number(session.durationMs);
  if (!session.startedAt || !session.closedAt) return 0;
  return Math.max(0, new Date(session.closedAt).getTime() - new Date(session.startedAt).getTime());
}

function getStatus(data) {
  if (data.activePointStartedAt && data.activePointSource === AUTO_POINT_SOURCE) return 'Em cidade';
  if (data.activePointStartedAt) return 'Online';
  return 'Saiu da cidade';
}

async function buildDailyReportData(guild, { dateKey = getLocalParts().dateKey, mode = 'daily' } = {}) {
  const points = await listGuildPoints(guild.id);
  const members = await guild.members.fetch().catch(() => guild.members.cache);
  const weekStartKey = getWeekStartKey(new Date(`${dateKey}T12:00:00`));

  const rows = points.map((data) => {
    const member = members.get(String(data.userId));
    const sessions = Array.isArray(data.sessions) ? data.sessions.filter(isAutoCitySession) : [];
    const daySessions = sessions.filter((session) => sessionOverlapsDate(session, dateKey));
    const weekSessions = sessions.filter((session) => localDateKey(session.startedAt) >= weekStartKey && localDateKey(session.startedAt) <= dateKey);
    const activeMs = data.activePointStartedAt && localDateKey(data.activePointStartedAt) === dateKey
      ? Math.max(0, Date.now() - new Date(data.activePointStartedAt).getTime())
      : 0;
    const dayMs = daySessions.reduce((sum, session) => sum + getSessionMs(session), 0) + activeMs;
    const weekMs = weekSessions.reduce((sum, session) => sum + getSessionMs(session), 0) + activeMs;
    const activeDays = new Set(weekSessions.map((session) => localDateKey(session.startedAt)).filter(Boolean));
    if (activeMs > 0) activeDays.add(dateKey);

    return {
      userId: String(data.userId),
      mention: `<@${data.userId}>`,
      avatarURL: member?.user?.displayAvatarURL?.({ dynamic: true, size: 128 }) || null,
      name: member?.displayName || data.userName || `ID ${data.userId}`,
      rpId: data.registro || data.idRegistro || data.userId,
      steamHex: data.steamHex || data.steam || 'Nao informado',
      status: getStatus(data),
      lastLogin: data.lastPointOpenAt || data.activePointStartedAt || null,
      totalDayMs: dayMs,
      totalWeekMs: weekMs,
      connections: daySessions.length + (activeMs > 0 ? 1 : 0),
      activeDays: activeDays.size,
      sessions: daySessions,
      activeStartedAt: data.activePointStartedAt || null,
    };
  }).filter((row) => mode === 'weekly' ? row.totalWeekMs > 0 : (row.totalDayMs > 0 || row.connections > 0));

  rows.sort((a, b) => (mode === 'weekly' ? b.totalWeekMs - a.totalWeekMs : b.totalDayMs - a.totalDayMs));

  const totals = {
    users: rows.length,
    online: rows.filter((row) => row.status === 'Em cidade' || row.status === 'Online').length,
    connections: rows.reduce((sum, row) => sum + row.connections, 0),
    totalMs: rows.reduce((sum, row) => sum + (mode === 'weekly' ? row.totalWeekMs : row.totalDayMs), 0),
  };

  return {
    guildId: guild.id,
    guildName: guild.name,
    serverName: TARGET_SERVER_NAME,
    generatedAt: new Date().toISOString(),
    dateKey,
    weekStartKey,
    mode,
    rows,
    totals,
    ranking: rows.slice(0, 10),
  };
}

function activityLabel(ms) {
  if (ms >= 4 * 60 * 60 * 1000) return 'Muito ativo';
  if (ms >= 2 * 60 * 60 * 1000) return 'Ativo';
  if (ms > 0) return 'Pouco ativo';
  return 'Sem atividade';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function buildDailyReportHtml(report) {
  const top = report.ranking[0];
  const rowsHtml = report.rows.map((row, index) => `
    <section class="player-card">
      <div class="rank">#${index + 1}</div>
      <img class="avatar" src="${escapeHtml(row.avatarURL || '')}" alt="">
      <div class="player-main">
        <h2>${escapeHtml(row.name)}</h2>
        <p>${escapeHtml(row.mention)} • ID ${escapeHtml(row.rpId)} • ${escapeHtml(row.steamHex)}</p>
        <div class="chips">
          <span>${escapeHtml(row.status)}</span>
          <span>${escapeHtml(formatDuration(row.totalDayMs))} hoje</span>
          <span>${escapeHtml(row.connections)} conexoes</span>
          <span>${escapeHtml(row.activeDays)} dias ativos</span>
        </div>
      </div>
      <div class="metric">
        <strong>${escapeHtml(formatDuration(row.totalWeekMs))}</strong>
        <span>semana</span>
      </div>
      <div class="logs">
        ${row.sessions.length ? row.sessions.map((session) => `
          <div><b>Entrou</b> ${escapeHtml(formatDate(session.startedAt))}</div>
          <div><b>Saiu</b> ${escapeHtml(formatDate(session.closedAt))}</div>
          <div><b>Tempo</b> ${escapeHtml(formatDuration(getSessionMs(session)))}</div>
        `).join('') : '<div>Nenhuma sessao fechada no periodo.</div>'}
      </div>
    </section>`).join('');

  const rankingHtml = report.ranking.map((row, index) => `
    <li><span>#${index + 1} ${escapeHtml(row.name)}</span><strong>${escapeHtml(formatDuration(report.mode === 'weekly' ? row.totalWeekMs : row.totalDayMs))}</strong></li>
  `).join('');

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Relatorio Diario Vortex</title>
  <link rel="stylesheet" href="/vendor/fontawesome/css/all.min.css">
  <style>
    :root{--bg:#02050c;--panel:#07101f;--blue:#005DFF;--blue2:#0066FF;--ice:#F5F5F5;--muted:#9fb5d8}
    *{box-sizing:border-box} body{margin:0;background:radial-gradient(circle at 20% 0%,rgba(0,93,255,.34),transparent 28%),linear-gradient(135deg,#02050c,#05070d 55%,#00133a);color:var(--ice);font-family:Inter,Arial,sans-serif}
    body:before{content:"";position:fixed;inset:0;opacity:.14;background-image:linear-gradient(45deg,rgba(255,255,255,.04) 25%,transparent 25%),linear-gradient(-45deg,rgba(255,255,255,.03) 25%,transparent 25%);background-size:18px 18px;pointer-events:none}
    .wrap{position:relative;max-width:1180px;margin:0 auto;padding:28px}
    .chain{position:fixed;color:rgba(0,102,255,.35);font-size:42px;text-shadow:0 0 24px var(--blue);z-index:0}.c1{top:18px;left:18px}.c2{top:18px;right:18px}.c3{bottom:18px;left:18px}.c4{bottom:18px;right:18px}
    header{border:1px solid rgba(0,102,255,.45);background:rgba(7,16,31,.82);box-shadow:0 0 35px rgba(0,93,255,.28);border-radius:18px;padding:28px;margin-bottom:18px}
    .brand{font-weight:900;letter-spacing:2px;color:var(--blue2);text-shadow:0 0 18px var(--blue)} h1{margin:8px 0;font-size:34px} .sub{color:var(--muted)}
    .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:18px 0}.stat,.side,.player-card{border:1px solid rgba(0,102,255,.35);background:rgba(7,16,31,.78);box-shadow:0 0 22px rgba(0,93,255,.16);border-radius:14px}
    .stat{padding:18px}.stat span,.metric span{display:block;color:var(--muted);font-size:13px}.stat strong,.metric strong{font-size:24px}
    main{display:grid;grid-template-columns:1fr 330px;gap:18px}.player-card{display:grid;grid-template-columns:52px 58px 1fr 120px;gap:14px;align-items:center;padding:16px;margin-bottom:12px}.rank{color:var(--blue2);font-weight:900}.avatar{width:54px;height:54px;border-radius:50%;border:2px solid var(--blue);background:#111}.player-main h2{margin:0 0 4px;font-size:18px}.player-main p{margin:0;color:var(--muted);font-size:13px}
    .chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}.chips span{border:1px solid rgba(0,102,255,.35);border-radius:999px;padding:5px 9px;color:#dbe8ff;background:rgba(0,93,255,.12);font-size:12px}
    .logs{grid-column:1/-1;border-top:1px solid rgba(0,102,255,.24);padding-top:10px;display:grid;grid-template-columns:repeat(3,1fr);gap:8px;color:var(--muted);font-size:13px}
    .side{padding:18px;align-self:start;position:sticky;top:18px}.side h2{margin-top:0}.side ol{padding:0;margin:0;list-style:none}.side li{display:flex;justify-content:space-between;border-bottom:1px solid rgba(0,102,255,.2);padding:10px 0;color:#dbe8ff}
    .bar{height:10px;background:#07101f;border:1px solid rgba(0,102,255,.35);border-radius:999px;overflow:hidden}.bar i{display:block;height:100%;background:linear-gradient(90deg,var(--blue),#5bb4ff);box-shadow:0 0 18px var(--blue);width:${Math.min(100, Math.round((top?.totalDayMs || 0) / (6 * 60 * 60 * 1000) * 100))}%}
    footer{color:var(--muted);text-align:center;margin:24px 0}
    @media(max-width:800px){.grid,main{grid-template-columns:1fr}.player-card{grid-template-columns:44px 50px 1fr}.metric{grid-column:3}.logs{grid-template-columns:1fr}.wrap{padding:16px}h1{font-size:26px}}
  </style>
</head>
<body>
  <div class="chain c1">⛓</div><div class="chain c2">⛓</div><div class="chain c3">⛓</div><div class="chain c4">⛓</div>
  <div class="wrap">
    <header>
      <div class="brand"><i class="fa-solid fa-shield-halved"></i> VORTEX MANAGEMENT SYSTEM</div>
      <h1><i class="fa-solid fa-chart-line"></i> RELATORIO ${report.mode === 'weekly' ? 'SEMANAL' : 'DIARIO'} — METROPOLE RP</h1>
      <div class="sub">Servidor ${escapeHtml(report.guildName)} • Periodo ${escapeHtml(report.dateKey)} • Gerado em ${escapeHtml(formatDate(report.generatedAt))}</div>
    </header>
    <section class="grid">
      <div class="stat"><span>Jogadores ativos</span><strong>${report.totals.users}</strong></div>
      <div class="stat"><span>Na cidade agora</span><strong>${report.totals.online}</strong></div>
      <div class="stat"><span>Conexoes</span><strong>${report.totals.connections}</strong></div>
      <div class="stat"><span>Tempo total</span><strong>${escapeHtml(formatDuration(report.totals.totalMs))}</strong></div>
    </section>
    <main>
      <div>${rowsHtml || '<section class="player-card">Nenhuma atividade encontrada.</section>'}</div>
      <aside class="side">
        <h2>Ranking premium</h2>
        <div class="bar"><i></i></div>
        <ol>${rankingHtml || '<li><span>Nenhum dado</span><strong>0min</strong></li>'}</ol>
        <h2>Status final</h2>
        <p>${escapeHtml(activityLabel(top?.totalDayMs || 0))}</p>
      </aside>
    </main>
    <footer>Vortex • Preto profundo • Azul neon #005DFF • Transcript HTML responsivo</footer>
  </div>
</body>
</html>`;
}

function buildDailyReportJson(report) {
  return JSON.stringify(report, null, 2);
}

function buildDailyReportEmbed(report) {
  const top = report.ranking.slice(0, 5).map((row, index) => {
    const total = report.mode === 'weekly' ? row.totalWeekMs : row.totalDayMs;
    return `**${index + 1}.** ${row.mention} • ${formatDuration(total)} • ${row.connections} conexao(oes)`;
  }).join('\n') || '`Nenhum jogador ativo no periodo.`';

  return new EmbedBuilder()
    .setColor('#005DFF')
    .setAuthor({ name: 'VORTEX | RELATORIO METROPOLE RP' })
    .setTitle(report.mode === 'weekly' ? 'Relatorio semanal' : 'Relatorio diario')
    .setDescription([
      '```',
      'RELATORIO DIARIO — METROPOLE RP',
      '```',
      `Jogadores ativos: **${report.totals.users}**`,
      `Na cidade agora: **${report.totals.online}**`,
      `Conexoes: **${report.totals.connections}**`,
      `Tempo total: **${formatDuration(report.totals.totalMs)}**`,
      '',
      '**Ranking dos mais ativos**',
      top,
    ].join('\n'))
    .setTimestamp()
    .setFooter({ text: 'Vortex • Transcript premium RP' });
}

async function buildDailyReportPayload(guild, options = {}) {
  const report = await buildDailyReportData(guild, options);
  const suffix = `${report.mode}-${report.dateKey}`;
  const html = buildDailyReportHtml(report);
  const json = buildDailyReportJson(report);

  return {
    report,
    embeds: [buildDailyReportEmbed(report)],
    files: [
      new AttachmentBuilder(Buffer.from(html, 'utf8'), { name: `vortex-relatorio-${suffix}.html` }),
      new AttachmentBuilder(Buffer.from(json, 'utf8'), { name: `vortex-relatorio-${suffix}.json` }),
    ],
  };
}

async function sendDailyReportForGuild(client, guild, options = {}) {
  if (!isPrimaryGuild(guild.id)) return { ok: false, message: 'Servidor fora do escopo configurado.' };
  const config = getDailyReportConfig();
  const channelId = options.channelId || config.reportChannelId || config.testChannelId;
  if (!channelId) return { ok: false, message: 'Canal de relatorio diario nao configurado.' };
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!isPrimaryGuildChannel(channel)) return { ok: false, message: 'Canal fora do servidor configurado.' };
  if (!channel?.isTextBased?.()) return { ok: false, message: 'Canal de relatorio diario nao encontrado.' };

  const payload = await buildDailyReportPayload(guild, options);
  await channel.send({
    content: `Relatorio ${payload.report.mode === 'weekly' ? 'semanal' : 'diario'} — **${TARGET_SERVER_NAME}**`,
    embeds: payload.embeds,
    files: payload.files,
    allowedMentions: { parse: [] },
  });

  return { ok: true, message: `Relatorio enviado em <#${channel.id}>.`, report: payload.report };
}

async function runDailyReportScheduler(client, force = false) {
  const config = getDailyReportConfig();
  if (!force && !config.enabled) return [];
  const now = getLocalParts();
  if (!force && !(now.hour === config.hour && now.minute === config.minute)) return [];

  const state = readJSON(STATE_PATH, {});
  const results = [];
  for (const guild of client.guilds.cache.values()) {
    if (!isPrimaryGuild(guild.id)) continue;
    const stateKey = `${guild.id}:${now.dateKey}`;
    if (!force && state[stateKey]) continue;
    const result = await sendDailyReportForGuild(client, guild, { dateKey: now.dateKey, mode: 'daily' }).catch((error) => {
      logger.error('Erro ao enviar relatorio diario:', error);
      return { ok: false, message: error.message };
    });
    if (result.ok) {
      state[stateKey] = new Date().toISOString();
      results.push({ guildId: guild.id, ok: true });
    }
  }
  writeJSON(STATE_PATH, state);
  return results;
}

function initDailyReportManager(client) {
  if (interval) clearInterval(interval);
  interval = setInterval(() => {
    runDailyReportScheduler(client).catch((error) => logger.error('Erro no agendador de relatorio diario:', error));
  }, 30 * 1000);
}

module.exports = {
  ensureDailyReportConfig,
  getDailyReportConfig,
  setDailyReportChannel,
  buildDailyReportData,
  buildDailyReportPayload,
  sendDailyReportForGuild,
  runDailyReportScheduler,
  initDailyReportManager,
};
