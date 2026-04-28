const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  RoleSelectMenuBuilder,
  UserSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const path = require('path');
const fs = require('fs');
const { isGerencia } = require('../../utils/permissions');
const { sendVortexLog } = require('../../utils/notifications');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const NOTICE_FIXED_ROLE_IDS = [
  '1201235607549124639',
  '1212944805055692840',
  '1201238799494152344',
  '1201320710459629600',
];
const CUSTOM_IDS = {
  selectChannel: 'avisos_select_channel',
  selectUser: 'avisos_select_user',
  selectRole: 'avisos_select_role',
  selectCall: 'avisos_select_call',
  guild: 'avisos_send_guild',
  global: 'avisos_send_global',
  direct: 'avisos_send_direct',
};
const selections = new Map();
const VORTEX_PANEL_IMAGE = path.join(__dirname, '..', '..', 'foto', 'IMG_4234.png');
const VORTEX_PANEL_IMAGE_NAME = 'IMG_4234.png';

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
      roleIds: [],
      callId: null,
    });
  }
  return selections.get(key);
}

function getNoticeMentionRoleIds(interaction) {
  const conf = loadConfig();
  const selected = interaction ? getSelection(interaction) : {};
  return [...new Set([
    ...NOTICE_FIXED_ROLE_IDS,
    conf.NOTICE_MENTION_ROLE_ID,
    ...(selected.roleIds || []),
  ].filter(Boolean).map(String))];
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

function withPanelImage(options) {
  return {
    ...options,
    files: [{ attachment: VORTEX_PANEL_IMAGE, name: VORTEX_PANEL_IMAGE_NAME }],
  };
}

function buildPanelEmbed(interaction) {
  return new EmbedBuilder()
    .setColor('#7000FF')
    .setAuthor({
      name: 'VORTEX | Aviso Oficial',
      iconURL: interaction.guild?.iconURL() || interaction.client.user.displayAvatarURL(),
    })
    .setTitle('Vortex informa')
    .setDescription([
      'Use este painel para enviar avisos oficiais com foto, mencoes e explicacoes completas.',
      '',
      '**Como funciona**',
      '1. Selecione o canal de texto onde o aviso sera publicado.',
      '2. Se quiser relacionar uma pessoa ao aviso local, pesquise e selecione o usuario pelo nome.',
      '3. Selecione cargos extras para mencionar, alem dos cargos fixos do sistema.',
      '4. Selecione a call quando o aviso estiver ligado a uma reuniao ou atendimento.',
      '5. Se quiser, adicione um link de imagem do Discord para aparecer no aviso. Esse campo nao e obrigatorio.',
      '6. Individual envia DM para o usuario selecionado. Local publica no canal selecionado. Global envia DM para todos.',
      '',
      '**Importante**',
      'A imagem oficial da Vortex continua fixa no aviso principal. Se um link de imagem for informado, ele sera exibido em um bloco extra do aviso. Alguns usuarios podem estar com a DM fechada; nesses casos, o bot contabiliza como falha e continua.',
    ].join('\n'))
    .addFields(
      { name: 'Individual', value: 'Envia direto no privado do usuario selecionado.', inline: true },
      { name: 'Local', value: 'Envia somente no canal selecionado.', inline: true },
      { name: 'Global Vortex', value: 'Envia DM para todos deste Discord.', inline: true },
      { name: 'Usuario selecionado', value: 'Quando preenchido, aparece e pode ser mencionado no aviso local.', inline: true }
    )
    .setImage(`attachment://${VORTEX_PANEL_IMAGE_NAME}`)
    .setFooter({ text: `Solicitado por ${interaction.user.tag}` })
    .setTimestamp();
}

function buildPanelComponents() {
  const selectRow = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId(CUSTOM_IDS.selectChannel)
      .setPlaceholder('Selecione o canal de texto que vai receber o aviso')
      .addChannelTypes(ChannelType.GuildText)
      .setMinValues(1)
      .setMaxValues(1)
  );

  const userRow = new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId(CUSTOM_IDS.selectUser)
      .setPlaceholder('Pesquise e selecione o usuario para aviso individual')
      .setMinValues(1)
      .setMaxValues(1)
  );

  const roleRow = new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId(CUSTOM_IDS.selectRole)
      .setPlaceholder('Selecione cargos extras para mencionar no aviso')
      .setMinValues(0)
      .setMaxValues(5)
  );

  const callRow = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId(CUSTOM_IDS.selectCall)
      .setPlaceholder('Selecione a call relacionada ao aviso')
      .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
      .setMinValues(1)
      .setMaxValues(1)
  );

  const buttonRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(CUSTOM_IDS.direct)
      .setLabel('Enviar Individual')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(CUSTOM_IDS.guild)
      .setLabel('Enviar Local')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(CUSTOM_IDS.global)
      .setLabel('Enviar Global Vortex')
      .setStyle(ButtonStyle.Danger)
  );

  return [selectRow, userRow, roleRow, callRow, buttonRow];
}

