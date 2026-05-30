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
const { getGuildProfiles, getBillingExemptUserIds } = require('./profileManager');
const { getActiveGuildAbsences } = require('./ausenciaManager');
const { logger } = require('./logger');
const { sendVortexLog } = require('./notifications');
const { isPrimaryGuild } = require('./guildScope');
const { getPointAllowedRoleIds } = require('./pointRoleConfig');
const { setOnlineChannelAccess, updateStatusPanel } = require('./pontoPanel');
const { safeReply, safeEdit, safeUpdate } = require('./safeReply');
const { createPointActionTranscriptSummary } = require('./pointTranscriptNotifier');
const { isMaintenanceMode } = require('./maintenanceMode');

const CONFIG_PATH = path.join(__dirname, '..', 'commands', 'config.json');
const STATE_PATH = path.join(__dirname, '..', 'commands', 'pointAutomationState.json');
const DEFAULT_POINT_CORRECTION_CATEGORY_ID = '1498087442304073870';
const DEFAULT_PENALTY_CHANNEL_ID = '1499178753207701677';
const DEFAULT_MANAGER_DM_USER_IDS = ['730925532958425240', '289227932432334869'];
const MASTER_ROLE_ID = '1497703127074345040';
const DEFAULT_CHECK_INTERVAL_MS = 15 * 60 * 1000;
const CHECK_INTERVAL_MS = Math.max(
  5 * 60 * 1000,
  Number(process.env.POINT_AUTOMATION_INTERVAL_MS || process.env.CHECK_INTERVAL_MS || DEFAULT_CHECK_INTERVAL_MS) || DEFAULT_CHECK_INTERVAL_MS
);
const POINT_AUTOMATION_FETCH_PRESENCES = process.env.POINT_AUTOMATION_FETCH_PRESENCES !== 'false';
const POINT_AUTOMATION_SCAN_FIVEM = process.env.POINT_AUTOMATION_SCAN_FIVEM !== 'false';
const AUTOMATION_TIME_ZONE = 'America/Sao_Paulo';
const WEEKLY_BILLING_WEEKDAY = 'segunda-feira';

