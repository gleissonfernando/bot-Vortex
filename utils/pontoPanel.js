const fs = require('fs');
const path = require('path');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { listGuildPoints, formatPanelDate } = require('./pontoManager');
const { getPointAllowedRoleIds } = require('./pointRoleConfig');
const { logger } = require('./logger');
const { extractCityName, getTargetFiveMActivity } = require('./fivemActivityAlertManager');
const { isPrimaryGuild, isPrimaryGuildChannel } = require('./guildScope');
const { buildThemedPanelPayload } = require('./panelTheme');

const PANEL_PATH = path.join(__dirname, '..', 'commands', 'pontoPanels.json');
const CONFIG_PATH = path.join(__dirname, '..', 'commands', 'config.json');
const DEFAULT_PONTO_ACTION_CHANNEL_ID = '1498087608390127806';
const PONTO_ONLINE_CHANNEL_ID = '1498087749784178708';
const DEFAULT_PONTO_ADJUST_CATEGORY_ID = '1498087442304073870';
let statusPanelInterval = null;
let statusPanelUpdateRunning = false;
const transientPanelFailures = new Map();
const lastVisibilitySyncByGuild = new Map();
const TRANSIENT_LOG_INTERVAL_MS = 5 * 60 * 1000;
const VISIBILITY_SYNC_INTERVAL_MS = 15 * 1000;
const STATUS_PANEL_INTERVAL_MS = Math.max(
  30 * 1000,
  Number(process.env.PONTO_PANEL_INTERVAL_MS || 60 * 1000) || 60 * 1000
);
const PONTO_PANEL_FETCH_PRESENCES = process.env.PONTO_PANEL_FETCH_PRESENCES === 'true';

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
    .setAuthor({ name: 'VORTEX | Relógio de Ponto' })
    .setTitle('🕒 Painel de Ponto')
    .setDescription([
      '**Registre sua entrada e saída de serviço por aqui.**',
      '',
      '**Como usar**',
      '`1.` Clique em **Entrar em serviço** quando começar.',
      '`2.` Clique em **Sair de serviço** quando terminar.',
      '`3.` Esqueceu de fechar? Use **Solicitar ajuste**.',
      '',
      '**Ajuste de ponto**',
      'Informe o horário correto de saída e o motivo. A staff vai analisar antes de aplicar.',
    ].join('\n'))
    .setTimestamp()
    .setFooter({ text: 'Vortex - Sistema de Ponto' });
}

function createControlRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ponto_open')
      .setLabel('Entrar em serviço')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('ponto_close')
      .setLabel('Sair de serviço')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('ponto_adjust_request')
      .setLabel('Solicitar ajuste')
      .setStyle(ButtonStyle.Secondary)
  );
}

function isDiscordNetworkError(error) {
  const text = `${error?.name || ''} ${error?.code || ''} ${error?.message || ''}`.toLowerCase();
  return text.includes('timeout')
    || text.includes('enotfound')
    || text.includes('econnreset')
    || text.includes('etimedout')
    || text.includes('fetch failed')
    || text.includes('discord.com');
}

function logStatusPanelError(guildId, error) {
  if (!isDiscordNetworkError(error)) {
    logger.error('Erro ao atualizar painel de ponto:', error, { guildId });
    return;
  }

  const now = Date.now();
  const state = transientPanelFailures.get(guildId) || { count: 0, lastLoggedAt: 0 };
  state.count += 1;

  if (now - state.lastLoggedAt >= TRANSIENT_LOG_INTERVAL_MS) {
    state.lastLoggedAt = now;
    logger.warn('Falha temporária ao atualizar painel de ponto. Discord/rede indisponível.', {
      guildId,
      count: state.count,
      error: error?.message || String(error),
    });
    state.count = 0;
  }

  transientPanelFailures.set(guildId, state);
}

