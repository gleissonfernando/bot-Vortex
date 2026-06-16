const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  UserSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const path = require('path');
const fs = require('fs');
const { hasAnyVortexRole, hasVortexAccess, hasCommandRole } = require('../../utils/permissions');
const { sendVortexLog } = require('../../utils/notifications');
const { safeReply, safeEdit, safeDeferReply, safeShowModal } = require('../../utils/safeReply');
const { buildThemedPanelPayload } = require('../../utils/panelTheme');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const NOTICE_FIXED_ROLE_IDS = [
  '1201193356810780773',
];
const NOTICE_MAIN_CHANNEL_ID = '1482190594003439678';
const NOTICE_ALERT_CHANNEL_ID = '1481598629365022800';
const NOTICE_ALERT_ROLE_ID = '1201193356810780773';
const CUSTOM_IDS = {
  selectChannel: 'avisos_select_channel',
  selectUser: 'avisos_select_user',
  guild: 'avisos_send_guild',
  global: 'avisos_send_global',
  direct: 'avisos_send_direct',
};
const selections = new Map();

function canUseAvisos(interaction) {
  return hasAnyVortexRole(interaction.member)
    || hasVortexAccess(interaction.member, ['admin', 'medio'])
    || hasCommandRole(interaction.member, 'avisos');
}

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function getSelection(interaction) {
  const key = getSelectionKey(interaction);
  if (!selections.has(key)) {
    selections.set(key, {
      channelId: null,
      userId: null,
    });
  }
  return selections.get(key);
}

function getNoticeMentionRoleIds() {
  return NOTICE_FIXED_ROLE_IDS;
}

function buildNoticeMentionPayload(interaction, { includeUser = false } = {}) {
  const selection = getSelection(interaction);
  const roleIds = getNoticeMentionRoleIds(interaction);
  const userIds = includeUser && selection.userId ? [selection.userId] : [];
  const mentions = [
    ...roleIds.map((roleId) => `<@&${roleId}>`),
    ...userIds.map((userId) => `<@${userId}>`),
  ];

  return {
    content: mentions.join(' '),
    allowedMentions: { roles: roleIds, users: userIds },
  };
}

function getSelectionKey(interaction) {
  return `${interaction.guildId}:${interaction.user.id}`;
}

function buildPanelEmbed(interaction) {
  return new EmbedBuilder()
    .setColor('#7000FF')
    .setAuthor({
      name: 'VORTEX | Avisos',
      iconURL: interaction.guild?.iconURL() || interaction.client.user.displayAvatarURL(),
    })
    .setTitle('📢 Painel de Avisos')
    .setDescription([
      '**Envie comunicados oficiais para usuários, canais ou todo o servidor.**',
      '',
      `Avisos enviados em canal mencionam apenas <@&${NOTICE_FIXED_ROLE_IDS[0]}>.`,
      '',
      'Selecione um canal para aviso local ou um usuário para aviso individual.',
    ].join('\n'))
    .addFields(
      { name: '👤 Individual', value: 'Envia DM para o usuário selecionado.', inline: true },
      { name: '📍 Local', value: 'Publica no canal selecionado.', inline: true },
      { name: '🌐 Global', value: 'Envia DM para todos do servidor.', inline: true }
    )
    .setFooter({ text: `Solicitado por ${interaction.user.tag}` })
    .setTimestamp();
}

function buildPanelComponents() {
  const selectRow = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId(CUSTOM_IDS.selectChannel)
      .setPlaceholder('Selecionar canal do aviso local')
      .addChannelTypes(ChannelType.GuildText)
      .setMinValues(1)
      .setMaxValues(1)
  );

  const userRow = new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId(CUSTOM_IDS.selectUser)
      .setPlaceholder('Selecionar usuário do aviso individual')
      .setMinValues(1)
      .setMaxValues(1)
  );

  const buttonRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(CUSTOM_IDS.direct)
      .setLabel('Enviar individual')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(CUSTOM_IDS.guild)
      .setLabel('Enviar local')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(CUSTOM_IDS.global)
      .setLabel('Enviar global')
      .setStyle(ButtonStyle.Danger)
  );

  return [selectRow, userRow, buttonRow];
}

function buildMessageModal(scope) {
  const isGlobal = scope === 'global';
  const isDirect = scope === 'direct';
  const modal = new ModalBuilder()
    .setCustomId(`avisos_modal_${scope}`)
    .setTitle(isGlobal ? 'Aviso global' : isDirect ? 'Aviso individual' : 'Aviso local');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('title')
        .setLabel('Título do aviso')
        .setPlaceholder('Exemplo: Reunião geral hoje')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(120)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('message')
        .setLabel('Mensagem')
        .setPlaceholder('Digite o comunicado que será enviado.')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(1800)
    )
  );

  return modal;
}

