const { AttachmentBuilder, EmbedBuilder } = require('discord.js');
const {
  listGuildPoints,
  getUserPoint,
  getEffectiveTotalMs,
  getPointDays,
  formatDuration,
  formatDate,
} = require('./pontoManager');

function pad(value, size) {
  const text = String(value || '');
  return text.length > size ? `${text.slice(0, size - 3)}...` : text.padEnd(size, ' ');
}

function statusText(data) {
  return data.activePointStartedAt ? 'Aberto' : 'Fechado';
}

async function buildUserRegistroEmbed(guild, user) {
  const data = await getUserPoint(guild.id, user.id);
  const activeMs = data.activePointStartedAt ? Date.now() - new Date(data.activePointStartedAt).getTime() : 0;

  return new EmbedBuilder()
    .setColor(data.activePointStartedAt ? '#57F287' : '#7000FF')
    .setAuthor({ name: 'VORTEX | Registro de Ponto' })
    .setTitle('Registro do usuário')
    .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 256 }))
    .addFields(
      { name: 'Usuário', value: `<@${user.id}>`, inline: true },
      { name: 'Discord ID', value: `\`${user.id}\``, inline: true },
      { name: 'Status', value: statusText(data), inline: true },
      { name: 'Abertura atual', value: formatDate(data.activePointStartedAt), inline: false },
      { name: 'Última abertura', value: formatDate(data.lastPointOpenAt), inline: true },
      { name: 'Ultimo fechamento', value: formatDate(data.lastPointCloseAt), inline: true },
      { name: 'Dias logados', value: String(getPointDays(data)), inline: true },
      { name: 'Tempo total', value: formatDuration(getEffectiveTotalMs(data)), inline: true },
      { name: 'Tempo do ponto atual', value: data.activePointStartedAt ? formatDuration(activeMs) : 'Ponto fechado', inline: true },
      { name: 'Ajustes registrados', value: String((data.corrections || []).length), inline: true }
    )
    .setTimestamp()
    .setFooter({ text: 'Vortex - Sistema de Ponto' });
}

function buildReportText(guild, rows, totals) {
  const lines = [
    `Relatorio completo de ponto - ${guild.name}`,
    `Gerado em: ${formatDate(new Date())}`,
    '',
    `Usuários: ${totals.users}`,
    `Usuários online: ${totals.active}`,
    `Sessoes fechadas: ${totals.sessions}`,
    `Ajustes de ponto: ${totals.corrections}`,
    `Tempo total: ${formatDuration(totals.totalMs)}`,
    '',
    '================================================================================',
    '',
  ];

  for (const row of rows) {
    lines.push(
      `Usuário: ${row.name}`,
      `Discord ID: ${row.userId}`,
      `Mencao: ${row.mention}`,
      `Registro: ${row.registro}`,
      `Status: ${row.status}`,
      `Dias logados: ${row.days}`,
      `Pontos fechados: ${row.sessions}`,
      `Ajustes: ${row.corrections}`,
      `Tempo total: ${row.total}`,
      `Abertura atual: ${row.activeSince || 'N/A'}`,
      `Última abertura: ${row.lastOpen}`,
      `Ultimo fechamento: ${row.lastClose}`,
      '--------------------------------------------------------------------------------',
    );
  }

  return `${lines.join('\n')}\n`;
}

async function buildAllPointsReportPayload(guild) {
  const points = await listGuildPoints(guild.id);
  const rows = await Promise.all(points.map(async (data) => {
    const member = await guild.members.fetch(data.userId).catch(() => null);
    const totalMs = getEffectiveTotalMs(data);
    return {
      userId: data.userId,
      name: member?.displayName || data.userName || `ID ${data.userId}`,
      mention: data.userMention || `<@${data.userId}>`,
      registro: data.registro || data.idRegistro || data.userId,
      status: statusText(data),
      days: getPointDays(data),
      sessions: Array.isArray(data.sessions) ? data.sessions.length : 0,
      corrections: Array.isArray(data.corrections) ? data.corrections.length : 0,
      totalMs,
      total: formatDuration(totalMs),
      lastOpen: formatDate(data.lastPointOpenAt),
      lastClose: formatDate(data.lastPointCloseAt),
      activeSince: data.activePointStartedAt ? formatDate(data.activePointStartedAt) : null,
    };
  }));

  rows.sort((a, b) => b.totalMs - a.totalMs);

  const totals = {
    users: rows.length,
    active: rows.filter((row) => row.status === 'Aberto').length,
    sessions: rows.reduce((sum, row) => sum + row.sessions, 0),
    corrections: rows.reduce((sum, row) => sum + row.corrections, 0),
    totalMs: rows.reduce((sum, row) => sum + row.totalMs, 0),
  };

  const leastLogged = rows.slice().sort((a, b) => a.totalMs - b.totalMs).slice(0, 5);
  const previewRows = rows.slice(0, 12).map((row, index) => (
    `${pad(index + 1, 2)} ${pad(row.name, 18)} ${pad(row.status, 7)} ${pad(row.total, 10)} ${pad(row.sessions, 4)} ${pad(row.corrections, 4)}`
  ));

  const embed = new EmbedBuilder()
    .setColor('#7000FF')
    .setAuthor({ name: 'VORTEX | Relatorio de Pontos' })
    .setTitle('Todos os pontos batidos')
    .setDescription([
      `Usuários no relatório: **${totals.users}**`,
      `Online agora: **${totals.active}**`,
      `Pontos fechados: **${totals.sessions}**`,
      `Ajustes registrados: **${totals.corrections}**`,
      `Tempo total: **${formatDuration(totals.totalMs)}**`,
      '',
      '**Usuários que menos logaram**',
      leastLogged.length ? leastLogged.map((row) => `${row.mention} - ${row.total}`).join('\n') : 'Nenhum registro encontrado.',
      '',
      '```',
      `${pad('#', 2)} ${pad('USUARIO', 18)} ${pad('STATUS', 7)} ${pad('TOTAL', 10)} ${pad('PTS', 4)} ${pad('AJUS', 4)}`,
      ...previewRows,
      '```',
      'O arquivo anexado contém abertura, fechamento, último fechamento e ajustes de todos os usuários.',
    ].join('\n').slice(0, 4096))
    .setTimestamp()
    .setFooter({ text: 'Vortex - Sistema de Ponto' });

  const date = new Date().toISOString().slice(0, 10);
  const reportText = buildReportText(guild, rows, totals);
  const attachment = new AttachmentBuilder(Buffer.from(reportText, 'utf8'), {
    name: `todos-os-pontos-${date}.txt`,
  });

  return { embeds: [embed], files: [attachment] };
}

module.exports = {
  buildUserRegistroEmbed,
  buildAllPointsReportPayload,
};
