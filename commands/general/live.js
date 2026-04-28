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
  buildLiveTermsUrl,
  buildLivePanelEmbed,
  checkUserTwitchLinks,
  getLiveLinks,
  hasAcceptedLiveTerms,
  isValidLiveUrl,
  removeLiveLink,
  setLiveLink,
} = require('../../utils/liveAlertManager');
const { hasCommandRole } = require('../../utils/permissions');

const CUSTOM_IDS = {
  set: 'live_alert_set_link',
  remove: 'live_alert_remove_link',
  test: 'live_alert_test_now',
  modal: 'live_alert_link_modal',
};

function buildLiveComponents({ hasLinks, termsAccepted, termsUrl }) {
  const rows = [
    new ActionRowBuilder(),
  ];

  if (!termsAccepted) {
    rows[0].addComponents(
      new ButtonBuilder()
        .setLabel('Aceitar termos')
        .setStyle(ButtonStyle.Link)
        .setURL(termsUrl),
    );
    return rows;
  }

  rows[0].addComponents(
      new ButtonBuilder()
        .setCustomId(CUSTOM_IDS.set)
        .setLabel('Adicionar link')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(CUSTOM_IDS.remove)
        .setLabel('Remover todos')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(!hasLinks),
      new ButtonBuilder()
        .setCustomId(CUSTOM_IDS.test)
        .setLabel('Verificar agora')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!hasLinks),
    );

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('Ver termos')
        .setStyle(ButtonStyle.Link)
        .setURL(termsUrl),
    ),
  );

  return rows;
}

function buildLinkModal() {
  const input = new TextInputBuilder()
    .setCustomId('url')
    .setLabel('LINK DO CANAL DA LIVE')
    .setPlaceholder('https://twitch.tv/seucanal ou https://youtube.com/@seucanal')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(300);

  return new ModalBuilder()
    .setCustomId(CUSTOM_IDS.modal)
    .setTitle('Adicionar link de live')
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
    const links = getLiveLinks(interaction.guildId, interaction.user.id);
    const termsAccepted = hasAcceptedLiveTerms(interaction.guildId, interaction.user.id);
    const termsUrl = buildLiveTermsUrl(interaction.guildId, interaction.user.id);
    return safeReply(interaction, {
      embeds: [buildLivePanelEmbed(interaction, links, termsAccepted)],
      components: buildLiveComponents({ hasLinks: links.length > 0, termsAccepted, termsUrl }),
      ephemeral: true,
    });
  },

  async handleButton(interaction) {
    if (interaction.customId === CUSTOM_IDS.set) {
      if (!hasAcceptedLiveTerms(interaction.guildId, interaction.user.id)) {
        return safeReply(interaction, {
          content: `❌ Aceite os termos antes de cadastrar links: ${buildLiveTermsUrl(interaction.guildId, interaction.user.id)}`,
          ephemeral: true,
        });
      }
      return interaction.showModal(buildLinkModal());
    }

    if (interaction.customId === CUSTOM_IDS.remove) {
      if (!hasCommandRole(interaction.member, 'live_remove')) {
        return safeReply(interaction, {
          content: '❌ Apenas cargos configurados no `/painel` em `Remover /live` podem remover links de live.',
          ephemeral: true,
        });
      }

      const removed = removeLiveLink(interaction.guildId, interaction.user.id);
      const links = getLiveLinks(interaction.guildId, interaction.user.id);
      const termsAccepted = hasAcceptedLiveTerms(interaction.guildId, interaction.user.id);
      const termsUrl = buildLiveTermsUrl(interaction.guildId, interaction.user.id);
      return safeReply(interaction, {
        content: removed
          ? `✅ Links de live removidos. Não vou mais avisar em <#${ALERT_CHANNEL_ID}> quando seus canais entrarem em live.`
          : '❌ Você não tinha links de live cadastrados.',
        embeds: [buildLivePanelEmbed(interaction, links, termsAccepted)],
        components: buildLiveComponents({ hasLinks: links.length > 0, termsAccepted, termsUrl }),
        ephemeral: true,
      });
    }

    if (interaction.customId === CUSTOM_IDS.test) {
      await interaction.deferReply({ ephemeral: true });
      const result = await checkUserTwitchLinks(interaction.client, interaction.guildId, interaction.user.id, {
        sendIfOnline: true,
      }).catch((error) => ({
        ok: false,
        message: `Erro ao consultar Twitch: ${error.message}`,
        termsAccepted: hasAcceptedLiveTerms(interaction.guildId, interaction.user.id),
        hasCredentials: false,
        totalLinks: getLiveLinks(interaction.guildId, interaction.user.id).length,
        twitchLinks: 0,
        online: [],
        offline: [],
        sent: 0,
      }));

      const onlineLines = result.online?.length
        ? result.online.map(({ link, stream }) => `🟢 ${link.url} — ${stream.title || 'Online'}`).join('\n')
        : 'Nenhum';
      const offlineLines = result.offline?.length
        ? result.offline.map((link) => `⚫ ${link.url}`).join('\n')
        : 'Nenhum';

      return interaction.editReply({
        content: [
          result.ok ? '✅ Verificação concluída.' : '❌ Verificação não concluída.',
          `**Resultado:** ${result.message}`,
          `**Termos aceitos:** ${result.termsAccepted ? 'sim' : 'não'}`,
          `**Credenciais Twitch:** ${result.hasCredentials ? 'ok' : 'faltando'}`,
          `**Links cadastrados:** ${result.totalLinks}`,
          `**Links Twitch:** ${result.twitchLinks}`,
          `**Alertas enviados agora:** ${result.sent || 0}`,
          '',
          '**Online**',
          onlineLines,
          '',
          '**Offline**',
          offlineLines,
        ].join('\n'),
      });
    }

    return null;
  },

  async handleModal(interaction) {
    await interaction.deferReply({ ephemeral: true });

    if (!hasAcceptedLiveTerms(interaction.guildId, interaction.user.id)) {
      return interaction.editReply({
        content: `❌ Aceite os termos antes de cadastrar links: ${buildLiveTermsUrl(interaction.guildId, interaction.user.id)}`,
      });
    }

    const url = interaction.fields.getTextInputValue('url').trim();
    if (!isValidLiveUrl(url)) {
      return interaction.editReply({
        content: '❌ Envie um link válido começando com `http://` ou `https://`.',
      });
    }

    setLiveLink(interaction.guildId, interaction.user.id, url, interaction.user.id);
    const links = getLiveLinks(interaction.guildId, interaction.user.id);
    const termsUrl = buildLiveTermsUrl(interaction.guildId, interaction.user.id);

    return interaction.editReply({
      content: `✅ Link de live adicionado. Quando esse canal ficar online, vou avisar em <#${ALERT_CHANNEL_ID}>.`,
      embeds: [buildLivePanelEmbed(interaction, links, true)],
      components: buildLiveComponents({ hasLinks: links.length > 0, termsAccepted: true, termsUrl }),
    });
  },
};
