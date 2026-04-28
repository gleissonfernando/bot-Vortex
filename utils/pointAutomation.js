const fs = require('fs');
const path = require('path');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
} = require('discord.js');
const { listGuildPoints, formatDate, formatDuration } = require('./pontoManager');
const { getGuildProfiles } = require('./profileManager');
const { getActiveGuildAbsences } = require('./ausenciaManager');
const { logger } = require('./logger');
const { sendVortexLog } = require('./notifications');

const CONFIG_PATH = path.join(__dirname, '..', 'commands', 'config.json');
const STATE_PATH = path.join(__dirname, '..', 'commands', 'pointAutomationState.json');
const DEFAULT_POINT_CORRECTION_CATEGORY_ID = '1498087442304073870';
const DEFAULT_PENALTY_CHANNEL_ID = '1483169256727122050';
const DEFAULT_MANAGER_DM_USER_IDS = ['730925532958425240', '289227932432334869'];
const MASTER_ROLE_ID = '1497703127074345040';
const CHECK_INTERVAL_MS = 15 * 60 * 1000;

let interval = null;

function ensureFile(filePath, fallback = {}) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, `${JSON.stringify(fallback, null, 2)}\n`, 'utf8');
  }
}

function readJSON(filePath, fallback = {}) {
  ensureFile(filePath, fallback);
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8') || '{}');
  } catch {
    return fallback;
  }
}

function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function readAutomationConfig() {
  const config = readJSON(CONFIG_PATH, {});
  return {
    pointMonitorEnabled: config.POINT_MONITOR_ENABLED !== false,
    offlineChargeEnabled: config.POINT_OFFLINE_CHARGE_ENABLED !== false,
    pointMonitorDmIntervalHours: Number(config.POINT_MONITOR_DM_INTERVAL_HOURS || 4),
    pointMonitorAutoCloseHours: Number(config.POINT_MONITOR_AUTO_CLOSE_HOURS || 6),
    pointMonitorMaxDmAttempts: Number(config.POINT_MONITOR_MAX_DM_ATTEMPTS || 3),
    pointCorrectionCategoryId: String(config.POINT_MONITOR_CORRECTION_CATEGORY_ID || DEFAULT_POINT_CORRECTION_CATEGORY_ID),
    penaltyChannelId: String(config.POINT_PENALTY_CHANNEL_ID || DEFAULT_PENALTY_CHANNEL_ID),
    managerDmUserIds: Array.isArray(config.POINT_MANAGER_DM_USER_IDS)
      ? config.POINT_MANAGER_DM_USER_IDS.map(String)
      : DEFAULT_MANAGER_DM_USER_IDS,
    offlineThresholdHours: Number(config.POINT_OFFLINE_THRESHOLD_HOURS || 12),
  };
}

function updateAutomationConfig(patch) {
  const config = readJSON(CONFIG_PATH, {});
  const next = { ...config, ...patch };
  writeJSON(CONFIG_PATH, next);
  return readAutomationConfig();
}

function getStaffRoleIds() {
  const config = readJSON(CONFIG_PATH, {});
  const levels = config.VORTEX_ROLE_LEVELS || {};
  return [...new Set([
    MASTER_ROLE_ID,
    ...(Array.isArray(levels.admin) ? levels.admin : []),
    ...(Array.isArray(levels.medio) ? levels.medio : []),
    ...(Array.isArray(config.POINT_ADJUST_STAFF_ROLES) ? config.POINT_ADJUST_STAFF_ROLES : []),
  ].filter(Boolean).map(String))];
}

function getStateKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

function buildConfirmRow(guildId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`point_presence_confirm_${guildId}`)
      .setLabel('Confirmar que estou online')
      .setStyle(ButtonStyle.Success)
  );
}

function buildPenaltyRow(userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`point_penalty_accept_${userId}`)
      .setLabel('Aceitar penalidade')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`point_penalty_reject_${userId}`)
      .setLabel('Recusar')
      .setStyle(ButtonStyle.Secondary)
  );
}