function buildMessageModal(scope) {
  const isGlobal = scope === 'global';
  const isDirect = scope === 'direct';
  const modal = new ModalBuilder()
    .setCustomId(`avisos_modal_${scope}`)
    .setTitle(isGlobal ? 'Aviso Global Vortex' : isDirect ? 'Aviso Individual' : 'Aviso para este Discord');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('title')
        .setLabel('TITULO DO AVISO')
        .setPlaceholder('Ex: Reuniao geral hoje')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(120)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('message')
        .setLabel('MENSAGEM')
        .setPlaceholder('Digite o aviso que sera enviado')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(1800)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('image_url')
        .setLabel('LINK DA IMAGEM DO DISCORD (OPCIONAL)')
        .setPlaceholder('Cole o link direto da imagem, se quiser incluir uma foto')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(500)
    )
  );

  return modal;
}

function withNoticeImage(payload) {
  return {
    ...payload,
    files: [{ attachment: VORTEX_PANEL_IMAGE, name: VORTEX_PANEL_IMAGE_NAME }],
  };
}

function isDirectImageUrl(value) {
  return /^https?:\/\/.+\.(png|jpe?g|gif|webp)(\?.*)?$/i.test(value)
    || /^https?:\/\/cdn\.discordapp\.com\/attachments\//i.test(value)
    || /^https?:\/\/media\.discordapp\.net\//i.test(value);
}

function parseDiscordMessageLink(value) {
  const match = String(value).match(
    /^https?:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)$/i
  );
  if (!match) return null;

  return {
    guildId: match[1],
    channelId: match[2],
    messageId: match[3],
  };
}

async function resolveOptionalImageUrl(interaction, rawValue) {
  const value = rawValue?.trim();
  if (!value) return null;

  if (isDirectImageUrl(value)) {
    return value;
  }

  const parsed = parseDiscordMessageLink(value);
  if (!parsed) {
    return null;
  }

  if (parsed.guildId !== interaction.guildId) {
    return null;
  }

  const channel = await interaction.guild.channels.fetch(parsed.channelId).catch(() => null);
  if (!channel || !channel.isTextBased?.()) {
    return null;
  }

  const message = await channel.messages.fetch(parsed.messageId).catch(() => null);
  if (!message) {
    return null;
  }

  const attachment = message.attachments.find((item) => {
    const name = item.name || '';
    const url = item.url || '';
    return item.contentType?.startsWith('image/')
      || /\.(png|jpe?g|gif|webp)(\?.*)?$/i.test(name)
      || isDirectImageUrl(url);
  });

  if (attachment?.url) {
    return attachment.url;
  }

  const embedImage = message.embeds
    .map((embed) => embed.image?.url || embed.thumbnail?.url)
    .find(Boolean);

  return embedImage || null;
}

function buildNoticeEmbed(interaction, title, message, scopeLabel, scope) {
  const selection = getSelection(interaction);
  const fields = [
    { name: 'Origem', value: interaction.guild?.name || 'Vortex', inline: true },
    { name: 'Alcance', value: scopeLabel, inline: true },
    { name: 'Enviado por', value: `<@${interaction.user.id}>`, inline: true },
  ];

  if ((scope === 'guild' || scope === 'direct') && selection.userId) {
    fields.push({ name: 'Usuario relacionado', value: `<@${selection.userId}>`, inline: true });
  }
  if (selection.roleIds?.length) {
    fields.push({ name: 'Cargos extras', value: selection.roleIds.map((roleId) => `<@&${roleId}>`).join(' '), inline: true });
  }
  if (selection.callId) {
    fields.push({ name: 'Call relacionada', value: `<#${selection.callId}>`, inline: true });
  }

  return new EmbedBuilder()
    .setColor('#7000FF')
    .setAuthor({
      name: 'VORTEX | Aviso Oficial',
      iconURL: interaction.client.user.displayAvatarURL(),
    })
    .setTitle(`Vortex informa | ${title}`)
    .setDescription([
      '### Vortex informa',
      '',
      message,
    ].join('\n'))
    .addFields(fields)
    .setImage(`attachment://${VORTEX_PANEL_IMAGE_NAME}`)
    .setFooter({ text: 'Vortex Management System' })
    .setTimestamp();
}

