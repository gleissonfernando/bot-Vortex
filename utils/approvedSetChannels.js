const fs = require('fs');
const path = require('path');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { logger } = require('./logger');
const { safeReply, safeUpdate } = require('./safeReply');

const APPROVED_SET_CATEGORY_ID = '1460410814744887531';
const APPROVED_SET_CHANNELS_PATH = path.join(__dirname, '..', 'commands', 'approvedSetChannels.json');
const CONFIG_PATH = path.join(__dirname, '..', 'commands', 'config.json');
const STAFF_ROLE_ID = '1497703127074345040';

function ensureFile() {
  if (!fs.existsSync(APPROVED_SET_CHANNELS_PATH)) {
    fs.writeFileSync(APPROVED_SET_CHANNELS_PATH, `${JSON.stringify({}, null, 2)}\n`, 'utf8');
  }
}

function readChannels() {
  ensureFile();
  try {
    return JSON.parse(fs.readFileSync(APPROVED_SET_CHANNELS_PATH, 'utf8') || '{}');
  } catch (error) {
    logger.error('Erro ao ler approvedSetChannels.json:', error);
    return {};
  }
}

function writeChannels(data) {
  ensureFile();
  fs.writeFileSync(APPROVED_SET_CHANNELS_PATH, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function sanitizeChannelName(value) {
  return String(value || 'usuario')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70) || 'usuario';
}

function stripGameIdFromName(value) {
  return String(value || '')
    .replace(/\s*\|\s*\d{1,25}\s*$/g, '')
    .trim();
}

function formatApprovedSetDisplayName(profile = {}) {
  const displayName = String(profile.nomeGame || profile.displayName || profile.userName || profile.discordTag || 'usuario').trim();
  return stripGameIdFromName(displayName) || displayName || 'usuario';
}

function formatApprovedSetLevel(profile = {}) {
  return String(profile.nivelGame || '').trim();
}

function buildApprovedSetChannelPayload(profile = {}) {
  const displayName = formatApprovedSetDisplayName(profile);
  const displayLevel = formatApprovedSetLevel(profile);
  const channelNameParts = [sanitizeChannelName(displayName)];

  if (displayLevel) {
    channelNameParts.push(sanitizeChannelName(displayLevel));
  }

  return {
    displayName,
    displayLevel,
    channelName: channelNameParts.join('-').slice(0, 100),
    topic: [
      displayName,
      displayLevel ? `Nível ${displayLevel}` : 'Nível N/A',
      'Canal privado de perfil Vortex',
    ].filter(Boolean).join(' | '),
  };
}

function getManagementRoleIds() {
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8') || '{}');
    const levels = config.VORTEX_ROLE_LEVELS || {};
    return [
      STAFF_ROLE_ID,
      ...(Array.isArray(levels.admin) ? levels.admin : []),
      ...(Array.isArray(levels.medio) ? levels.medio : []),
    ].map(String).filter(Boolean).filter((roleId, index, list) => list.indexOf(roleId) === index);
  } catch {
    return [STAFF_ROLE_ID];
  }
}

