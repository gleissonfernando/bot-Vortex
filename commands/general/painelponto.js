const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getUserPoint, getEffectiveTotalMs, getPointDays, formatDuration, formatDate } = require('../../utils/pontoManager');
const { createPointTranscriptTextAttachment } = require('../../utils/pontoTranscript');
const { isGerencia } = require('../../utils/permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('painelponto')
    .setDescription('Consulta o ponto de um usuário.')
    .addUserOption(option =>
      option
        .setName('usuario')
        .setDescription('Usuário mencionado para gerar a folha/transcript')
        .setRequired(true)),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const target = interaction.options.getUser('usuario');
    if (target.id !== interaction.user.id && !isGerencia(interaction)) {
      return interaction.editReply({
        content: '❌ Você não tem permissão para consultar a folha de ponto de outro usuário.',
      });
    }

    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    const data = await getUserPoint(interaction.guild.id, target.id);
    const activeMs = data.activePointStartedAt ? Date.now() - new Date(data.activePointStartedAt).getTime() : 0;
    const transcript = createPointTranscriptTextAttachment({
      guild: interaction.guild,
      target,
      member,
      data,
    });

    const embed = new EmbedBuilder()
      .setColor('#5865F2')
      .setTitle('Painel de Ponto Vortex')
      .setThumbnail(target.displayAvatarURL({ dynamic: true, size: 256 }))
      .setDescription('Folha de ponto individual gerada em arquivo TXT.')
      .addFields(
        { name: 'Usuário Discord', value: `<@${target.id}>`, inline: true },
        { name: 'Discord ID', value: `\`${target.id}\``, inline: true },
        { name: 'Entrou no Discord', value: member?.joinedAt ? formatDate(member.joinedAt) : 'N/A', inline: false },
        { name: 'Primeiro ponto', value: formatDate(data.firstPointAt), inline: true },
        { name: 'Última abertura', value: formatDate(data.lastPointOpenAt), inline: true },
        { name: 'Ultimo fechamento', value: formatDate(data.lastPointCloseAt), inline: true },
        { name: 'Dias com ponto', value: String(getPointDays(data)), inline: true },
        { name: 'Total de horas', value: formatDuration(getEffectiveTotalMs(data)), inline: true },
        { name: 'Ponto atual', value: data.activePointStartedAt ? `Aberto ha ${formatDuration(activeMs)}` : 'Fechado', inline: true }
      )
      .setTimestamp()
      .setFooter({ text: 'Vortex - Sistema de Ponto' });

    return interaction.editReply({ embeds: [embed], files: [transcript] });
  },
};