function shouldSyncVisibility(guildId) {
  const now = Date.now();
  const last = lastVisibilitySyncByGuild.get(guildId) || 0;
  if (now - last < VISIBILITY_SYNC_INTERVAL_MS) return false;
  lastVisibilitySyncByGuild.set(guildId, now);
  return true;
}

function hasAnyRole(member, roleIds) {
  return Boolean(member?.roles?.cache && roleIds.some((roleId) => member.roles.cache.has(roleId)));
}

async function getOnlinePlayers(guild) {
  const pointRoleIds = getPointAllowedRoleIds();
  if (PONTO_PANEL_FETCH_PRESENCES) {
    await guild.members.fetch({ withPresences: true }).catch(() => null);
  }
  const presences = guild.presences?.cache;
  const onlinePlayers = [];

  for (const presence of presences?.values?.() || []) {
    if (!presence?.user || presence.user.bot) continue;
    const activity = getTargetFiveMActivity(presence);
    if (!activity) continue;
    const member = presence.member || await guild.members.fetch(presence.user.id).catch(() => null);
    if (!member) continue;
    if (pointRoleIds.length && !hasAnyRole(member, pointRoleIds)) continue;
    const cityName = extractCityName(activity);
    onlinePlayers.push({
      id: member.id,
      name: member.displayName || member.user.username || `ID ${member.id}`,
      mention: `<@${member.id}>`,
      cityName,
    });
  }

  onlinePlayers.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  return onlinePlayers;
}

async function createStatusEmbed(guild) {
  const allPoints = await listGuildPoints(guild.id);
  const pointByUserId = new Map(allPoints.map((item) => [String(item.userId), item]));
  const onlinePlayers = await getOnlinePlayers(guild).catch(() => []);
  const onlineCount = onlinePlayers.length;

  const rows = onlinePlayers.map((player) => {
    const item = pointByUserId.get(String(player.id)) || {};
    const name = player.name || item.userName || `ID ${player.id}`;
    const registro = item.registro || item.idRegistro || item.userId;
    const openedAt = item.activePointStartedAt ? formatPanelDate(item.activePointStartedAt) : 'Ponto manual nao aberto';
    return {
      mention: player.mention || `<@${player.id}>`,
      line: `${pad(name, 18)} | ${pad(registro || player.id, 18)} | ${pad(player.cityName, 24)} | ${openedAt}`,
    };
  });

  const table = rows.length
    ? [
        '```',
        `${pad('USUARIO', 18)} | ${pad('REGISTRO', 18)} | ${pad('CIDADE', 24)} | PONTO`,
        `${'-'.repeat(18)}-+-${'-'.repeat(18)}-+-${'-'.repeat(24)}-+----------------`,
        ...rows.map((row) => row.line),
        '```',
        rows.map((row) => row.mention).join(' '),
      ].join('\n')
    : 'Nenhum membro logado na cidade no momento.';

  const description = [
    `Players logados na cidade: **${onlineCount}**`,
    onlinePlayers.length
      ? `Na cidade: ${onlinePlayers.slice(0, 25).map((player) => `${player.mention} (${player.cityName})`).join(' ')}${onlinePlayers.length > 25 ? ` (+${onlinePlayers.length - 25})` : ''}`
      : 'Na cidade: nenhum membro detectado agora.',
    '',
    table,
  ].join('\n');

  return new EmbedBuilder()
    .setColor(0x111827)
    .setTitle('🕒 Status do Ponto')
    .setDescription(description.slice(0, 4096))
    .setTimestamp()
    .setFooter({ text: 'Atualização automática - Vortex Ponto' });
}