async function createApprovedSetChannel(guild, member, { nomeGame = null, idGame = null, nivelGame = null, staffUserId = null } = {}) {
  const category = await guild.channels.fetch(APPROVED_SET_CATEGORY_ID).catch(() => null);
  if (!category || category.type !== ChannelType.GuildCategory) {
    return { ok: false, message: `Categoria <#${APPROVED_SET_CATEGORY_ID}> não encontrada.`, channel: null };
  }

  const data = readChannels();
  const existingId = data[guild.id]?.[member.id]?.channelId;
  const existing = existingId ? await guild.channels.fetch(existingId).catch(() => null) : null;
  if (existing) {
    await syncApprovedSetChannel(guild, {
      userId: member.id,
      callChannelId: existing.id,
      nomeGame: nomeGame || data[guild.id]?.[member.id]?.nomeGame || member.displayName || member.user.username,
      idGame: idGame || data[guild.id]?.[member.id]?.idGame || member.id,
      nivelGame: nivelGame || data[guild.id]?.[member.id]?.nivelGame || null,
    }).catch(() => null);
    return { ok: true, message: 'Canal do usuário aprovado já existia.', channel: existing };
  }

  const profile = {
    userId: member.id,
    nomeGame: nomeGame || member.displayName || member.user.username,
    idGame: idGame || member.id,
    nivelGame: nivelGame || null,
  };
  const payload = buildApprovedSetChannelPayload(profile);
  const managementRoleIds = getManagementRoleIds();
  const channel = await guild.channels.create({
    name: payload.channelName,
    type: ChannelType.GuildText,
    parent: category.id,
    topic: payload.topic,
    permissionOverwrites: [
      {
        id: guild.id,
        deny: [
          PermissionFlagsBits.ViewChannel,
        ],
      },
      {
        id: member.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      },
      {
        id: guild.client.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      },
      ...managementRoleIds.map((roleId) => ({
        id: roleId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      })),
    ],
    reason: `Canal criado para usuário aprovado no /set por ${staffUserId || 'sistema'}`,
  });

  if (!data[guild.id]) data[guild.id] = {};
  data[guild.id][member.id] = {
    channelId: channel.id,
    userId: member.id,
    nomeGame: profile.nomeGame,
    nivelGame: profile.nivelGame,
    createdAt: new Date().toISOString(),
    createdBy: staffUserId ? String(staffUserId) : null,
  };
  writeChannels(data);

  const embed = buildGuideEmbed(member.id, 1);

  await channel.send({
    content: `<@${member.id}>`,
    embeds: [embed],
    components: [buildGuideRow(1)],
    allowedMentions: { users: [member.id] },
  }).catch(() => null);

  await member.send({
    content: `Seu canal de meta foi criado em ${channel}. Leia o tutorial e confirme os passos por lá.`,
  }).catch(() => null);

  return { ok: true, message: 'Canal criado para usuário aprovado.', channel };
}

async function syncApprovedSetChannel(guild, profile = {}, options = {}) {
  const userId = String(profile.userId || '').trim();
  const channelId = String(profile.callChannelId || '').trim();
  if (!userId || !channelId) {
    return { ok: false, reason: 'missing_data' };
  }

  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.edit) {
    return { ok: false, reason: 'missing_channel' };
  }

  const payload = buildApprovedSetChannelPayload({ ...profile, userId });
  const changes = {};

  if (channel.name !== payload.channelName) {
    changes.name = payload.channelName;
  }

  if ((channel.topic || '') !== payload.topic) {
    changes.topic = payload.topic;
  }

  if (Object.keys(changes).length > 0) {
    await channel.edit(changes, {
      reason: `Sincronizar nome da call do perfil de ${userId}${options.reason ? ` - ${options.reason}` : ''}`,
    }).catch((error) => {
      logger.error('Erro ao sincronizar nome da call do perfil:', error);
      return null;
    });
  }

  const data = readChannels();
  if (!data[guild.id]) data[guild.id] = {};
  if (!data[guild.id][userId]) {
    data[guild.id][userId] = { channelId };
  }
  const nextRecord = {
    ...data[guild.id][userId],
    channelId,
    userId,
    nomeGame: profile.nomeGame || data[guild.id][userId].nomeGame || payload.displayName,
    nivelGame: payload.displayLevel || data[guild.id][userId].nivelGame || null,
    updatedAt: new Date().toISOString(),
  };
  delete nextRecord.idGame;
  data[guild.id][userId] = nextRecord;
  writeChannels(data);

  return { ok: true, channel, name: payload.channelName, topic: payload.topic };
}

function buildGuideEmbed(userId, step = 1) {
  const pages = {
    1: {
      title: 'Canal exclusivo de metas',
      description: [
        `<@${userId}>, este canal foi criado exclusivamente para você.`,
        '',
        'Somente você e a gerência conseguem visualizar e acessar este canal.',
        'Fique de olho no seu privado: quando surgir uma mensagem do bot Vortex, responda ou siga a orientação enviada por lá.',
      ],
    },
    2: {
      title: 'Como funciona o /perfil',
      description: [
        'Use `/perfil` no seu canal cadastrado para ver seus dados.',
        'Use `/perfil link:<link da foto> nivel:<numero>` para atualizar sua foto e seu nível.',
        'Perfil sem atualizar pode gerar cobrança e penalidade.',
      ],
    },
    3: {
      title: 'Como funciona o /ponto',
      description: [
        'Abra o ponto quando entrar em serviço e feche quando sair.',
        'Se esquecer de fechar, use o pedido de ajuste de ponto ou fale com a gerência.',
        'Quem ignora confirmações de ponto aberto por DM pode cair em correção e penalidade.',
      ],
    },
    4: {
      title: 'Como funciona a /ausencia',
      description: [
        'Use `/ausencia` quando precisar ficar afastado.',
        'Quem não está em ausência e fica sem bater ponto pode receber cobrança.',
        'Leia sempre as DMs do Vortex. Ignorar informações do bot pode causar penalidade.',
      ],
    },
  };
  const page = pages[step] || pages[1];
  return new EmbedBuilder()
    .setColor('#7000FF')
    .setTitle(page.title)
    .setDescription(page.description.join('\n'))
    .setFooter({ text: `Vortex - Guia inicial ${step}/4` })
    .setTimestamp();
}

