const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const {
  ALERT_CHANNEL_ID,
  buildLivePanelEmbed,
  getLiveLink,
  isValidLiveUrl,
  removeLiveLink,
  setLiveLink,
} = require('../../utils/liveAlertManager');
const { hasCommandRole } = require('../../utils/permissions');

const CUSTOM_IDS = {
  set: 'live_alert_set_link',
  remove: 'live_alert_remove_link',
  modal: 'live_alert_link_modal',
};

function buildLiveComponents(hasLink) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(CUSTOM_IDS.set)
        .setLabel(hasLink ? 'Alterar link' : 'Cadastrar link')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(CUSTOM_IDS.remove)
        .setLabel('Remover link')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(!hasLink),
    ),
  ];
}

function buildLinkModal(currentLink) {
  const input = new TextInputBuilder()
    .setCustomId('url')
    .setLabel('LINK DO CANAL DA LIVE')
    .setPlaceholder('https://twitch.tv/seucanal ou https://youtube.com/@seucanal')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(300);

  if (currentLink) input.setValue(currentLink);

  return new ModalBuilder()
    .setCustomId(CUSTOM_IDS.modal)
    .setTitle('Configurar alerta de live')
    .addComponents(new ActionRowBuilder().addComponents(input));
}

async function safeReply(interaction, options) {
  if (interaction.replied || interaction.deferred) {
    return interaction.followUp(options).catch(() => null);
  }
  return interaction.reply(options).catch(() => null);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('live')
    .setDescription('Abre o painel para configurar seu alerta automático de live.')
    .setDMPermission(false),

  async execute(interaction) {
    const link = getLiveLink(interaction.guildId, interaction.user.id);
    return safeReply(interaction, {
      embeds: [buildLivePanelEmbed(interaction, link)],
      components: buildLiveComponents(Boolean(link)),
      ephemeral: true,
    });
  },

  async handleButton(interaction) {
    if (interaction.customId === CUSTOM_IDS.set) {
      const currentLink = getLiveLink(interaction.guildId, interaction.user.id);
      return interaction.showModal(buildLinkModal(currentLink));
    }

    if (interaction.customId === CUSTOM_IDS.remove) {
      if (!hasCommandRole(interaction.member, 'live_remove')) {
        return safeReply(interaction, {
          content: '❌ Apenas cargos configurados no `/painel` em `Remover /live` podem remover links de live.',
          ephemeral: true,
        });
      }

      const removed = removeLiveLink(interaction.guildId, interaction.user.id);
      const link = getLiveLink(interaction.guildId, interaction.user.id);
      return safeReply(interaction, {
        content: removed
          ? `✅ Link de live removido. Não vou mais avisar em <#${ALERT_CHANNEL_ID}> quando você entrar em live.`
          : '❌ Você não tinha link de live cadastrado.',
        embeds: [buildLivePanelEmbed(interaction, link)],
        components: buildLiveComponents(Boolean(link)),
        ephemeral: true,
      });
    }

    return null;
  },

  async handleModal(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const url = interaction.fields.getTextInputValue('url').trim();
    if (!isValidLiveUrl(url)) {
      return interaction.editReply({
        content: '❌ Envie um link válido começando com `http://` ou `https://`.',
      });
    }

    setLiveLink(interaction.guildId, interaction.user.id, url, interaction.user.id);
    const link = getLiveLink(interaction.guildId, interaction.user.id);

    return interaction.editReply({
      content: `✅ Link de live cadastrado. Quando você começar uma live, vou avisar em <#${ALERT_CHANNEL_ID}>.`,
      embeds: [buildLivePanelEmbed(interaction, link)],
      components: buildLiveComponents(Boolean(link)),
    });
  },
};