function buildOptionalImageEmbed(interaction, imageUrl) {
  if (!imageUrl) return null;

  return new EmbedBuilder()
    .setColor('#111111')
    .setAuthor({
      name: 'VORTEX | Imagem do Aviso',
      iconURL: interaction.client.user.displayAvatarURL(),
    })
    .setTitle('Midia vinculada ao aviso')
    .setImage(imageUrl)
    .setFooter({ text: 'Vortex Management System' })
    .setTimestamp();
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

async function sendChannelNotice(interaction, channel, payload, options = {}) {
  try {
    await channel.send({
      ...buildNoticeMentionPayload(interaction, options),
      ...payload,
    });
    return true;
  } catch {
    return false;
  }
}

async function sendDmBatch(users, payload) {
  let sent = 0;
  let failed = 0;

  for (const user of users) {
    try {
      await user.send(payload);
      sent += 1;
    } catch {
      failed += 1;
    }
  }

  return { sent, failed, total: users.length };
}

async function safeReply(interaction, options) {
  if (interaction.replied || interaction.deferred) {
    return interaction.followUp(options).catch(() => null);
  }
  return interaction.reply(options).catch(() => null);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('avisos')
    .setDescription('Abre o painel para enviar avisos por DM.'),

  async execute(interaction) {
    if (!isGerencia(interaction)) {
      return safeReply(interaction, { content: '❌ Você não tem permissão para usar o sistema de avisos.', ephemeral: true });
    }

    return safeReply(interaction, withPanelImage({
      embeds: [buildPanelEmbed(interaction)],
      components: buildPanelComponents(),
      ephemeral: true,
    }));
  },

  async handleSelectMenu(interaction) {
    if (!isGerencia(interaction)) {
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

    if (interaction.customId === CUSTOM_IDS.selectRole) {
      selection.roleIds = interaction.values.map(String);
      return safeReply(interaction, {
        content: selection.roleIds.length
          ? `✅ Cargos extras selecionados: ${selection.roleIds.map((roleId) => `<@&${roleId}>`).join(' ')}`
          : '✅ Nenhum cargo extra selecionado.',
        ephemeral: true,
      });
    }

    if (interaction.customId === CUSTOM_IDS.selectCall) {
      const call = interaction.channels?.first?.() || await interaction.guild.channels.fetch(interaction.values[0]).catch(() => null);
      if (!call || ![ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(call.type)) {
        return safeReply(interaction, { content: '❌ Selecione uma call válida.', ephemeral: true });
      }

      selection.callId = call.id;
      return safeReply(interaction, { content: `✅ Call selecionada: <#${call.id}>`, ephemeral: true });
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
    if (!isGerencia(interaction)) {
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
      return interaction.showModal(buildMessageModal('guild'));
    }

    if (interaction.customId === CUSTOM_IDS.direct) {
      const selectedUser = await getSelectedUser(interaction);
      if (!selectedUser) {
        return safeReply(interaction, { content: '❌ Selecione um usuario antes de enviar o aviso individual.', ephemeral: true });
      }
      return interaction.showModal(buildMessageModal('direct'));
    }

    if (interaction.customId === CUSTOM_IDS.global) {
      return interaction.showModal(buildMessageModal('global'));
    }

    return null;
  },

  async handleModal(interaction) {
    if (!isGerencia(interaction)) {
      return safeReply(interaction, { content: '❌ Sem permissão.', ephemeral: true });
    }

    const scope = interaction.customId === 'avisos_modal_global'
      ? 'global'
      : interaction.customId === 'avisos_modal_direct'
        ? 'direct'
        : 'guild';
    const title = interaction.fields.getTextInputValue('title').trim();
    const message = interaction.fields.getTextInputValue('message').trim();
    const rawImageUrl = interaction.fields.getTextInputValue('image_url')?.trim();
    const scopeLabel = scope === 'global' ? 'Global Vortex' : scope === 'direct' ? 'Individual' : 'Local';

    await interaction.deferReply({ ephemeral: true });

    if (scope === 'global' && loadConfig().DISABLE_NOTICE_DMS === true) {
      return interaction.editReply({ content: '❌ O modo de avisos por DM está desativado. Somente Henri | Duke pode reativar no /painel.' });
    }

    const imageUrl = await resolveOptionalImageUrl(interaction, rawImageUrl);
    const noticeEmbed = buildNoticeEmbed(interaction, title, message, scopeLabel, scope);
    const imageEmbed = buildOptionalImageEmbed(interaction, imageUrl);
    const noticeEmbeds = imageEmbed ? [noticeEmbed, imageEmbed] : [noticeEmbed];
    let channelSent = false;
    let result = { sent: 0, failed: 0, total: 0 };

    if (scope === 'guild') {
      const selectedChannel = await getSelectedChannel(interaction);
      if (!selectedChannel) {
        return interaction.editReply({ content: '❌ Selecione um canal de texto antes de enviar o aviso local.' });
      }
      channelSent = await sendChannelNotice(interaction, selectedChannel, withNoticeImage({ embeds: noticeEmbeds }), {
        includeUser: Boolean(getSelection(interaction).userId),
      });
    }

    if (scope === 'direct') {
      const selectedUser = await getSelectedUser(interaction);
      if (!selectedUser) {
        return interaction.editReply({ content: '❌ Selecione um usuario antes de enviar o aviso individual.' });
      }
      result = await sendDmBatch([selectedUser], withNoticeImage({ embeds: noticeEmbeds }));
    }

    if (scope === 'global') {
      const recipients = await getGuildRecipients(interaction.guild);
      if (recipients.length === 0) {
        return interaction.editReply({ content: '❌ Nenhum membro encontrado para receber o aviso por DM.' });
      }
      result = await sendDmBatch(recipients, withNoticeImage({ embeds: noticeEmbeds }));
    }

    sendVortexLog(interaction.client, {
      title: scope === 'global' ? 'Aviso Global Enviado' : 'Aviso Local Enviado',
      description: [
        `**Staff:** <@${interaction.user.id}> (${interaction.user.id})`,
        `**Alcance:** ${scopeLabel}`,
        scope === 'guild' && getSelection(interaction).channelId ? `**Canal:** <#${getSelection(interaction).channelId}> (${getSelection(interaction).channelId})` : null,
        (scope === 'guild' || scope === 'direct') && getSelection(interaction).userId ? `**Usuario relacionado:** <@${getSelection(interaction).userId}> (${getSelection(interaction).userId})` : null,
        getSelection(interaction).roleIds?.length ? `**Cargos extras:** ${getSelection(interaction).roleIds.map((roleId) => `<@&${roleId}>`).join(' ')}` : null,
        getSelection(interaction).callId ? `**Call:** <#${getSelection(interaction).callId}> (${getSelection(interaction).callId})` : null,
        `**Titulo:** ${title}`,
        imageUrl ? `**Imagem opcional:** ${imageUrl}` : null,
        `**Mensagem no canal:** ${channelSent ? 'sim' : 'nao'}`,
        scope === 'global' ? `**Total DM:** ${result.total}` : null,
        scope === 'global' ? `**DMs enviadas:** ${result.sent}` : null,
        scope === 'global' ? `**Falhas DM:** ${result.failed}` : null,
      ].filter(Boolean).join('\n'),
      color: '#7000FF',
      type: 'AVISOS',
      userId: interaction.user.id,
    }).catch(() => {});

    const summary = [
      '✅ Aviso finalizado.',
      `Alcance: **${scopeLabel}**`,
      scope === 'guild' ? `Canal: <#${getSelection(interaction).channelId}>` : null,
      scope === 'guild' ? `Mensagem no canal: **${channelSent ? 'enviada' : 'falhou'}**` : 'Mensagem no canal: **nao enviada**',
    ];

    if (imageUrl) {
      summary.push(`Imagem opcional: ${imageUrl}`);
    }

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

    return interaction.editReply({
      content: summary.join('\n'),
    });
  },
};