function buildGuideRow(step = 1) {
  const nextStep = Number(step) + 1;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(nextStep > 4 ? 'approved_channel_guide_done' : `approved_channel_guide_${nextStep}`)
      .setLabel(nextStep > 4 ? 'Finalizar' : 'Entendi, próximo')
      .setStyle(nextStep > 4 ? ButtonStyle.Success : ButtonStyle.Primary)
  );
}

async function handleApprovedChannelGuide(interaction) {
  const data = readChannels();
  const guildRecords = data[interaction.guildId] || {};
  const record = Object.values(guildRecords).find((item) => item.channelId === interaction.channelId);
  if (record?.userId && record.userId !== interaction.user.id) {
    await interaction.user.send({
      content: `Esse tutorial pertence a <@${record.userId}>. Peça para ele olhar o canal de meta dele: <#${record.channelId}>.`,
      allowedMentions: { users: [record.userId] },
    }).catch(() => null);
    return safeReply(interaction, {
      content: '❌ Apenas o dono deste canal pode usar os botões do tutorial.',
      ephemeral: true,
    });
  }

  const done = interaction.customId === 'approved_channel_guide_done';
  if (done) {
    if (record?.userId && data[interaction.guildId]?.[record.userId]) {
      data[interaction.guildId][record.userId].guideCompletedAt = new Date().toISOString();
      writeChannels(data);
    }
    return safeUpdate(interaction, {
      components: [],
      embeds: [
        new EmbedBuilder()
          .setColor('#57F287')
          .setTitle('Guia concluído')
          .setDescription('Obrigado por confirmar. Fique atento às DMs do bot Vortex e siga as orientações da gerência.')
          .setTimestamp(),
      ],
    });
  }

  const step = Number(interaction.customId.replace('approved_channel_guide_', ''));
  return safeUpdate(interaction, {
    embeds: [buildGuideEmbed(interaction.user.id, step)],
    components: [buildGuideRow(step)],
  });
}

function getApprovedSetChannelRecord(guildId, channelId) {
  const data = readChannels();
  const guildRecords = data[String(guildId)] || {};
  return Object.values(guildRecords).find((item) => String(item.channelId) === String(channelId)) || null;
}

function getApprovedSetChannelRecordByUser(guildId, userId) {
  const data = readChannels();
  return data[String(guildId)]?.[String(userId)] || null;
}

async function deleteApprovedSetChannel(guild, userId, reason = null) {
  const data = readChannels();
  const normalizedUserId = String(userId || '').trim();
  const record = data[guild.id]?.[normalizedUserId];
  if (!record?.channelId) return { ok: false, deleted: false, message: 'Nenhum canal aprovado registrado.' };

  const channel = await guild.channels.fetch(record.channelId).catch(() => null);
  let channelDeleted = false;
  if (channel) {
    await channel.delete(reason || `Usuário ${normalizedUserId} saiu do servidor; canal aprovado removido.`).then(() => {
      channelDeleted = true;
    }).catch((error) => {
      logger.error('Erro ao deletar canal aprovado:', error);
    });
  }

  delete data[guild.id][normalizedUserId];
  if (Object.keys(data[guild.id]).length === 0) delete data[guild.id];
  writeChannels(data);

  return {
    ok: true,
    deleted: channelDeleted,
    message: channelDeleted
      ? 'Canal removido.'
      : channel ? 'Registro removido; canal não foi deletado.' : 'Registro removido; canal não existia.',
  };
}

module.exports = {
  APPROVED_SET_CATEGORY_ID,
  createApprovedSetChannel,
  deleteApprovedSetChannel,
  getApprovedSetChannelRecord,
  getApprovedSetChannelRecordByUser,
  handleApprovedChannelGuide,
  syncApprovedSetChannel,
};