function buildNoticeEmbed(interaction, title, message, scopeLabel, scope) {
  const selection = getSelection(interaction);
  const fields = [];

  if ((scope === 'guild' || scope === 'direct') && selection.userId) {
    fields.push({ name: 'Usuário relacionado', value: `<@${selection.userId}>`, inline: true });
  }

  const embed = new EmbedBuilder()
    .setColor('#7000FF')
    .setTitle(title)
    .setDescription(message)
    .setFooter({ text: 'Vortex Management System' })
    .setTimestamp();

  if (fields.length) {
    embed.addFields(fields);
  }

  return embed;
}

function buildNoticePayloads(embed) {
  return [buildThemedPanelPayload('avisos', embed)];
}

async function getSelectedChannel(interaction) {
  const selection = getSelection(interaction);
  const channelId = selection.channelId;
  if (!channelId) return null;

  const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildText) {
    selection.channelId = null;
    return null;
  }

  return channel;
}

async function getGuildRecipients(guild) {
  const members = await guild.members.fetch();
  return members
    .filter((member) => !member.user.bot)
    .map((member) => member.user);
}

async function getSelectedUser(interaction) {
  const userId = getSelection(interaction).userId;
  if (!userId) return null;
  return interaction.client.users.fetch(userId).catch(() => null);
}

async function sendChannelNotice(interaction, channel, embed, options = {}) {
  try {
    const mentionPayload = buildNoticeMentionPayload(interaction, options);
    await channel.send(buildThemedPanelPayload('avisos', embed, {
      headerText: mentionPayload.content,
      allowedMentions: mentionPayload.allowedMentions,
    }));

    return true;
  } catch {
    return false;
  }
}

async function sendNoticeChannelAlert(interaction, scopeLabel) {
  const channel = await interaction.guild.channels.fetch(NOTICE_ALERT_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased?.()) return false;

  await channel.send({
    content: [
      `<@&${NOTICE_ALERT_ROLE_ID}>`,
      `olhe o canal de avisos <#${NOTICE_MAIN_CHANNEL_ID}>.`,
      `Você tem uma mensagem importante nova. Tipo: **${scopeLabel}**.`,
    ].join(' '),
    allowedMentions: { roles: [NOTICE_ALERT_ROLE_ID] },
  }).catch(() => null);

  return true;
}

