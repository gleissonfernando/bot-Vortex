const fs = require('fs');
const path = require('path');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { listGuildPoints, formatPanelDate } = require('./pontoManager');
const { logger } = require('./logger');

const PANEL_PATH = path.join(__dirname, '..', 'commands', 'pontoPanels.json');
const CONFIG_PATH = path.join(__dirname, '..', 'commands', 'config.json');
const DEFAULT_PONTO_ACTION_CHANNEL_ID = '1498087608390127806';
const PONTO_ONLINE_CHANNEL_ID = '1498087749784178708';
const DEFAULT_PONTO_ADJUST_CATEGORY_ID = '1498087442304073870';
const VORTEX_PANEL_IMAGE_NAME = 'IMG_4234.png';
let statusPanelInterval = null;

function pad(value, size) {
  const text = String(value || '');
  return text.length > size ? text.slice(0, size - 1) + '…' : text.padEnd(size, ' ');
}

function ensureFile() {
  if (!fs.existsSync(PANEL_PATH)) {
    fs.writeFileSync(PANEL_PATH, `${JSON.stringify({}, null, 2)}\n`, 'utf8');
  }
}

function readPanels() {
  ensureFile();
  try {
    return JSON.parse(fs.readFileSync(PANEL_PATH, 'utf8') || '{}');
  } catch {
    return {};
  }
}

function writePanels(data) {
  ensureFile();
  fs.writeFileSync(PANEL_PATH, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8') || '{}');
  } catch {
    return {};
  }
}

function getPointConfig() {
  const config = readConfig();
  return {
    actionChannelId: String(config.POINT_ACTION_CHANNEL_ID || DEFAULT_PONTO_ACTION_CHANNEL_ID),
    statusChannelId: String(config.POINT_ONLINE_CHANNEL_ID || PONTO_ONLINE_CHANNEL_ID),
    adjustCategoryId: String(config.POINT_ADJUST_CATEGORY_ID || DEFAULT_PONTO_ADJUST_CATEGORY_ID),
    adjustStaffRoleIds: Array.isArray(config.POINT_ADJUST_STAFF_ROLES)
      ? config.POINT_ADJUST_STAFF_ROLES.map(String)
      : [],
  };
}

function savePanel(guildId, data) {
  const panels = readPanels();
  panels[guildId] = data;
  writePanels(panels);
}

function getPanel(guildId) {
  return readPanels()[guildId] || null;
}

function createControlEmbed() {
  return new EmbedBuilder()
    .setColor('#7000FF')
    .setAuthor({ name: 'VORTEX | Relogio de Ponto' })
    .setTitle('Bater Ponto')
    .setDescription([
      'Use este painel para registrar sua entrada e saída de serviço.',
      '',
      '**Como funciona**',
      '1. Clique em `Entrar em Serviço` quando iniciar no game.',
      '2. Clique em `Sair de Serviço` quando terminar.',
      '3. Se esquecer de fechar, use `Solicitar ajuste de ponto` e informe o horário correto e o motivo.',
      '',
      '**Importante**',
      'O ajuste abre um atendimento privado para você e a administração. Se aprovado, o ponto aberto é fechado automaticamente no horário informado.',
    ].join('\n'))
    .setImage(`attachment://${VORTEX_PANEL_IMAGE_NAME}`)
    .setTimestamp()
    .setFooter({ text: 'Vortex - Sistema de Ponto' });
}

function createControlRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ponto_open')
      .setLabel('Entrar em Serviço')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('ponto_close')
      .setLabel('Sair de Serviço')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('ponto_adjust_request')
      .setLabel('Solicitar ajuste de ponto')
      .setStyle(ButtonStyle.Secondary)
  );
}

async function createStatusEmbed(guild) {
  const allPoints = await listGuildPoints(guild.id);
  const active = allPoints.filter((item) => item.activePointStartedAt);

  const rows = await Promise.all(active.map(async (item) => {
    const member = await guild.members.fetch(item.userId).catch(() => null);
    const name = member?.displayName || item.userName || `ID ${item.userId}`;
    const registro = item.registro || item.idRegistro || item.userId;
    const openedAt = formatPanelDate(item.activePointStartedAt);
    return {
      mention: item.userMention || `<@${item.userId}>`,
      line: `${pad(name, 18)} | ${pad(registro, 18)} | ${openedAt}`,
    };
  }));

  const table = rows.length
    ? [
        '```',
        `${pad('USUARIO', 18)} | ${pad('REGISTRO', 18)} | DATA HORA`,
        `${'-'.repeat(18)}-+-${'-'.repeat(18)}-+----------------`,
        ...rows.map((row) => row.line),
        '```',
        rows.map((row) => row.mention).join(' '),
      ].join('\n')
    : 'Nenhuma fac em serviço no momento.';

  const description = [
    `Temos ${active.length} membros da fac em serviço:`,
    '',
    table,
  ].join('\n');

  return new EmbedBuilder()
    .setColor(0x111827)
    .setTitle('Relógio de Ponto')
    .setDescription(description.slice(0, 4096))
    .setTimestamp()
    .setFooter({ text: 'Atualização automática - Vortex Ponto' });
}

