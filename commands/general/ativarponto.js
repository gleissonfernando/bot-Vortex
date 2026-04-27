const { SlashCommandBuilder } = require('discord.js');
const path = require('path');
const {
  createControlEmbed,
  createControlRow,
  createStatusEmbed,
  getPointConfig,
  savePanel,
} = require('../../utils/pontoPanel');
const { isGerencia } = require('../../utils/permissions');

const VORTEX_PANEL_IMAGE = path.join(__dirname, '..', '..', 'foto', 'IMG_4234.png');
const VORTEX_PANEL_IMAGE_NAME = 'IMG_4234.png';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ativarponto')
    .setDescription('Cria o painel de ponto com botoes de abrir e fechar.'),

  async execute(interaction) {
    const pointConfig = getPointConfig();

    if (interaction.channelId !== pointConfig.actionChannelId) {
      return interaction.reply({
        content: `❌ O comando /ativarponto deve ser executado em <#${pointConfig.actionChannelId}>.`,
        ephemeral: true,
      });
    }

    if (!isGerencia(interaction)) {
      return interaction.reply({ content: '❌ Voce nao tem permissao para ativar o painel de ponto.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const pontoChannel = await interaction.client.channels.fetch(pointConfig.actionChannelId).catch(() => null);
    if (!pontoChannel?.isTextBased?.()) {
      return interaction.editReply({
        content: `Nao consegui encontrar o canal de bater ponto <#${pointConfig.actionChannelId}>.`,
      });
    }

    const onlineChannel = await interaction.client.channels.fetch(pointConfig.statusChannelId).catch(() => null);
    if (!onlineChannel?.isTextBased?.()) {
      return interaction.editReply({
        content: `Nao consegui encontrar o canal player-online <#${pointConfig.statusChannelId}>.`,
      });
    }

    const controlPayload = {
      embeds: [createControlEmbed()],
      components: [createControlRow()],
      files: [{ attachment: VORTEX_PANEL_IMAGE, name: VORTEX_PANEL_IMAGE_NAME }],
    };
    const controlMessage = await pontoChannel.send(controlPayload);

    const statusPayload = { embeds: [await createStatusEmbed(interaction.guild)] };
    const statusMessage = await onlineChannel.send(statusPayload);

    savePanel(interaction.guild.id, {
      channelId: pontoChannel.id,
      statusChannelId: onlineChannel.id,
      controlMessageId: controlMessage.id,
      statusMessageId: statusMessage.id,
      createdBy: interaction.user.id,
      createdAt: new Date().toISOString(),
    });

    return interaction.editReply({
      content: [
        `Painel de ponto ativado em <#${PONTO_ACTION_CHANNEL_ID}>: ${controlMessage.url}`,
        `O painel de online sera atualizado em <#${PONTO_ONLINE_CHANNEL_ID}>: ${statusMessage.url}`,
      ].join('\n'),
    });
  },
};