async function sendDmBatch(users, payloads) {
  let sent = 0;
  let failed = 0;

  for (const user of users) {
    try {
      for (const payload of payloads) {
        await user.send(payload);
      }
      sent += 1;
    } catch {
      failed += 1;
    }
  }

  return { sent, failed, total: users.length };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('avisos')
    .setDescription('Abre o painel para enviar avisos por DM.')
    .setDefaultMemberPermissions(null)
    .setDMPermission(false),

  async execute(interaction) {
    if (!canUseAvisos(interaction)) {
      return safeReply(interaction, { content: '❌ Você precisa estar cadastrado no sistema para usar o /avisos.', ephemeral: true });
    }

    return safeReply(interaction, buildThemedPanelPayload('avisos', buildPanelEmbed(interaction), {
      components: buildPanelComponents(),
    }));
  },

  async handleSelectMenu(interaction) {
    if (!canUseAvisos(interaction)) {
      return safeReply(interaction, { content: '❌ Sem permissão.', ephemeral: true });
    }

    const selection = getSelection(interaction);

    if (interaction.customId === CUSTOM_IDS.selectUser) {
      const user = interaction.users?.first?.() || await interaction.client.users.fetch(interaction.values[0]).catch(() => null);
      if (!user || user.bot) {
        return safeReply(interaction, { content: '❌ Selecione um usuário válido.', ephemeral: true });
      }

      selection.userId = user.id;
      return safeReply(interaction, { content: `✅ Usuário selecionado para aviso individual: <@${user.id}>`, ephemeral: true });
    }

    if (interaction.customId === CUSTOM_IDS.selectChannel) {
      const channel = interaction.channels?.first?.() || await interaction.guild.channels.fetch(interaction.values[0]).catch(() => null);
      if (!channel || channel.type !== ChannelType.GuildText) {
        return safeReply(interaction, { content: '❌ Selecione um canal de texto válido.', ephemeral: true });
      }

      selection.channelId = channel.id;
      return safeReply(interaction, { content: `✅ Canal selecionado: <#${channel.id}>`, ephemeral: true });
    }

    return null;
  },

  async handleButton(interaction) {
    if (!canUseAvisos(interaction)) {
      return safeReply(interaction, { content: '❌ Sem permissão.', ephemeral: true });
    }

    if (interaction.customId === CUSTOM_IDS.global && loadConfig().DISABLE_NOTICE_DMS === true) {
      return safeReply(interaction, {
        content: '❌ O modo de avisos por DM está desativado. Somente Henri | Duke pode reativar no /painel.',
        ephemeral: true,
      });
    }

    if (interaction.customId === CUSTOM_IDS.guild) {
      const selectedChannel = await getSelectedChannel(interaction);
      if (!selectedChannel) {
        return safeReply(interaction, { content: '❌ Selecione um canal de texto antes de enviar o aviso local.', ephemeral: true });
      }
      return safeShowModal(interaction, buildMessageModal('guild'));
    }

    if (interaction.customId === CUSTOM_IDS.direct) {
      const selectedUser = await getSelectedUser(interaction);
      if (!selectedUser) {
        return safeReply(interaction, { content: '❌ Selecione um usuário antes de enviar o aviso individual.', ephemeral: true });
      }
      return safeShowModal(interaction, buildMessageModal('direct'));
    }

    if (interaction.customId === CUSTOM_IDS.global) {
      return safeShowModal(interaction, buildMessageModal('global'));
    }

    return null;
  },

  async handleModal(interaction) {
    if (!canUseAvisos(interaction)) {
      return safeReply(interaction, { content: '❌ Sem permissão.', ephemeral: true });
    }

    const scope = interaction.customId === 'avisos_modal_global'
      ? 'global'
      : interaction.customId === 'avisos_modal_direct'
        ? 'direct'
        : 'guild';
    const title = interaction.fields.getTextInputValue('title').trim();
    const message = interaction.fields.getTextInputValue('message').trim();
    const scopeLabel = scope === 'global' ? 'Global Vortex' : scope === 'direct' ? 'Individual' : 'Local';

    await safeDeferReply(interaction, { ephemeral: true });

    if (scope === 'global' && loadConfig().DISABLE_NOTICE_DMS === true) {
      return safeEdit(interaction, { content: '❌ O modo de avisos por DM está desativado. Somente Henri | Duke pode reativar no /painel.' });
    }

    const noticeEmbed = buildNoticeEmbed(interaction, title, message, scopeLabel, scope);
    const noticePayloads = buildNoticePayloads(noticeEmbed);
    let channelSent = false;
    let result = { sent: 0, failed: 0, total: 0 };

    if (scope === 'guild') {
      const selectedChannel = await getSelectedChannel(interaction);
      if (!selectedChannel) {
        return safeEdit(interaction, { content: '❌ Selecione um canal de texto antes de enviar o aviso local.' });
      }
      channelSent = await sendChannelNotice(interaction, selectedChannel, noticeEmbed, {
        includeUser: Boolean(getSelection(interaction).userId),
      });
    }

    if (scope === 'direct') {
      const selectedUser = await getSelectedUser(interaction);
      if (!selectedUser) {
        return safeEdit(interaction, { content: '❌ Selecione um usuário antes de enviar o aviso individual.' });
      }
      result = await sendDmBatch([selectedUser], noticePayloads);
    }

    if (scope === 'global') {
      const recipients = await getGuildRecipients(interaction.guild);
      if (recipients.length === 0) {
        return safeEdit(interaction, { content: '❌ Nenhum membro encontrado para receber o aviso por DM.' });
      }
      result = await sendDmBatch(recipients, noticePayloads);
    }

    if (scope === 'guild' || scope === 'global') {
      await sendNoticeChannelAlert(interaction, scopeLabel);
    }

    sendVortexLog(interaction.client, {
      title: scope === 'global' ? 'Aviso Global Enviado' : 'Aviso Local Enviado',
      description: [
        `**Staff:** <@${interaction.user.id}> (${interaction.user.id})`,
        `**Alcance:** ${scopeLabel}`,
        scope === 'guild' && getSelection(interaction).channelId ? `**Canal:** <#${getSelection(interaction).channelId}> (${getSelection(interaction).channelId})` : null,
        (scope === 'guild' || scope === 'direct') && getSelection(interaction).userId ? `**Usuário relacionado:** <@${getSelection(interaction).userId}> (${getSelection(interaction).userId})` : null,
        `**Titulo:** ${title}`,
        `**Mensagem no canal:** ${channelSent ? 'sim' : 'não'}`,
        scope === 'global' ? `**Total DM:** ${result.total}` : null,
        scope === 'global' ? `**DMs enviadas:** ${result.sent}` : null,
        scope === 'global' ? `**Falhas DM:** ${result.failed}` : null,
      ].filter(Boolean).join('\n'),
      color: '#7000FF',
      type: 'AVISOS',
      userId: interaction.user.id,
      channelId: interaction.channelId,
      relatedChannelIds: [
        getSelection(interaction).channelId,
      ].filter(Boolean),
    }).catch(() => {});

    const summary = [
      '✅ Aviso finalizado.',
      `Alcance: **${scopeLabel}**`,
      scope === 'guild' ? `Canal: <#${getSelection(interaction).channelId}>` : null,
      scope === 'guild' ? `Mensagem no canal: **${channelSent ? 'enviada' : 'falhou'}**` : 'Mensagem no canal: **não enviada**',
    ];

    if ((scope === 'guild' || scope === 'direct') && getSelection(interaction).userId) {
      summary.push(
        `Usuário relacionado: <@${getSelection(interaction).userId}>`
      );
    }

    if (scope === 'global' || scope === 'direct') {
      summary.push(
        `Total encontrado: **${result.total}**`,
        `DMs enviadas: **${result.sent}**`,
        `Falhas: **${result.failed}**`
      );
    }

    return safeEdit(interaction, {
      content: summary.join('\n'),
    });
  },
};
