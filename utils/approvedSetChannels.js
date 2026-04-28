const fs = require('fs');
const path = require('path');
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { logger } = require('./logger');

const APPROVED_SET_CATEGORY_ID = '1460410814744887531';
const APPROVED_SET_CHANNELS_PATH = path.join(__dirname, '..', 'commands', 'approvedSetChannels.json');
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

async function createApprovedSetChannel(guild, member, { nomeGame = null, idGame = null, staffUserId = null } = {}) {
  const category = await guild.channels.fetch(APPROVED_SET_CATEGORY_ID).catch(() => null);
  if (!category || category.type !== ChannelType.GuildCategory) {
    return { ok: false, message: `Categoria <#${APPROVED_SET_CATEGORY_ID}> nao encontrada.`, channel: null };
  }

  const data = readChannels();
  const existingId = data[guild.id]?.[member.id]?.channelId;
  const existing = existingId ? await guild.channels.fetch(existingId).catch(() => null) : null;
  if (existing) {
    return { ok: true, message: 'Canal do usuario aprovado ja existia.', channel: existing };
  }

  const displayName = nomeGame || member.displayName || member.user.username;
  const displayId = idGame || member.id;
  const channel = await guild.channels.create({
    name: `${sanitizeChannelName(displayName)}-${sanitizeChannelName(displayId)}`.slice(0, 100),
    type: ChannelType.GuildText,
    parent: category.id,
    topic: `${displayName} | ${displayId} | Discord: ${member.id}`,
    permissionOverwrites: [
      {
        id: guild.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.ReadMessageHistory,
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
      {
        id: STAFF_ROLE_ID,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      },
    ],
    reason: `Canal criado para usuario aprovado no /set por ${staffUserId || 'sistema'}`,
  });

  if (!data[guild.id]) data[guild.id] = {};
  data[guild.id][member.id] = {
    channelId: channel.id,
    userId: member.id,
    nomeGame: displayName,
    idGame: displayId,
    createdAt: new Date().toISOString(),
    createdBy: staffUserId ? String(staffUserId) : null,
  };
  writeChannels(data);

  await channel.send({
    content: `<@${member.id}>`,
    allowedMentions: { users: [member.id] },
  }).catch(() => null);

  return { ok: true, message: 'Canal criado para usuario aprovado.', channel };
}

async function deleteApprovedSetChannel(guild, userId) {
  const data = readChannels();
  const record = data[guild.id]?.[userId];
  if (!record?.channelId) return { ok: false, deleted: false, message: 'Nenhum canal aprovado registrado.' };

  const channel = await guild.channels.fetch(record.channelId).catch(() => null);
  if (channel) {
    await channel.delete(`Usuario ${userId} saiu do servidor; canal aprovado removido.`).catch((error) => {
      logger.error('Erro ao deletar canal aprovado:', error);
    });
  }

  delete data[guild.id][userId];
  if (Object.keys(data[guild.id]).length === 0) delete data[guild.id];
  writeChannels(data);

  return { ok: true, deleted: Boolean(channel), message: channel ? 'Canal removido.' : 'Registro removido; canal nao existia.' };
}

module.exports = {
  APPROVED_SET_CATEGORY_ID,
  createApprovedSetChannel,
  deleteApprovedSetChannel,
};