async function updateStatusPanel(client, guildId) {
  const panel = getPanel(guildId);

  try {
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return false;

    const pointConfig = getPointConfig();
    const configuredStatusChannelId = pointConfig.statusChannelId;
    const channel = await client.channels.fetch(configuredStatusChannelId).catch(() => null);
    if (!channel?.isTextBased?.()) return false;

    await syncOnlineChannelVisibility(guild, channel).catch((error) => {
      logger.error('Erro ao sincronizar visibilidade do canal online:', error);
    });

    const embed = await createStatusEmbed(guild);
    const message = panel?.statusMessageId && panel?.statusChannelId === configuredStatusChannelId
      ? await channel.messages.fetch(panel.statusMessageId).catch(() => null)
      : null;

    if (!message) {
      const newMessage = await channel.send({ embeds: [embed] });
      savePanel(guildId, {
        ...(panel || {}),
        statusChannelId: channel.id,
        statusMessageId: newMessage.id,
        updatedAt: new Date().toISOString(),
      });
      return true;
    }

    await message.edit({ embeds: [embed] });
    return true;
  } catch (error) {
    logger.error('Erro ao atualizar painel de ponto:', error);
    return false;
  }
}

async function setOnlineChannelAccess(client, guildId, userId, allowed) {
  try {
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return false;

    const pointConfig = getPointConfig();
    const channel = await client.channels.fetch(pointConfig.statusChannelId).catch(() => null);
    if (!channel?.permissionOverwrites?.edit) return false;

    if (allowed) {
      await channel.permissionOverwrites.edit(userId, {
        ViewChannel: true,
        ReadMessageHistory: true,
      });
    } else {
      await channel.permissionOverwrites.delete(userId).catch(async () => {
        await channel.permissionOverwrites.edit(userId, { ViewChannel: null, ReadMessageHistory: null });
      });
    }

    return true;
  } catch (error) {
    logger.error('Erro ao atualizar permissão do canal online:', error);
    return false;
  }
}

async function syncOnlineChannelVisibility(guild, channel) {
  const allPoints = await listGuildPoints(guild.id);
  const activeUserIds = new Set(allPoints.filter((item) => item.activePointStartedAt).map((item) => String(item.userId)));

  await channel.permissionOverwrites.edit(guild.id, {
    ViewChannel: false,
  }).catch(() => null);

  for (const userId of activeUserIds) {
    await channel.permissionOverwrites.edit(userId, {
      ViewChannel: true,
      ReadMessageHistory: true,
    }).catch(() => null);
  }

  for (const [targetId, overwrite] of channel.permissionOverwrites.cache) {
    if (targetId === guild.id) continue;
    if (overwrite.type !== 1) continue;
    if (!activeUserIds.has(targetId)) {
      await channel.permissionOverwrites.delete(targetId).catch(() => null);
    }
  }
}

async function updateAllStatusPanels(client) {
  const guildIds = client.guilds.cache.map((guild) => guild.id);
  await Promise.allSettled(guildIds.map((guildId) => updateStatusPanel(client, guildId)));
}

function initStatusPanel(client) {
  updateAllStatusPanels(client).catch((error) => {
    logger.error('Erro ao inicializar painel de ponto:', error);
  });

  if (statusPanelInterval) return;
  statusPanelInterval = setInterval(() => {
    updateAllStatusPanels(client).catch((error) => {
      logger.error('Erro ao atualizar painel de ponto automaticamente:', error);
    });
  }, 30_000);
}

module.exports = {
  PONTO_ACTION_CHANNEL_ID: DEFAULT_PONTO_ACTION_CHANNEL_ID,
  DEFAULT_PONTO_ACTION_CHANNEL_ID,
  PONTO_ONLINE_CHANNEL_ID,
  DEFAULT_PONTO_ADJUST_CATEGORY_ID,
  getPointConfig,
  savePanel,
  getPanel,
  createControlEmbed,
  createControlRow,
  createStatusEmbed,
  setOnlineChannelAccess,
  syncOnlineChannelVisibility,
  updateStatusPanel,
  updateAllStatusPanels,
  initStatusPanel,
};