async function sendManagerDm(client, embed) {
  const config = readAutomationConfig();
  await Promise.allSettled(config.managerDmUserIds.map(async (userId) => {
    const user = await client.users.fetch(userId).catch(() => null);
    if (user) await user.send({ embeds: [embed] }).catch(() => null);
  }));
}

async function sendPenaltyChannelMessage(client, guild, userId, embed, components = []) {
  const config = readAutomationConfig();
  const channel = await client.channels.fetch(config.penaltyChannelId).catch(() => null);
  if (!channel?.isTextBased?.()) return false;
  const staffRoleIds = getStaffRoleIds();
  await channel.send({
    content: [`<@${userId}>`, ...staffRoleIds.map((roleId) => `<@&${roleId}>`)].join(' '),
    embeds: [embed],
    components,
    allowedMentions: { users: [userId], roles: staffRoleIds },
  }).catch(() => null);
  return true;
}

async function sendOpenPointDm(client, guild, point, attempts) {
  const user = await client.users.fetch(point.userId).catch(() => null);
  if (!user) return false;
  const embed = new EmbedBuilder()
    .setColor('#FEE75C')
    .setTitle('Confirme seu ponto aberto')
    .setDescription([
      'Seu ponto esta aberto ha bastante tempo.',
      '',
      `Abertura: **${formatDate(point.activePointStartedAt)}**`,
      `Tempo aberto: **${formatDuration(Date.now() - new Date(point.activePointStartedAt).getTime())}**`,
      `Tempo restante para fechamento automatico: **${Math.max(0, Math.round((readAutomationConfig().pointMonitorAutoCloseHours * 60 * 60 * 1000 - (Date.now() - new Date(point.activePointStartedAt).getTime())) / 60000))} minutos**`,
      `Tentativa: **${attempts}/3**`,
      '',
      'Clique no botao para confirmar que voce ainda esta online. Se nao confirmar ate o limite, o ponto sera fechado automaticamente e a gerencia sera avisada.',
    ].join('\n'))
    .setTimestamp();
  await user.send({ embeds: [embed], components: [buildConfirmRow(guild.id)] });
  return true;
}

async function createPointCorrectionChannel(client, guild, point, state, details = {}) {
  const config = readAutomationConfig();
  const category = await guild.channels.fetch(config.pointCorrectionCategoryId).catch(() => null);
  if (!category || category.type !== ChannelType.GuildCategory) return null;
  if (state.ticketChannelId) {
    const existing = await guild.channels.fetch(state.ticketChannelId).catch(() => null);
    if (existing) return existing;
  }

  const staffRoleIds = getStaffRoleIds();
  const member = await guild.members.fetch(point.userId).catch(() => null);
  const channel = await guild.channels.create({
    name: `corrigir-ponto-${member?.user?.username || point.userId}`.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 90),
    parent: category.id,
    permissionOverwrites: [
      { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: point.userId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
      { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory] },
      ...staffRoleIds.map((roleId) => ({
        id: roleId,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
      })),
    ],
  });

  const embed = new EmbedBuilder()
    .setColor('#ED4245')
    .setTitle(details.title || 'Correção de ponto necessária')
    .setDescription((details.descriptionLines || [
      `<@${point.userId}> precisa corrigir o ponto.`,
      '',
      `Ponto aberto desde: **${formatDate(point.activePointStartedAt)}**`,
      `Tempo aberto: **${formatDuration(Date.now() - new Date(point.activePointStartedAt).getTime())}**`,
      '',
      'A gerencia deve conferir o horario correto de saida e aplicar a correcao de ponto.',
    ]).join('\n'))
    .setTimestamp();

  await channel.send({
    content: [`<@${point.userId}>`, ...staffRoleIds.map((roleId) => `<@&${roleId}>`)].join(' '),
    embeds: [embed],
    allowedMentions: { users: [point.userId], roles: staffRoleIds },
  }).catch(() => null);

  if (details.notifyManagement) {
    await sendPenaltyChannelMessage(client, guild, point.userId, embed, [buildPenaltyRow(point.userId)]);
    await sendManagerDm(client, embed);
  }
  return channel;
}

