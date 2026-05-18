const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  SlashCommandBuilder,
} = require('discord.js');
const { isGerencia, hasCommandRole } = require('../../utils/permissions');
const { createPointTranscriptRecord, formatDate } = require('../../utils/pointTranscriptStore');
const { sendVortexLog } = require('../../utils/notifications');
const { safeDeferReply, safeEdit, safeReply } = require('../../utils/safeReply');

function formatPeriod(startKey, endKey) {
  const [sy, sm, sd] = String(startKey).split('-');
  const [ey, em, ed] = String(endKey).split('-');
  return `${sd}/${sm}/${sy} até ${ed}/${em}/${ey}`;
}

function normalizeMonthInput(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const direct = text.match(/^(\d{4})-(\d{2})$/);
  if (direct) {
    const month = Number(direct[2]);
    return month >= 1 && month <= 12 ? `${direct[1]}-${direct[2]}` : null;
  }
  const br = text.match(/^(\d{2})\/(\d{4})$/);
  if (br) {
    const month = Number(br[1]);
    return month >= 1 && month <= 12 ? `${br[2]}-${br[1]}` : null;
  }
  return null;
}

function formatRecordPeriod(record) {
  return record.periodLabel || formatPeriod(record.weekStartKey, record.weekEndKey);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('relatorio-ponto')
    .setDescription('Gera um transcript web completo do ponto de um usuário.')
    .addUserOption((option) =>
      option
        .setName('usuario')
        .setDescription('Usuário que terá o transcript gerado')
        .setRequired(true))
    .addStringOption((option) =>
      option
        .setName('mes')
        .setDescription('Mês do relatório no formato AAAA-MM ou MM/AAAA. Exemplo: 2026-05')
        .setRequired(false)),

  async execute(interaction) {
    if (!isGerencia(interaction) && !hasCommandRole(interaction.member, 'ponto')) {
      return safeReply(interaction, {
        content: '❌ Você não tem permissão para gerar transcript de ponto.',
        ephemeral: true,
      });
    }

    await safeDeferReply(interaction, { ephemeral: false });

    const target = interaction.options.getUser('usuario');
    const monthInput = interaction.options.getString('mes');
    const monthKey = normalizeMonthInput(monthInput);
    if (monthInput && !monthKey) {
      return safeEdit(interaction, {
        content: '❌ Mês inválido. Use `AAAA-MM` ou `MM/AAAA`. Exemplo: `2026-05`.',
      });
    }

    const result = await createPointTranscriptRecord({
      guild: interaction.guild,
      target,
      generatedBy: interaction.user,
      monthKey,
    });

    const { record, url } = result;
    const embed = new EmbedBuilder()
      .setColor('#005DFF')
      .setAuthor({ name: 'VORTEX | TRANSCRIPT DE PONTO' })
      .setTitle('Relatório de Ponto Gerado')
      .setDescription([
        `Usuário: <@${target.id}>`,
        `Período: **${formatRecordPeriod(record)}**`,
        `Cargo/facção: **${record.factionName}**`,
        '',
        'O histórico completo está disponível apenas no transcript web.',
      ].join('\n'))
      .addFields(
        { name: 'Total semanal', value: record.summary.weeklyTotal, inline: true },
        { name: 'Total mensal', value: record.summary.monthlyTotal, inline: true },
        { name: 'Dias trabalhados', value: String(record.summary.daysWithPoints), inline: true },
        { name: 'Dias sem ponto', value: String(record.summary.daysWithoutPoint), inline: true },
        { name: 'Aberturas', value: String(record.summary.openedCount), inline: true },
        { name: 'Fechamentos', value: String(record.summary.closedCount), inline: true },
        { name: 'Ajustes manuais', value: String(record.summary.manualAdjustments), inline: true },
        { name: 'Expira em', value: formatDate(record.expiresAt), inline: true },
      )
      .setTimestamp()
      .setFooter({ text: 'Sistema Vortex Bot • Painel do Discord' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('Ver Transcript')
        .setStyle(ButtonStyle.Link)
        .setURL(url)
    );

    sendVortexLog(interaction.client, {
      title: 'Transcript de Ponto Gerado',
      description: [
        `Usuário: <@${target.id}> (${target.id})`,
        `Gerado por: <@${interaction.user.id}> (${interaction.user.id})`,
        `Transcript ID: \`${record.id}\``,
        `Período: ${formatRecordPeriod(record)}`,
      ].join('\n'),
      color: '#005DFF',
      type: 'PONTO',
      userId: interaction.user.id,
    }).catch(() => null);

    return safeEdit(interaction, {
      embeds: [embed],
      components: [row],
      allowedMentions: { users: [target.id] },
    });
  },
};