async function updateStatusPanel(client, guildId) {
  if (!isPrimaryGuild(guildId)) return false;
  const panel = getPanel(guildId);

  try {
    const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return false;

    const pointConfig = getPointConfig();
    const configuredStatusChannelId = pointConfig.statusChannelId;
    const channel = client.channels.cache.get(configuredStatusChannelId)
      || await client.channels.fetch(configuredStatusChannelId).catch(() => null);
    if (!isPrimaryGuildChannel(channel)) return false;
    if (!channel?.isTextBased?.()) return false;

    if (shouldSyncVisibility(guild.id)) {
      await syncOnlineChannelVisibility(guild, channel).catch((error) => {
        logStatusPanelError(guild.id, error);
      });
    }

    const embed = await createStatusEmbed(guild);
    const message = panel?.statusMessageId && panel?.statusChannelId === configuredStatusChannelId
      ? channel.messages.cache.get(panel.statusMessageId)
        || await channel.messages.fetch(panel.statusMessageId).catch(() => null)
      : null;

    if (!message) {
      const newMessage = await channel.send(buildThemedPanelPayload('pontoStatus', embed));
      savePanel(guildId, {
        ...(panel || {}),
        statusChannelId: channel.id,
        statusMessageId: newMessage.id,
        updatedAt: new Date().toISOString(),
      });
      return true;
    }

    await message.edit(buildThemedPanelPayload('pontoStatus', embed));
    transientPanelFailures.delete(guildId);
    return true;
  } catch (error) {
    logStatusPanelError(guildId, error);
    return false;
  }
}

async function setOnlineChannelAccess(client, guildId, userId, allowed) {
  if (!isPrimaryGuild(guildId)) return false;
  try {
    const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return false;

    const pointConfig = getPointConfig();
    const channel = client.channels.cache.get(pointConfig.statusChannelId)
      || await client.channels.fetch(pointConfig.statusChannelId).catch(() => null);
    if (!isPrimaryGuildChannel(channel)) return false;
    if (!channel?.permissionOverwrites?.edit) return false;

    const onlinePlayers = allowed ? await getOnlinePlayers(guild).catch(() => []) : [];
    const isInCity = onlinePlayers.some((player) => String(player.id) === String(userId));

    if (allowed && isInCity) {
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
    logStatusPanelError(guildId, error);
    return false;
  }
}

async function syncOnlineChannelVisibility(guild, channel) {
  const onlinePlayers = await getOnlinePlayers(guild).catch(() => []);
  const onlineUserIds = new Set(onlinePlayers.map((player) => String(player.id)));

  await channel.permissionOverwrites.edit(guild.id, {
    ViewChannel: false,
  }).catch(() => null);

  for (const userId of onlineUserIds) {
    await channel.permissionOverwrites.edit(userId, {
      ViewChannel: true,
      ReadMessageHistory: true,
    }).catch(() => null);
  }

  for (const [targetId, overwrite] of channel.permissionOverwrites.cache) {
    if (targetId === guild.id) continue;
    if (overwrite.type !== 1) continue;
    if (!onlineUserIds.has(targetId)) {
      await channel.permissionOverwrites.delete(targetId).catch(() => null);
    }
  }
}

async function updateAllStatusPanels(client) {
  const guildIds = client.guilds.cache
    .filter((guild) => isPrimaryGuild(guild.id))
    .map((guild) => guild.id);
  await Promise.allSettled(guildIds.map((guildId) => updateStatusPanel(client, guildId)));
}

function initStatusPanel(client) {
  const runScheduledUpdate = (label) => {
    if (statusPanelUpdateRunning) return;
    statusPanelUpdateRunning = true;
    updateAllStatusPanels(client)
      .catch((error) => {
        logger.error(label, error);
      })
      .finally(() => {
        statusPanelUpdateRunning = false;
      });
  };

  runScheduledUpdate('Erro ao inicializar painel de ponto:');

  if (statusPanelInterval) return;
  statusPanelInterval = setInterval(() => {
    runScheduledUpdate('Erro ao atualizar painel de ponto automaticamente:');
  }, STATUS_PANEL_INTERVAL_MS);
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
  getOnlinePlayers,
  createStatusEmbed,
  setOnlineChannelAccess,
  syncOnlineChannelVisibility,
  updateStatusPanel,
  updateAllStatusPanels,
  initStatusPanel,
};