async function openPointCorrectionForClosedPoint(client, guild, point, {
  reason = 'Ponto fechado automaticamente',
  closedAt = null,
  durationMs = null,
  closedBy = null,
} = {}) {
  const state = readJSON(STATE_PATH, {});
  const key = `${getStateKey(guild.id, point.userId)}:closed:${Date.now()}`;
  const details = {
    title: 'Correção de ponto aberta',
    descriptionLines: [
      `<@${point.userId}> teve o ponto fechado e precisa confirmar se o horario esta correto.`,
      '',
      `Motivo: **${reason}**`,
      closedBy ? `Fechado por: <@${closedBy}>` : null,
      `Abertura registrada: **${formatDate(point.activePointStartedAt || point.lastPointOpenAt)}**`,
      closedAt ? `Fechamento registrado: **${formatDate(closedAt)}**` : null,
      durationMs !== null ? `Tempo contabilizado: **${formatDuration(durationMs)}**` : null,
      '',
      'Se o horario estiver errado, a gerencia deve aplicar o reajuste pela aba Pontos do /painel.',
    ].filter(Boolean),
  };
  const channel = await createPointCorrectionChannel(client, guild, point, state[key] || {}, details);
  await sendVortexLog(client, {
    title: 'Canal de correcao de ponto aberto',
    description: [
      `Usuario: <@${point.userId}> (${point.userId})`,
      `Motivo: ${reason}`,
      closedBy ? `Fechado por: <@${closedBy}>` : null,
      closedAt ? `Fechamento registrado: ${formatDate(closedAt)}` : null,
      channel ? `Canal: <#${channel.id}>` : 'Canal: nao criado',
    ].filter(Boolean).join('\n'),
    color: '#FEE75C',
    type: 'PONTO',
  }).catch(() => null);
  state[key] = {
    ...(state[key] || {}),
    ticketChannelId: channel?.id || null,
    createdAt: new Date().toISOString(),
    reason,
  };
  writeJSON(STATE_PATH, state);
  return channel;
}

async function notifyProfileChannel(client, profile, embed) {
  if (!profile?.callChannelId) return false;
  const channel = await client.channels.fetch(profile.callChannelId).catch(() => null);
  if (!channel?.isTextBased?.()) return false;
  await channel.send({ content: `<@${profile.userId}>`, embeds: [embed], allowedMentions: { users: [profile.userId] } }).catch(() => null);
  return true;
}

