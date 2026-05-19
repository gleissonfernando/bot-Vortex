const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  SlashCommandBuilder,
} = require('discord.js');
const {
  getUserPoint,
  getEffectiveTotalMs,
  getPointDays,
  formatDuration,
  formatDate,
} = require('../../utils/pontoManager');
const { buildPointSiteUrl } = require('../../utils/pointSite');
const { isGerencia, hasCommandRole } = require('../../utils/permissions');
const { safeDeferReply, safeEdit, safeReply } = require('../../utils/safeReply');
const { buildThemedPanelPayload } = require('../../utils/panelTheme');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('relatorio')
    .setDescription('Gera o link web do relatório de pontos.')
    .addUserOption((option) =>
      option
        .setName('usuario')
        .setDescription('Usuário do relatório. Sem informar, gera o seu.')
        .setRequired(false)),

  async execute(interaction) {
    const target = interaction.options.getUser('usuario') || interaction.user;
    if (target.id !== interaction.user.id && !isGerencia(interaction) && !hasCommandRole(interaction.member, 'ponto')) {
      return safeReply(interaction, {
        content: '❌ Você não tem permissão para gerar relatório de outro usuário.',
        ephemeral: true,
      });
    }

    await safeDeferReply(interaction, { ephemeral: true });

    const data = await getUserPoint(interaction.guild.id, target.id);
    const activeMs = data.activePointStartedAt ? Math.max(0, Date.now() - new Date(data.activePointStartedAt).getTime()) : 0;
    const reportUrl = buildPointSiteUrl(interaction.guild.id, target.id);

    const embed = new EmbedBuilder()
      .setColor('#005DFF')
      .setAuthor({ name: 'VORTEX | RELATORIO WEB DE PONTOS' })
      .setTitle('Relatório individual de pontos')
      .setThumbnail(target.displayAvatarURL({ dynamic: true, size: 256 }))
      .setDescription([
        'Relatório web premium gerado por link.',
        '',
        `Usuário: <@${target.id}>`,
        `Status: **${data.activePointStartedAt ? 'Online / Em ponto' : 'Offline / Ponto fechado'}**`,
      ].join('\n'))
      .addFields(
        { name: 'Discord ID', value: `\`${target.id}\``, inline: true },
        { name: 'Registro/ID RP', value: `\`${data.registro || data.idRegistro || target.id}\``, inline: true },
        { name: 'Dias ativos', value: String(getPointDays(data)), inline: true },
        { name: 'Tempo total', value: formatDuration(getEffectiveTotalMs(data)), inline: true },
        { name: 'Ponto atual', value: data.activePointStartedAt ? formatDuration(activeMs) : 'Fechado', inline: true },
        { name: 'Último login', value: formatDate(data.lastPointOpenAt), inline: true },
        { name: 'Link web', value: reportUrl, inline: false }
      )
      .setTimestamp()
      .setFooter({ text: 'Vortex • Relatório de Pontos' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('Abrir relatório web')
        .setStyle(ButtonStyle.Link)
        .setURL(reportUrl)
    );

    return safeEdit(interaction, buildThemedPanelPayload('painelponto', embed, {
      headerText: `🔗 Relatório web de <@${target.id}>: ${reportUrl}`,
      components: [row],
      allowedMentions: { users: [target.id] },
    }));
  },
};
