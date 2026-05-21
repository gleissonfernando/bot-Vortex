const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { hasVortexLevel } = require('../../utils/permissions');
const { safeReply, safeEdit, safeDeferReply, safeShowModal } = require('../../utils/safeReply');
const {
  createLiveAlert,
  DEFAULT_MESSAGE,
  detectPlatform,
  getLiveSettings,
  listLiveAlerts,
  saveLiveSettings,
  sendLiveAlert,
} = require('../../utils/liveAlertManager');

function canManage(interaction) {
  return hasVortexLevel(interaction.member, ['admin']);
}

function componentsV2Panel() {
  return {
    flags: MessageFlags.IsComponentsV2,
    components: [
      {
        type: 17,
        accent_color: 0x7c3aed,
        components: [
          {
            type: 10,
            content: [
              '# VORTEX | Sistema de Lives',
              'Gerencie alertas de Twitch, YouTube, Kick e URLs personalizadas.',
              'Use os botoes abaixo para cadastrar, listar e configurar os alertas do servidor.',
            ].join('\n'),
          },
          { type: 14, spacing: 1, divider: true },
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('live_register').setLabel('Cadastrar live').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('live_list').setLabel('Listar lives').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('live_test').setLabel('Testar alerta').setStyle(ButtonStyle.Secondary)
          ).toJSON(),
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('live_config_channel').setLabel('Configurar canal').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('live_config_role').setLabel('Configurar cargo').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('live_toggle_system').setLabel('Ativar/Desativar sistema').setStyle(ButtonStyle.Danger)
          ).toJSON(),
        ],
      },
    ],
  };
}

function buildRegisterModal() {
  return new ModalBuilder()
    .setCustomId('live_modal_register')
    .setTitle('Cadastrar live')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('url')
          .setLabel('URL do canal')
          .setPlaceholder('https://www.twitch.tv/streamer')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('streamer')
          .setLabel('Nome do streamer')
          .setPlaceholder('Fulano')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('channel')
          .setLabel('ID do canal de alerta')
          .setPlaceholder('Ex: 123456789012345678')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('role')
          .setLabel('ID do cargo mencionado')
          .setPlaceholder('Ex: 123456789012345678')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('message')
          .setLabel('Mensagem personalizada')
          .setPlaceholder(DEFAULT_MESSAGE)
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(1000)
      )
    );
}

function buildConfigModal(kind) {
  return new ModalBuilder()
    .setCustomId(kind === 'channel' ? 'live_modal_channel' : 'live_modal_role')
    .setTitle(kind === 'channel' ? 'Canal padrao de lives' : 'Cargo padrao de lives')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('value')
          .setLabel(kind === 'channel' ? 'ID do canal' : 'ID do cargo')
          .setPlaceholder('Cole o ID aqui')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
}

async function listLivesText(guildId) {
  const lives = await listLiveAlerts(guildId);
  if (!lives.length) return 'Nenhuma live cadastrada neste servidor.';
  return lives.slice(0, 15).map((live, index) => [
    `**${index + 1}. ${live.streamerName}**`,
    `Plataforma: \`${live.platform}\``,
    `Status: **${live.status === 'online' ? 'Online' : live.status === 'offline' ? 'Offline' : 'Desconhecido'}**`,
    `URL: ${live.url}`,
    `Canal: ${live.alertChannelId ? `<#${live.alertChannelId}>` : 'padrao'}`,
    `Cargo: ${live.mentionRoleId ? `<@&${live.mentionRoleId}>` : 'padrao'}`,
  ].join('\n')).join('\n\n');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lives')
    .setDescription('Abre o painel de alertas de lives da Vortex.'),

  async execute(interaction) {
    if (!canManage(interaction)) {
      return safeReply(interaction, { content: '❌ Apenas administradores Vortex podem gerenciar lives.', ephemeral: true });
    }
    const panel = componentsV2Panel();
    return safeReply(interaction, { ...panel, flags: panel.flags | MessageFlags.Ephemeral });
  },

  async handleButton(interaction) {
    if (!canManage(interaction)) {
      return safeReply(interaction, { content: '❌ Sem permissão para gerenciar lives.', ephemeral: true });
    }

    if (interaction.customId === 'live_register') {
      return safeShowModal(interaction, buildRegisterModal());
    }
    if (interaction.customId === 'live_config_channel') {
      return safeShowModal(interaction, buildConfigModal('channel'));
    }
    if (interaction.customId === 'live_config_role') {
      return safeShowModal(interaction, buildConfigModal('role'));
    }
    if (interaction.customId === 'live_list') {
      await safeDeferReply(interaction, { ephemeral: true });
      return safeEdit(interaction, { content: await listLivesText(interaction.guildId) });
    }
    if (interaction.customId === 'live_toggle_system') {
      await safeDeferReply(interaction, { ephemeral: true });
      const current = await getLiveSettings(interaction.guildId);
      const next = await saveLiveSettings(interaction.guildId, { enabled: !current.enabled });
      return safeEdit(interaction, { content: `✅ Sistema de lives ${next.enabled ? 'ativado' : 'desativado'} neste servidor.` });
    }
    if (interaction.customId === 'live_test') {
      await safeDeferReply(interaction, { ephemeral: true });
      const lives = await listLiveAlerts(interaction.guildId);
      const live = lives[0];
      if (!live) return safeEdit(interaction, { content: '❌ Cadastre uma live antes de testar.' });
      const settings = await getLiveSettings(interaction.guildId);
      const result = await sendLiveAlert(interaction.client, live, settings, {
        title: 'Teste de alerta Vortex',
        url: live.url,
      }, { test: true });
      return safeEdit(interaction, { content: result.ok ? '✅ Alerta de teste enviado.' : `❌ ${result.error}` });
    }
  },

  async handleModal(interaction) {
    if (!canManage(interaction)) {
      return safeReply(interaction, { content: '❌ Sem permissão para gerenciar lives.', ephemeral: true });
    }
    await safeDeferReply(interaction, { ephemeral: true });

    if (interaction.customId === 'live_modal_register') {
      const url = interaction.fields.getTextInputValue('url').trim();
      const streamerName = interaction.fields.getTextInputValue('streamer').trim();
      const alertChannelId = interaction.fields.getTextInputValue('channel').trim() || null;
      const mentionRoleId = interaction.fields.getTextInputValue('role').trim() || null;
      const customMessage = interaction.fields.getTextInputValue('message').trim() || null;
      const live = await createLiveAlert(interaction.guildId, {
        platform: detectPlatform(url),
        url,
        streamerName,
        alertChannelId,
        mentionRoleId,
        customMessage,
      });
      return safeEdit(interaction, { content: `✅ Live cadastrada: **${live.streamerName}** (${live.platform}).` });
    }

    if (interaction.customId === 'live_modal_channel') {
      const value = interaction.fields.getTextInputValue('value').trim();
      await saveLiveSettings(interaction.guildId, { defaultAlertChannelId: value });
      return safeEdit(interaction, { content: `✅ Canal padrao configurado para <#${value}>.` });
    }

    if (interaction.customId === 'live_modal_role') {
      const value = interaction.fields.getTextInputValue('value').trim();
      await saveLiveSettings(interaction.guildId, { defaultMentionRoleId: value });
      return safeEdit(interaction, { content: `✅ Cargo padrao configurado para <@&${value}>.` });
    }
  },
};