async function checkOpenPointConfirmations(client, guild, state) {
  const config = readAutomationConfig();
  if (!config.pointMonitorEnabled) return;
  const points = await listGuildPoints(guild.id);
  const minOpenMs = config.pointMonitorDmIntervalHours * 60 * 60 * 1000;
  const autoCloseMs = config.pointMonitorAutoCloseHours * 60 * 60 * 1000;
  const retryMs = 15 * 60 * 1000;

  for (const point of points.filter((item) => item.activePointStartedAt)) {
    const key = getStateKey(guild.id, point.userId);
    const item = state[key] || {};
    const openedMs = Date.now() - new Date(point.activePointStartedAt).getTime();
    if (openedMs >= autoCloseMs && item.confirmedPointStartedAt !== point.activePointStartedAt) {
      const { closePoint } = require('./pontoManager');
      const result = await closePoint(guild.id, point.userId).catch(() => null);
      const embed = new EmbedBuilder()
        .setColor('#ED4245')
        .setTitle('Ponto fechado automaticamente')
        .setDescription([
          `<@${point.userId}> nao confirmou o alerta de ponto aberto.`,
          '',
          `Abertura: **${formatDate(point.activePointStartedAt)}**`,
          result?.data?.lastPointCloseAt ? `Fechamento automatico: **${formatDate(result.data.lastPointCloseAt)}**` : null,
          result?.durationMs ? `Tempo contabilizado: **${formatDuration(result.durationMs)}**` : null,
          '',
          'Se o horario estiver errado, o usuario deve solicitar correcao de ponto.',
        ].filter(Boolean).join('\n'))
        .setTimestamp();
      const user = await client.users.fetch(point.userId).catch(() => null);
      if (user) await user.send({ embeds: [embed] }).catch(() => null);
      const channel = await openPointCorrectionForClosedPoint(client, guild, point, {
        reason: 'Fechamento automatico por falta de confirmacao',
        closedAt: result?.data?.lastPointCloseAt || new Date().toISOString(),
        durationMs: result?.durationMs ?? null,
      }).catch((error) => {
        logger.error('Erro ao abrir correcao apos fechamento automatico:', error);
        return null;
      });
      state[key] = {
        ...item,
        attempts: 0,
        autoClosedAt: new Date().toISOString(),
        ticketChannelId: channel?.id || item.ticketChannelId || null,
        lastPromptAt: null,
      };
      continue;
    }
    if (openedMs < minOpenMs) continue;
    if (item.ticketChannelId) continue;
    if (item.lastPromptAt && Date.now() - new Date(item.lastPromptAt).getTime() < retryMs) continue;

    const attempts = Number(item.attempts || 0) + 1;
    if (attempts <= config.pointMonitorMaxDmAttempts) {
      const sent = await sendOpenPointDm(client, guild, point, attempts).catch(() => false);
      state[key] = { ...item, attempts, lastPromptAt: new Date().toISOString(), lastDmSent: sent };
      continue;
    }

    const channel = await createPointCorrectionChannel(client, guild, point, item, {
      notifyManagement: true,
      title: 'Terceira falha de ponto',
      descriptionLines: [
        `<@${point.userId}> ficou 3 vezes sem confirmar/fechar o ponto.`,
        '',
        `Ponto aberto desde: **${formatDate(point.activePointStartedAt)}**`,
        `Tempo aberto: **${formatDuration(Date.now() - new Date(point.activePointStartedAt).getTime())}**`,
        '',
        'A gerencia deve conferir o horario correto e aplicar a correcao se necessario.',
      ],
    }).catch((error) => {
      logger.error('Erro ao criar canal de correcao de ponto:', error);
      return null;
    });
    state[key] = {
      ...item,
      attempts,
      ticketChannelId: channel?.id || item.ticketChannelId || null,
      escalatedAt: new Date().toISOString(),
    };
  }
}

async function checkOfflineUsers(client, guild, state) {
  const config = readAutomationConfig();
  if (!config.offlineChargeEnabled) return;

  const profiles = Object.values(getGuildProfiles(guild.id));
  const activeAbsences = new Set(getActiveGuildAbsences(guild.id).map((absence) => absence.userId));
  const points = await listGuildPoints(guild.id);
  const pointByUser = new Map(points.map((point) => [point.userId, point]));
  const thresholdMs = config.offlineThresholdHours * 60 * 60 * 1000;
  const oncePerDayMs = 24 * 60 * 60 * 1000;

  for (const profile of profiles) {
    if (!profile?.userId || activeAbsences.has(profile.userId)) continue;
    const point = pointByUser.get(profile.userId);
    if (point?.activePointStartedAt) continue;
    const lastActivity = point?.lastPointCloseAt || point?.lastPointOpenAt || profile.approvedAt || profile.updatedAt;
    if (!lastActivity || Date.now() - new Date(lastActivity).getTime() < thresholdMs) continue;

    const key = `${getStateKey(guild.id, profile.userId)}:offline`;
    const item = state[key] || {};
    if (item.lastChargeAt && Date.now() - new Date(item.lastChargeAt).getTime() < oncePerDayMs) continue;

    const embed = new EmbedBuilder()
      .setColor('#ED4245')
      .setTitle('Cobrança de atividade')
      .setDescription([
        `<@${profile.userId}> esta ha muito tempo sem ponto aberto e nao esta em ausencia.`,
        '',
        `Ultima atividade de ponto: **${formatDate(lastActivity)}**`,
        `Limite configurado: **${config.offlineThresholdHours}h**`,
        '',
        'Oriente o usuario a abrir ponto quando estiver em serviço, solicitar ausencia quando precisar se afastar ou pedir correcao se esqueceu de fechar ponto.',
      ].join('\n'))
      .setTimestamp();

    const user = await client.users.fetch(profile.userId).catch(() => null);
    if (user) await user.send({ embeds: [embed] }).catch(() => null);
    await sendPenaltyChannelMessage(client, guild, profile.userId, embed);
    await sendManagerDm(client, embed);
    await notifyProfileChannel(client, profile, embed);
    state[key] = { ...item, lastChargeAt: new Date().toISOString() };
  }
}

