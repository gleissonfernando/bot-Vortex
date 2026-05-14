const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const {
  listGuildPoints,
  getEffectiveTotalMs,
  getPointDays,
  formatDuration,
  formatDate,
} = require('../../utils/pontoManager');
const { isGerencia, hasCommandRole } = require('../../utils/permissions');
const { safeReply, safeDeferReply, safeEdit } = require('../../utils/safeReply');

function pad(value, size) {
  const text = String(value || '');
  return text.length > size ? `${text.slice(0, size - 3)}...` : text.padEnd(size, ' ');
}

function statusText(data) {
  return data.activePointStartedAt ? 'Aberto' : 'Fechado';
}

function buildReportText(guild, rows, totals) {
  const lines = [
    `Relatorio de ponto - ${guild.name}`,
    `Gerado em: ${formatDate(new Date())}`,
    '',
    `Usuários no relatório: ${totals.users}`,
    `Usuários em serviço: ${totals.active}`,
    `Sessoes registradas: ${totals.sessions}`,
    `Tempo total somado: ${formatDuration(totals.totalMs)}`,
    '',
    '================================================================================',
    '',
  ];

  for (const row of rows) {
    lines.push(
      `Usuário: ${row.name}`,
      `Discord ID: ${row.userId}`,
      `Registro: ${row.registro}`,
      `Status: ${row.status}`,
      `Dias com ponto: ${row.days}`,
      `Sessoes: ${row.sessions}`,
      `Total de horas: ${row.total}`,
      `Primeiro ponto: ${row.firstPoint}`,
      `Última abertura: ${row.lastOpen}`,
      `Ultimo fechamento: ${row.lastClose}`,
      row.activeSince ? `Ponto aberto desde: ${row.activeSince}` : null,
      '--------------------------------------------------------------------------------',
    );
  }

  return `${lines.filter(Boolean).join('\n')}\n`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ponto')
    .setDescription('Mostra o relatório geral de ponto de todos os usuários.'),

  async execute(interaction) {
    if (!isGerencia(interaction) && !hasCommandRole(interaction.member, 'ponto')) {
      return safeReply(interaction, {
        content: '❌ Você não tem permissão para ver o relatório de ponto.',
        ephemeral: true,
      });
    }

    await safeDeferReply(interaction, { ephemeral: true });

    const points = await listGuildPoints(interaction.guild.id);
    if (points.length === 0) {
      return safeEdit(interaction, {
        content: 'Nenhum ponto registrado neste servidor ainda.',
      });
    }

    const rows = await Promise.all(points.map(async (data) => {
      const member = await interaction.guild.members.fetch(data.userId).catch(() => null);
      const totalMs = getEffectiveTotalMs(data);
      return {
        userId: data.userId,
        name: member?.displayName || data.userName || `ID ${data.userId}`,
        mention: data.userMention || `<@${data.userId}>`,
        registro: data.registro || data.idRegistro || data.userId,
        status: statusText(data),
        days: getPointDays(data),
        sessions: Array.isArray(data.sessions) ? data.sessions.length : 0,
        totalMs,
        total: formatDuration(totalMs),
        firstPoint: formatDate(data.firstPointAt),
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
      totalMs: rows.reduce((sum, row) => sum + row.totalMs, 0),
    };

    const previewRows = rows.slice(0, 15).map((row, index) => (
      `${pad(index + 1, 2)} ${pad(row.name, 18)} ${pad(row.status, 7)} ${pad(row.total, 12)} ${row.mention}`
    ));

    const description = [
      `Usuários no relatório: **${totals.users}**`,
      `Em serviço agora: **${totals.active}**`,
      `Sessoes registradas: **${totals.sessions}**`,
      `Tempo total somado: **${formatDuration(totals.totalMs)}**`,
      '',
      '```',
      `${pad('#', 2)} ${pad('USUARIO', 18)} ${pad('STATUS', 7)} ${pad('TOTAL', 12)} MENCAO`,
      ...previewRows,
      '```',
      rows.length > previewRows.length
        ? `Mostrando os ${previewRows.length} maiores totais. O arquivo anexado contém todos os usuários.`
        : 'O arquivo anexado contém o relatório completo.',
    ].join('\n');

    const embed = new EmbedBuilder()
      .setColor('#5865F2')
      .setTitle('Relatorio Geral de Ponto')
      .setDescription(description.slice(0, 4096))
      .setTimestamp()
      .setFooter({ text: 'Vortex - Sistema de Ponto' });

    const date = new Date().toISOString().slice(0, 10);
    const reportText = buildReportText(interaction.guild, rows, totals);
    const attachment = new AttachmentBuilder(Buffer.from(reportText, 'utf8'), {
      name: `relatorio-ponto-${date}.txt`,
    });

    return safeEdit(interaction, { embeds: [embed], files: [attachment] });
  },
};