let interval = null;
let scheduledAutomationRunning = false;

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
  const dmIntervalHours = Number(config.POINT_MONITOR_DM_INTERVAL_HOURS || 4);
  return {
    pointMonitorEnabled: config.POINT_MONITOR_ENABLED !== false,
    offlineChargeEnabled: config.POINT_OFFLINE_CHARGE_ENABLED !== false,
    pointMonitorDmIntervalHours: dmIntervalHours,
    pointMonitorAutoCloseHours: Number(config.POINT_MONITOR_AUTO_CLOSE_HOURS || dmIntervalHours),
    pointMonitorMaxDmAttempts: Number(config.POINT_MONITOR_MAX_DM_ATTEMPTS || 3),
    pointCorrectionCategoryId: String(config.POINT_MONITOR_CORRECTION_CATEGORY_ID || DEFAULT_POINT_CORRECTION_CATEGORY_ID),
    penaltyChannelId: String(config.POINT_PENALTY_CHANNEL_ID || DEFAULT_PENALTY_CHANNEL_ID),
    managerDmUserIds: Array.isArray(config.POINT_MANAGER_DM_USER_IDS)
      ? config.POINT_MANAGER_DM_USER_IDS.map(String)
      : DEFAULT_MANAGER_DM_USER_IDS,
    offlineThresholdHours: Number(config.POINT_OFFLINE_THRESHOLD_HOURS || 12),
    offlineChargeIntervalDays: Number(config.POINT_OFFLINE_CHARGE_INTERVAL_DAYS || 2),
    offlineChargeHour: Number(config.POINT_OFFLINE_CHARGE_HOUR || 19),
    availabilityReminderEnabled: config.POINT_AVAILABILITY_REMINDER_ENABLED !== false,
    availabilityReminderHour: Number(config.POINT_AVAILABILITY_REMINDER_HOUR || 19),
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
      'Seu ponto está aberto há bastante tempo.',
      '',
      `Abertura: **${formatDate(point.activePointStartedAt)}**`,
      `Tempo aberto: **${formatDuration(Date.now() - new Date(point.activePointStartedAt).getTime())}**`,
      `Tentativa: **${attempts}/${readAutomationConfig().pointMonitorMaxDmAttempts}**`,
      '',
      'Clique no botão para confirmar que você ainda está online. Se não responder as tentativas deste ciclo, o ponto será fechado automaticamente.',
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
      'A gerência deve conferir o horário correto de saída e aplicar a correção de ponto.',
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
      `<@${point.userId}> teve o ponto fechado e precisa confirmar se o horário está correto.`,
      '',
      `Motivo: **${reason}**`,
      closedBy ? `Fechado por: <@${closedBy}>` : null,
      `Abertura registrada: **${formatDate(point.activePointStartedAt || point.lastPointOpenAt)}**`,
      closedAt ? `Fechamento registrado: **${formatDate(closedAt)}**` : null,
      durationMs !== null ? `Tempo contabilizado: **${formatDuration(durationMs)}**` : null,
      '',
      'Se o horário estiver errado, a gerência deve aplicar o reajuste pela aba Pontos do /painel.',
    ].filter(Boolean),
  };
  const channel = await createPointCorrectionChannel(client, guild, point, state[key] || {}, details);
  await sendVortexLog(client, {
    title: 'Canal de correção de ponto aberto',
    description: [
      `Usuário: <@${point.userId}> (${point.userId})`,
      `Motivo: ${reason}`,
      closedBy ? `Fechado por: <@${closedBy}>` : null,
      closedAt ? `Fechamento registrado: ${formatDate(closedAt)}` : null,
      channel ? `Canal: <#${channel.id}>` : 'Canal: não criado',
    ].filter(Boolean).join('\n'),
    color: '#FEE75C',
    type: 'PONTO',
    guildId: guild.id,
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

function getPointCycleStartMs(point, item) {
  const pointStartMs = new Date(point.activePointStartedAt).getTime();
  const confirmedMs = item.confirmedPointStartedAt === point.activePointStartedAt && item.lastConfirmedAt
    ? new Date(item.lastConfirmedAt).getTime()
    : 0;
  return Math.max(pointStartMs, Number.isNaN(confirmedMs) ? 0 : confirmedMs);
}

async function closeUnconfirmedPoint(client, guild, point, item, state, key, reason) {
  const { closePoint } = require('./pontoManager');
  const result = await closePoint(guild.id, point.userId).catch(() => null);
  if (result?.action === 'closed') {
    await setOnlineChannelAccess(client, guild.id, point.userId, false).catch(() => null);
    await updateStatusPanel(client, guild.id).catch(() => null);
  }
  const embed = new EmbedBuilder()
    .setColor('#ED4245')
    .setTitle('Ponto fechado automaticamente')
    .setDescription([
      `<@${point.userId}> não confirmou o alerta de ponto aberto.`,
      '',
      `Abertura: **${formatDate(point.activePointStartedAt)}**`,
      result?.data?.lastPointCloseAt ? `Fechamento automático: **${formatDate(result.data.lastPointCloseAt)}**` : null,
      result?.durationMs ? `Tempo contabilizado: **${formatDuration(result.durationMs)}**` : null,
      '',
      'Se o horário estiver errado, o usuário deve solicitar correção de ponto.',
    ].filter(Boolean).join('\n'))
    .setTimestamp();
  const user = await client.users.fetch(point.userId).catch(() => null);
  if (user) {
    const summary = result?.action === 'closed'
      ? await createPointActionTranscriptSummary({
        guild,
        target: user,
        generatedBy: client.user,
        action: 'closed',
        result,
      })
      : null;
    await user.send(summary ? {
      content: [
        `<@${point.userId}> não confirmou o alerta de ponto aberto.`,
        '',
        summary.content,
        '',
        'Se o horário estiver errado, solicite correção de ponto.',
      ].join('\n'),
      allowedMentions: { users: [] },
    } : { embeds: [embed] }).catch(() => null);
  }
  const channel = await openPointCorrectionForClosedPoint(client, guild, point, {
    reason,
    closedAt: result?.data?.lastPointCloseAt || new Date().toISOString(),
    durationMs: result?.durationMs ?? null,
  }).catch((error) => {
    logger.error('Erro ao abrir correção após fechamento automático:', error);
    return null;
  });
  state[key] = {
    ...item,
    attempts: 0,
    autoClosedAt: new Date().toISOString(),
    ticketChannelId: channel?.id || item.ticketChannelId || null,
    lastPromptAt: null,
  };
}

async function checkOpenPointConfirmations(client, guild, state, points = null) {
  const config = readAutomationConfig();
  if (!config.pointMonitorEnabled) return;
  const guildPoints = points || await listGuildPoints(guild.id);
  const minOpenMs = config.pointMonitorDmIntervalHours * 60 * 60 * 1000;
  const retryMs = 15 * 60 * 1000;

  for (const point of guildPoints.filter((item) => item.activePointStartedAt)) {
    const key = getStateKey(guild.id, point.userId);
    const item = state[key] || {};
    const cycleStartMs = getPointCycleStartMs(point, item);
    const openedMs = Date.now() - cycleStartMs;
    if (item.pointStartedAt !== point.activePointStartedAt) {
      state[key] = {
        ...item,
        pointStartedAt: point.activePointStartedAt,
        attempts: 0,
        lastPromptAt: null,
        confirmedPointStartedAt: null,
        lastConfirmedAt: null,
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

    await closeUnconfirmedPoint(client, guild, point, { ...item, attempts }, state, key, 'Fechamento automático após 3 DMs sem confirmação');
  }
}

function getAutomationHour(date = new Date()) {
  const hour = new Intl.DateTimeFormat('pt-BR', {
    timeZone: AUTOMATION_TIME_ZONE,
    hour: '2-digit',
    hour12: false,
  }).format(date);
  return Number(hour);
}

function getAutomationWeekday(date = new Date()) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: AUTOMATION_TIME_ZONE,
    weekday: 'long',
  }).format(date).toLowerCase();
}

function isWeeklyBillingTime(date = new Date(), hour = 19) {
  return getAutomationWeekday(date) === WEEKLY_BILLING_WEEKDAY && getAutomationHour(date) === Number(hour);
}

function getAutomationDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: AUTOMATION_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function checkOfflineUsers(client, guild, state, force = false, points = null) {
  const config = readAutomationConfig();
  if (!config.offlineChargeEnabled) return;
  if (!force && !isWeeklyBillingTime(new Date(), config.offlineChargeHour)) return;

  const profiles = Object.values(getGuildProfiles(guild.id));
  const billingExemptUserIds = new Set(getBillingExemptUserIds());
  const activeAbsences = new Set(getActiveGuildAbsences(guild.id).map((absence) => absence.userId));
  const guildPoints = points || await listGuildPoints(guild.id);
  const pointByUser = new Map(guildPoints.map((point) => [point.userId, point]));
  const thresholdMs = Math.max(1, Number(config.offlineThresholdHours || 12)) * 60 * 60 * 1000;
  const todayKey = getAutomationDateKey();

  for (const profile of profiles) {
    if (billingExemptUserIds.has(String(profile?.userId))) continue;
    if (!profile?.userId || activeAbsences.has(profile.userId)) continue;
    const point = pointByUser.get(profile.userId);
    if (point?.activePointStartedAt) continue;
    const lastActivity = point?.lastPointCloseAt || point?.lastPointOpenAt || profile.approvedAt || profile.updatedAt;
    const lastActivityMs = lastActivity ? new Date(lastActivity).getTime() : NaN;
    const inactiveMs = Number.isNaN(lastActivityMs) ? 0 : Date.now() - lastActivityMs;
    if (!lastActivity || Number.isNaN(lastActivityMs) || inactiveMs < thresholdMs) continue;

    const key = `${getStateKey(guild.id, profile.userId)}:offline`;
    const item = state[key] || {};
    const lastChargeDateKey = item.lastChargeDateKey || (item.lastChargeAt ? getAutomationDateKey(new Date(item.lastChargeAt)) : null);
    if (!force && lastChargeDateKey === todayKey) continue;

    const embed = new EmbedBuilder()
      .setColor('#ED4245')
      .setTitle('Alerta de login ausente')
      .setDescription([
        `Você está há ${formatDuration(inactiveMs)} sem login/ponto registrado e não está em ausência.`,
        '',
        `Último login/ponto registrado: **${formatDate(lastActivity)}**`,
        `Cobrança automática: **toda segunda-feira às ${String(config.offlineChargeHour).padStart(2, '0')}:00**`,
        '',
        'Se aconteceu algo ou você precisa ficar afastado, solicite ausência pelo `/ausencia`. Ao entrar no FiveM Metrópole RP - Season 2!, seu ponto será aberto automaticamente.',
      ].join('\n'))
      .setTimestamp();

    const user = await client.users.fetch(profile.userId).catch(() => null);
    const sent = user ? await user.send({ embeds: [embed] }).then(() => true).catch(() => false) : false;
    state[key] = { ...item, lastChargeAt: new Date().toISOString(), lastChargeDateKey: todayKey, lastDmSent: sent };
  }
}

function hasAnyRole(member, roleIds) {
  return Boolean(member?.roles?.cache && roleIds.some((roleId) => member.roles.cache.has(roleId)));
}

async function sendAvailabilityReminderDm(user, guild, onlineCount = 0) {
  const embed = new EmbedBuilder()
    .setColor('#FEE75C')
    .setTitle('Ative o modo disponível no Discord')
    .setDescription([
      'A partir das 19:00, deixe seu Discord em **Disponível/Online**.',
      '',
      `Jogadores online agora: **${onlineCount}**`,
      '',
      'Isso ajuda o bot a detectar sua presença no FiveM e manter o ponto automático funcionando corretamente.',
      'Quem já estiver com o status disponível não recebe este aviso.',
    ].join('\n'))
    .setFooter({ text: guild.name })
    .setTimestamp();

  return user.send({ embeds: [embed] }).then(() => true).catch(() => false);
}

async function sendMissingSetDm(user, guild) {
  const embed = new EmbedBuilder()
    .setColor('#ED4245')
    .setTitle('Cadastro de set pendente')
    .setDescription([
      `Você ainda não possui cadastro aprovado no **${guild.name}**.`,
      '',
      'Solicite seu set pelo comando `/set` para liberar seu cadastro e evitar cobranças automáticas.',
      'Depois do set aprovado, o bot consegue acompanhar seu ponto e seus dados corretamente.',
    ].join('\n'))
    .setFooter({ text: 'Vortex - Sistema de Set' })
    .setTimestamp();

  return user.send({ embeds: [embed] }).then(() => true).catch(() => false);
}

async function checkAvailabilityReminders(client, guild, state, force = false) {
  const config = readAutomationConfig();
  if (!config.availabilityReminderEnabled) return;
  if (!force && getAutomationHour() !== config.availabilityReminderHour) return;

  const today = getAutomationDateKey();
  const scanKey = `${guild.id}:availability-scan:${today}`;
  if (!force && state[scanKey]?.completed) return;

  const shouldFetchPresences = force || POINT_AUTOMATION_FETCH_PRESENCES;
  const fetchedPresences = shouldFetchPresences
    ? await guild.members.fetch({ withPresences: true })
      .then(() => true)
      .catch(() => false)
    : false;
  if (!fetchedPresences && !guild.presences?.cache?.size) {
    state[scanKey] = {
      completed: true,
      completedAt: new Date().toISOString(),
      fetchedPresences,
      skippedReason: 'presence_cache_empty',
    };
    return;
  }

  const onlineCount = Array.from(guild.members.cache.values()).filter((member) => (
    member && !member.user?.bot && member.presence?.status === 'online'
  )).length;
  const pointRoleIds = getPointAllowedRoleIds();
  const profiles = getGuildProfiles(guild.id);
  const billingExemptUserIds = new Set(getBillingExemptUserIds());
  const activeAbsences = new Set(getActiveGuildAbsences(guild.id).map((absence) => absence.userId));

  for (const member of guild.members.cache.values()) {
    if (!member || member.user?.bot) continue;
    if (!hasAnyRole(member, pointRoleIds)) continue;
    if (billingExemptUserIds.has(String(member.id))) continue;
    if (activeAbsences.has(member.id)) continue;

    const profile = profiles[member.id];
    const key = `${getStateKey(guild.id, member.id)}:availability`;
    const item = state[key] || {};

    if (!profile?.approvedAt) {
      if (!force && item.lastSetReminderDate === today) continue;
      const sent = await sendMissingSetDm(member.user, guild);
      state[key] = { ...item, lastSetReminderDate: today, lastSetReminderAt: new Date().toISOString(), lastSetReminderSent: sent };
      continue;
    }

    if (member.presence?.status === 'online') continue;
    if (!force && item.lastAvailabilityReminderDate === today) continue;

    const sent = await sendAvailabilityReminderDm(member.user, guild, onlineCount);
    state[key] = {
      ...item,
      lastAvailabilityReminderDate: today,
      lastAvailabilityReminderAt: new Date().toISOString(),
      lastAvailabilityReminderSent: sent,
      lastKnownStatus: member.presence?.status || 'offline',
    };
  }

  state[scanKey] = {
    completed: true,
    completedAt: new Date().toISOString(),
    fetchedPresences,
  };
}

async function runPointAutomationCheck(client, { force = false } = {}) {
  if (isMaintenanceMode()) return { skipped: true, reason: 'maintenance' };

  const state = readJSON(STATE_PATH, {});
  if (POINT_AUTOMATION_SCAN_FIVEM) {
    const { scanCurrentFiveMActivities } = require('./fivemActivityAlertManager');
    await scanCurrentFiveMActivities(client).catch((error) => logger.error('Erro ao reconciliar atividades FiveM no ciclo de ponto:', error));
  }
  for (const guild of client.guilds.cache.values()) {
    if (!isPrimaryGuild(guild.id)) continue;
    const config = readAutomationConfig();
    const needsPoints = config.pointMonitorEnabled || config.offlineChargeEnabled;
    const points = needsPoints
      ? await listGuildPoints(guild.id).catch((error) => {
        logger.error('Erro ao carregar pontos para automacao:', error);
        return [];
      })
      : [];
    await checkOpenPointConfirmations(client, guild, state, points).catch((error) => logger.error('Erro no monitor de ponto aberto:', error));
    await checkOfflineUsers(client, guild, state, force, points).catch((error) => logger.error('Erro na cobranca de usuarios offline:', error));
    await checkAvailabilityReminders(client, guild, state, force).catch((error) => logger.error('Erro no lembrete de status disponível:', error));
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
  return safeReply(interaction, { content: '✅ Confirmado. A contagem foi zerada e uma nova verificação começará daqui a 4 horas.', ephemeral: true });
}

async function deletePointCorrectionChannels(client, guild, userId, deletedBy = null) {
  const state = readJSON(STATE_PATH, {});
  const prefix = `${getStateKey(guild.id, userId)}`;
  const deleted = [];

  for (const [key, item] of Object.entries(state)) {
    if (!key.startsWith(prefix) || !item?.ticketChannelId) continue;
    const channel = await guild.channels.fetch(item.ticketChannelId).catch(() => null);
    if (channel) {
      await channel.delete('Call/canal de ajuste de ponto deletado pelo painel').catch(() => null);
      deleted.push(item.ticketChannelId);
    }
    state[key] = {
      ...item,
      ticketChannelId: null,
      correctionChannelDeletedAt: new Date().toISOString(),
      correctionChannelDeletedBy: deletedBy ? String(deletedBy) : null,
    };
  }

  writeJSON(STATE_PATH, state);
  return deleted;
}

async function handlePenaltyButton(interaction) {
  const approved = interaction.customId.startsWith('point_penalty_accept_');
  const userId = interaction.customId.replace(approved ? 'point_penalty_accept_' : 'point_penalty_reject_', '');
  const embed = new EmbedBuilder()
    .setColor(approved ? '#ED4245' : '#57F287')
    .setTitle(approved ? 'Penalidade aceita pela gerência' : 'Penalidade recusada pela gerência')
    .setDescription([
      `Usuário: <@${userId}>`,
      `Gerente: <@${interaction.user.id}>`,
      `Data/hora: **${formatDate(new Date())}**`,
      approved
        ? 'Motivos possíveis registrados: não atualizou perfil, não bateu/fechou ponto ou ignorou cobranças do bot.'
        : 'A ocorrência foi recusada pela gerência.',
    ].join('\n'))
    .setTimestamp();
  if (interaction.replied || interaction.deferred) {
    await safeEdit(interaction, { embeds: [embed], components: [] });
    return;
  }
  await safeUpdate(interaction, { embeds: [embed], components: [] });
}

function initPointAutomation(client) {
  if (interval) clearInterval(interval);
  const runScheduled = (label) => {
    if (scheduledAutomationRunning) return;
    scheduledAutomationRunning = true;
    runPointAutomationCheck(client)
      .catch((error) => logger.error(label, error))
      .finally(() => {
        scheduledAutomationRunning = false;
      });
  };
  setTimeout(() => runScheduled('Erro inicial na automacao de ponto:'), 15 * 1000);
  interval = setInterval(() => {
    runScheduled('Erro na automacao de ponto:');
  }, CHECK_INTERVAL_MS);
}

module.exports = {
  readAutomationConfig,
  updateAutomationConfig,
  runPointAutomationCheck,
  openPointCorrectionForClosedPoint,
  deletePointCorrectionChannels,
  confirmPointPresence,
  handlePenaltyButton,
  initPointAutomation,
};