async function runPointAutomationCheck(client, { force = false } = {}) {
  const state = readJSON(STATE_PATH, {});
  for (const guild of client.guilds.cache.values()) {
    await checkOpenPointConfirmations(client, guild, state, force).catch((error) => logger.error('Erro no monitor de ponto aberto:', error));
    await checkOfflineUsers(client, guild, state, force).catch((error) => logger.error('Erro na cobranca de usuarios offline:', error));
  }
  writeJSON(STATE_PATH, state);
  return state;
}

async function confirmPointPresence(interaction) {
  const guildId = interaction.customId.replace('point_presence_confirm_', '');
  const state = readJSON(STATE_PATH, {});
  const key = getStateKey(guildId, interaction.user.id);
  const { getUserPoint } = require('./pontoManager');
  const point = await getUserPoint(guildId, interaction.user.id).catch(() => null);
  state[key] = {
    ...(state[key] || {}),
    attempts: 0,
    lastConfirmedAt: new Date().toISOString(),
    confirmedPointStartedAt: point?.activePointStartedAt || null,
    lastPromptAt: null,
  };
  writeJSON(STATE_PATH, state);
  return interaction.reply({ content: '✅ Confirmado. A gerencia nao sera acionada por esta verificacao.', ephemeral: true });
}

async function handlePenaltyButton(interaction) {
  const approved = interaction.customId.startsWith('point_penalty_accept_');
  const userId = interaction.customId.replace(approved ? 'point_penalty_accept_' : 'point_penalty_reject_', '');
  const embed = new EmbedBuilder()
    .setColor(approved ? '#ED4245' : '#57F287')
    .setTitle(approved ? 'Penalidade aceita pela gerencia' : 'Penalidade recusada pela gerencia')
    .setDescription([
      `Usuario: <@${userId}>`,
      `Gerente: <@${interaction.user.id}>`,
      `Data/hora: **${formatDate(new Date())}**`,
      approved
        ? 'Motivos possiveis registrados: nao atualizou perfil, nao bateu/fechou ponto ou ignorou cobrancas do bot.'
        : 'A ocorrencia foi recusada pela gerencia.',
    ].join('\n'))
    .setTimestamp();
  await interaction.update({ embeds: [embed], components: [] }).catch(() => null);
}

function initPointAutomation(client) {
  if (interval) clearInterval(interval);
  setTimeout(() => runPointAutomationCheck(client).catch((error) => logger.error('Erro inicial na automacao de ponto:', error)), 15 * 1000);
  interval = setInterval(() => {
    runPointAutomationCheck(client).catch((error) => logger.error('Erro na automacao de ponto:', error));
  }, CHECK_INTERVAL_MS);
}

module.exports = {
  readAutomationConfig,
  updateAutomationConfig,
  runPointAutomationCheck,
  openPointCorrectionForClosedPoint,
  confirmPointPresence,
  handlePenaltyButton,
  initPointAutomation,
};
