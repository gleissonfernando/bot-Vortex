const { ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getUserPoint, getEffectiveTotalMs, getPointDays, formatDuration, formatDate } = require('../../utils/pontoManager');
const { isGerencia } = require('../../utils/permissions');
const { buildPointSiteUrl } = require('../../utils/pointSite');
const { safeDeferReply, safeEdit } = require('../../utils/safeReply');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('painelponto')
    .setDescription('Gera a folha de ponto de um usuário.')
    .addUserOption(option =>
      option
        .setName('usuario')
        .setDescription('Usuário que terá a folha de ponto gerada')
        .setRequired(true)),

  async execute(interaction) {
    await safeDeferReply(interaction, { ephemeral: true });

    const target = interaction.options.getUser('usuario');
    if (target.id !== interaction.user.id && !isGerencia(interaction)) {
      return safeEdit(interaction, {
        content: '❌ Você não tem permissão para consultar a folha de ponto de outro usuário.',
      });
    }

    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    const data = await getUserPoint(interaction.guild.id, target.id);
    const activeMs = data.activePointStartedAt ? Date.now() - new Date(data.activePointStartedAt).getTime() : 0;
    const pointSiteUrl = buildPointSiteUrl(interaction.guild.id, target.id);

    const embed = new EmbedBuilder()
      .setColor('#5865F2')
      .setTitle('🕒 Folha de Ponto')
      .setThumbnail(target.displayAvatarURL({ dynamic: true, size: 256 }))
      .setDescription('A folha individual foi gerada. Use o botão abaixo para abrir o relatório no navegador.')
      .addFields(
        { name: 'Usuário Discord', value: `<@${target.id}>`, inline: true },
        { name: 'Discord ID', value: `\`${target.id}\``, inline: true },
        { name: 'Entrou no Discord', value: member?.joinedAt ? formatDate(member.joinedAt) : 'N/A', inline: false },
        { name: 'Primeiro ponto', value: formatDate(data.firstPointAt), inline: true },
        { name: 'Última abertura', value: formatDate(data.lastPointOpenAt), inline: true },
        { name: 'Último fechamento', value: formatDate(data.lastPointCloseAt), inline: true },
        { name: 'Dias com ponto', value: String(getPointDays(data)), inline: true },
        { name: 'Total de horas', value: formatDuration(getEffectiveTotalMs(data)), inline: true },
        { name: 'Ponto atual', value: data.activePointStartedAt ? `Aberto há ${formatDuration(activeMs)}` : 'Fechado', inline: true },
        { name: 'Link direto', value: pointSiteUrl, inline: false }
      )
      .setTimestamp()
      .setFooter({ text: 'Vortex • Sistema de Ponto' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('Abrir folha no navegador')
        .setStyle(ButtonStyle.Link)
        .setURL(pointSiteUrl)
    );

    return safeEdit(interaction, {
      content: `🔗 Link da folha de ponto: ${pointSiteUrl}`,
      embeds: [embed],
      components: [row],
    });
  },
};
