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
const { logger } = require('./logger');
const { isPrimaryGuild, isPrimaryGuildChannel } = require('./guildScope');
const { formatDate: formatRealDate } = require('./dateTime');
const { getMasterUserIds } = require('./permissions');

const AUSENCIAS_PATH = path.join(__dirname, '..', 'commands', 'ausencias.json');
const CONFIG_PATH = path.join(__dirname, '..', 'commands', 'config.json');
const DEFAULT_ABSENCE_ROLE_ID = '1498359212252725339';
const DEFAULT_ABSENCE_LOG_CHANNEL_ID = '1498359968087146516';
const ABSENCE_REQUEST_CATEGORY_ID = '1497749211775766538';
const ABSENCE_REQUEST_MENTION_ROLE_ID = '1201193356810780773';
const MASTER_ROLE_IDS = ['1497703127074345040', '1498884908028792942'];
const CHECK_INTERVAL_MS = 60 * 1000;

let interval = null;

function ensureFile(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, `${JSON.stringify(fallback, null, 2)}\n`, 'utf8');
  }
}

function loadJSON(filePath, fallback = {}) {
  ensureFile(filePath, fallback);
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8') || '{}');
  } catch (error) {
    logger.error(`Erro ao ler ${path.basename(filePath)}:`, error);
    return fallback;
  }
}

function saveJSON(filePath, data) {
  ensureFile(filePath, {});
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function getAbsenceConfig() {
  const conf = loadJSON(CONFIG_PATH, {});
  return {
    roleId: String(conf.ABSENCE_ROLE_ID || DEFAULT_ABSENCE_ROLE_ID),
    logChannelId: String(conf.ABSENCE_LOG_CHANNEL_ID || DEFAULT_ABSENCE_LOG_CHANNEL_ID),
    disableEndMessage: Boolean(conf.DISABLE_ABSENCE_END_MESSAGE),
  };
}

function saveAbsenceConfig(nextConfig) {
  const conf = loadJSON(CONFIG_PATH, {});
  const next = {
    ...conf,
    ...nextConfig,
  };
  saveJSON(CONFIG_PATH, next);
  return getAbsenceConfig();
}

function formatDate(value) {
  if (!value) return 'N/A';
  return formatRealDate(value);
}

function getAbsenceManagementRoleIds() {
  const conf = loadJSON(CONFIG_PATH, {});
  const levels = conf.VORTEX_ACCESS_ROLES || {};
  return [
    ...MASTER_ROLE_IDS,
    ...(Array.isArray(levels.admin) ? levels.admin : []),
    ...(Array.isArray(levels.medio) ? levels.medio : []),
  ].map(String).filter(Boolean).filter((roleId, index, list) => list.indexOf(roleId) === index);
}

function formatDuration(ms = 0) {
  const totalMinutes = Math.max(0, Math.ceil(ms / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes || parts.length === 0) parts.push(`${minutes}m`);
  return parts.join(' ');
}

function parseAbsenceDate(input, now = new Date(), endOfDay = false) {
  const raw = String(input || '').trim().toLowerCase();
  const dateMatch = raw.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{4}))?$/);
  if (dateMatch) {
    const day = Number(dateMatch[1]);
    const month = Number(dateMatch[2]) - 1;
    let year = dateMatch[3] ? Number(dateMatch[3]) : now.getFullYear();
    let date = new Date(year, month, day, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
    if (Number.isNaN(date.getTime())) return null;
    if (date.getDate() !== day || date.getMonth() !== month || date.getFullYear() !== year) return null;
    if (!dateMatch[3] && date.getTime() < new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) {
      year += 1;
      date = new Date(year, month, day, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
      if (date.getDate() !== day || date.getMonth() !== month || date.getFullYear() !== year) return null;
    }
    return date;
  }

  return null;
}

function parsePeriod(input, now = new Date()) {
  return parseAbsenceDate(input, now, true);
}

function readAbsences() {
  return loadJSON(AUSENCIAS_PATH, {});
}

function writeAbsences(data) {
  saveJSON(AUSENCIAS_PATH, data);
}

function saveAbsence(absence) {
  const data = readAbsences();
  if (!data[absence.guildId]) data[absence.guildId] = {};
  data[absence.guildId][absence.userId] = absence;
  writeAbsences(data);
  return absence;
}

function getGuildAbsences(guildId) {
  const data = readAbsences();
  return Object.values(data[guildId] || {});
}

function getActiveGuildAbsences(guildId) {
  return getGuildAbsences(guildId).filter((absence) => absence.status === 'active');
}

function getOpenGuildAbsences(guildId) {
  return getGuildAbsences(guildId).filter((absence) => ['pending', 'scheduled', 'active'].includes(absence.status));
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

function buildAbsenceRequestEmbed(absence) {
  return new EmbedBuilder()
    .setColor('#FEE75C')
    .setTitle('📋 Solicitação de Ausência')
    .setDescription([
      `<@${absence.userId}> enviou uma solicitação de ausência e aguarda análise da administração.`,
      '',
      'Confira motivo, início e retorno antes de aprovar. Se faltar informação, recuse e peça para o usuário enviar novamente com mais detalhes.',
    ].join('\n'))
    .addFields(
      { name: '👤 Solicitante', value: `<@${absence.userId}>`, inline: true },
      { name: 'Nome informado', value: absence.name || 'N/A', inline: true },
      { name: 'ID Discord', value: `\`${absence.discordId || absence.userId}\``, inline: true },
      { name: '📝 Motivo informado', value: absence.reason || 'N/A', inline: false },
      { name: '📅 Início', value: absence.startDateInput || formatDate(absence.startsAt), inline: true },
      { name: '↩️ Retorno previsto', value: formatDate(absence.endsAt), inline: true },
      { name: 'Próxima ação', value: 'Use os botões abaixo para **aceitar** ou **recusar** esta solicitação.', inline: false }
    )
    .setFooter({ text: 'Vortex • Aprovação de Ausência' })
    .setTimestamp();
}

function buildAbsenceDecisionRow(userId, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ausencia_accept_${userId}`)
      .setLabel('Ausência aceita')
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`ausencia_reject_${userId}`)
      .setLabel('Ausência recusada')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled)
  );
}

async function createAbsenceRequestChannel(interaction, absence) {
  const category = await interaction.guild.channels.fetch(ABSENCE_REQUEST_CATEGORY_ID).catch(() => null);
  if (!category || category.type !== ChannelType.GuildCategory) {
    return { ok: false, message: `Categoria de ausência <#${ABSENCE_REQUEST_CATEGORY_ID}> não encontrada.`, channel: null };
  }

  const channel = await interaction.guild.channels.create({
    name: `ausencia | ${sanitizeChannelName(absence.name || interaction.user.username)}`,
    type: ChannelType.GuildText,
    parent: category.id,
    topic: `ausencia | ${absence.name || interaction.user.username} | ${absence.userId}`,
    permissionOverwrites: [
      { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: interaction.client.user.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory],
      },
      ...getAbsenceManagementRoleIds().map((roleId) => ({
        id: roleId,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
      })),
      ...getMasterUserIds().map((userId) => ({
        id: userId,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory],
      })),
    ],
    reason: `Solicitação de ausência de ${absence.userId}`,
  });

  await channel.send({
    content: `<@&${ABSENCE_REQUEST_MENTION_ROLE_ID}>`,
    embeds: [buildAbsenceRequestEmbed(absence)],
    components: [buildAbsenceDecisionRow(absence.userId)],
    allowedMentions: { roles: [ABSENCE_REQUEST_MENTION_ROLE_ID] },
  }).catch(() => null);

  return { ok: true, channel };
}

async function sendAbsenceLog(client, guildId, absence, action = 'created') {
  if (!isPrimaryGuild(guildId)) return false;
  const config = getAbsenceConfig();
  const channel = await client.channels.fetch(config.logChannelId).catch(() => null);
  if (!isPrimaryGuildChannel(channel)) return false;
  if (!channel?.isTextBased?.()) return false;

  const isCreated = action === 'created';
  const isScheduled = action === 'scheduled';
  const isUpdated = action === 'updated';
  const isRemoved = action === 'removed';
  const embed = new EmbedBuilder()
    .setColor(isCreated ? '#7000FF' : isScheduled ? '#5865F2' : isUpdated ? '#FEE75C' : isRemoved ? '#ED4245' : '#57F287')
    .setTitle(isCreated ? 'Ausência Registrada' : isScheduled ? 'Ausência Agendada' : isUpdated ? 'Retorno de Ausência Alterado' : isRemoved ? 'Ausência Retirada' : 'Ausência Finalizada')
    .setDescription(isCreated
      ? `O usuário <@${absence.userId}> entrou em modo ausência e recebeu o cargo <@&${absence.roleId}>.`
      : isScheduled
        ? `A ausência de <@${absence.userId}> foi aprovada e será ativada em ${formatDate(absence.startsAt)}.`
        : isUpdated
          ? `A data de retorno de <@${absence.userId}> foi alterada por <@${absence.updatedBy}>.`
          : isRemoved
            ? `O usuário <@${absence.userId}> retirou a própria ausência e o cargo <@&${absence.roleId}> foi removido.`
            : `A ausência de <@${absence.userId}> terminou e o cargo <@&${absence.roleId}> foi removido.`)
    .addFields(
      { name: 'Nome', value: absence.name || 'N/A', inline: true },
      { name: 'ID', value: `\`${absence.discordId || absence.userId}\``, inline: true },
      { name: 'Motivo', value: absence.reason || 'N/A', inline: false },
      { name: 'Início informado', value: absence.startDateInput || formatDate(absence.startsAt || absence.startedAt), inline: true },
      { name: 'Início', value: formatDate(absence.startsAt || absence.startedAt), inline: true },
      { name: 'Fim', value: formatDate(absence.endsAt), inline: true },
      { name: 'Cargo de ausência', value: `<@&${absence.roleId}>`, inline: true }
    )
    .setFooter({ text: `Vortex - Sistema de Ausência • ${guildId}` })
    .setTimestamp();

  await channel.send({ embeds: [embed] }).catch(() => null);
  return true;
}

async function createAbsence(interaction, { reason, startDateInput, returnDateInput, periodInput, name = null }) {
  const config = getAbsenceConfig();
  const now = new Date();
  const rawStartInput = startDateInput || periodInput;
  const rawReturnInput = returnDateInput || periodInput;
  const startsAt = parseAbsenceDate(rawStartInput, now, false);
  const endsAt = parseAbsenceDate(rawReturnInput, now, true);
  if (!startsAt || !endsAt) {
    return {
      ok: false,
      message: 'Datas inválidas. Use `DD/MM` ou `DD/MM/AAAA` no dia que vai para ausência e no dia que volta. Ausência por hora não é aceita.',
    };
  }
  if (endsAt.getTime() <= now.getTime()) {
    return { ok: false, message: 'A data de retorno precisa ser futura.' };
  }
  if (endsAt.getTime() < startsAt.getTime()) {
    return { ok: false, message: 'A data de retorno precisa ser igual ou depois da data de início da ausência.' };
  }

  const targetId = interaction.user.id;
  const nameValue = (name ? String(name).trim() : '') || interaction.member?.displayName || interaction.user.username || `Usuário ${targetId}`;

  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) {
    return { ok: false, message: 'Não consegui encontrar seu membro no servidor.' };
  }

  const role = await interaction.guild.roles.fetch(config.roleId).catch(() => null);
  if (!role) {
    return { ok: false, message: `Cargo de ausência <@&${config.roleId}> não encontrado.` };
  }

  const openAbsence = getOpenGuildAbsences(interaction.guild.id).find((absence) => absence.userId === interaction.user.id);
  if (member.roles.cache.has(role.id) || openAbsence) {
    return {
      ok: false,
      message: openAbsence?.status === 'pending'
        ? 'Você já possui uma solicitação de ausência aguardando aprovação.'
        : 'Solicitação recusada: você já está em ausência. Quando sua ausência acabar, você poderá solicitar outra. Se precisar alterar algo, entre em contato com a gerência para avaliarem seu caso.',
    };
  }

  let absence = saveAbsence({
    guildId: interaction.guild.id,
    userId: interaction.user.id,
    name: nameValue,
    discordId: targetId,
    reason: reason.trim(),
    startDateInput: String(rawStartInput || '').trim(),
    returnDateInput: String(rawReturnInput || '').trim(),
    periodInput: String(rawReturnInput || '').trim(),
    startsAt: startsAt.toISOString(),
    startedAt: null,
    endsAt: endsAt.toISOString(),
    status: 'pending',
    roleId: role.id,
    logChannelId: config.logChannelId,
    endMessageSentAt: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  });

  const channelResult = await createAbsenceRequestChannel(interaction, absence);
  if (!channelResult.ok) {
    const data = readAbsences();
    delete data[interaction.guild.id]?.[interaction.user.id];
    writeAbsences(data);
    return { ok: false, message: channelResult.message };
  }

  absence = {
    ...absence,
    requestChannelId: channelResult.channel.id,
    updatedAt: new Date().toISOString(),
  };
  saveAbsence(absence);

  return { ok: true, absence, channel: channelResult.channel };
}

async function notifyAbsenceDecision(client, guild, absence, approved) {
  const user = await client.users.fetch(absence.userId).catch(() => null);
  if (!user) return false;

  const embed = new EmbedBuilder()
    .setColor(approved ? '#57F287' : '#ED4245')
    .setTitle(approved ? 'Ausência aceita' : 'Ausência recusada')
    .setDescription(approved
      ? (absence.status === 'scheduled'
        ? 'Sua ausência foi aceita pela administração. O cargo será aplicado automaticamente no dia de início.'
        : 'Sua ausência foi aceita pela administração. O cargo de ausência foi aplicado.')
      : 'Sua ausência foi recusada. Tente da próxima.')
    .addFields(
      { name: 'Servidor', value: guild?.name || 'Vortex', inline: true },
      { name: 'Início solicitado', value: formatDate(absence.startsAt || absence.startedAt), inline: true },
      { name: 'Retorno solicitado', value: formatDate(absence.endsAt), inline: true },
      { name: 'Motivo informado', value: absence.reason || 'N/A', inline: false }
    )
    .setFooter({ text: 'Vortex - Sistema de Ausência' })
    .setTimestamp();

  await user.send({ embeds: [embed] });
  return true;
}

async function approveAbsenceRequest(interaction, userId) {
  const data = readAbsences();
  const absence = data[interaction.guild.id]?.[userId];
  if (!absence || absence.status !== 'pending') {
    return { ok: false, message: 'Essa solicitação de ausência não está pendente.' };
  }

  const config = getAbsenceConfig();
  const member = await interaction.guild.members.fetch(userId).catch(() => null);
  if (!member) return { ok: false, message: 'Usuário não encontrado no servidor.' };

  const role = await interaction.guild.roles.fetch(absence.roleId || config.roleId).catch(() => null);
  if (!role) return { ok: false, message: `Cargo de ausência <@&${absence.roleId || config.roleId}> não encontrado.` };

  const now = new Date();
  const startsAt = absence.startsAt ? new Date(absence.startsAt) : now;
  const startsNow = startsAt.getTime() <= now.getTime();
  if (startsNow) {
    await member.roles.add(role.id, `Ausência aprovada por ${interaction.user.id}`);
  }

  const next = {
    ...absence,
    status: startsNow ? 'active' : 'scheduled',
    roleId: role.id,
    startsAt: startsAt.toISOString(),
    startedAt: startsNow ? now.toISOString() : null,
    approvedBy: interaction.user.id,
    approvedAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  data[interaction.guild.id][userId] = next;
  writeAbsences(data);

  await notifyAbsenceDecision(interaction.client, interaction.guild, next, true).catch(() => null);
  await sendAbsenceLog(interaction.client, interaction.guild.id, next, startsNow ? 'created' : 'scheduled');

  return { ok: true, absence: next };
}

async function rejectAbsenceRequest(interaction, userId) {
  const data = readAbsences();
  const absence = data[interaction.guild.id]?.[userId];
  if (!absence || absence.status !== 'pending') {
    return { ok: false, message: 'Essa solicitação de ausência não está pendente.' };
  }

  const now = new Date();
  const next = {
    ...absence,
    status: 'rejected',
    rejectedBy: interaction.user.id,
    rejectedAt: now.toISOString(),
    finishedAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  data[interaction.guild.id][userId] = next;
  writeAbsences(data);

  await notifyAbsenceDecision(interaction.client, interaction.guild, next, false).catch(() => null);

  return { ok: true, absence: next };
}

async function removeOwnAbsence(interaction) {
  const data = readAbsences();
  const absence = data[interaction.guild.id]?.[interaction.user.id];
  if (!absence || absence.status !== 'active') {
    return { ok: false, message: 'Você não possui ausência ativa para retirar.' };
  }

  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (member && absence.roleId) {
    await member.roles.remove(absence.roleId, 'Ausência retirada pelo usuário no sistema Vortex').catch(() => null);
  }

  const now = new Date();
  const next = {
    ...absence,
    status: 'removed',
    removedBy: interaction.user.id,
    removedAt: now.toISOString(),
    finishedAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };

  data[interaction.guild.id][interaction.user.id] = next;
  writeAbsences(data);
  await sendAbsenceLog(interaction.client, interaction.guild.id, next, 'removed');

  return { ok: true, absence: next };
}

async function notifyAbsenceReturnChanged(client, guild, absence, oldEndsAt) {
  const user = await client.users.fetch(absence.userId).catch(() => null);
  if (!user) return false;

  const embed = new EmbedBuilder()
    .setColor('#FEE75C')
    .setTitle('Retorno de Ausência Alterado')
    .setDescription('Sua data de retorno de ausência foi alterada pela gerência.')
    .addFields(
      { name: 'Servidor', value: guild?.name || 'Vortex', inline: true },
      { name: 'Retorno anterior', value: formatDate(oldEndsAt), inline: true },
      { name: 'Novo retorno', value: formatDate(absence.endsAt), inline: true },
      { name: 'Alterado por', value: `<@${absence.updatedBy}>`, inline: true }
    )
    .setFooter({ text: 'Vortex - Sistema de Ausência' })
    .setTimestamp();

  await user.send({ embeds: [embed] });
  return true;
}

async function updateAbsenceReturn(client, guild, userId, returnInput, staffId) {
  const data = readAbsences();
  const absence = data[guild.id]?.[userId];
  if (!absence || absence.status !== 'active') {
    return { ok: false, message: 'Não existe ausência ativa para este usuário.' };
  }

  const nextEndsAt = parseAbsenceDate(returnInput, new Date(), true);
  if (!nextEndsAt) {
    return {
      ok: false,
      message: 'Retorno inválido. Use data `DD/MM` ou `DD/MM/AAAA`. Ausência por hora não é aceita.',
    };
  }
  if (nextEndsAt.getTime() <= Date.now()) {
    return { ok: false, message: 'O novo retorno precisa ser uma data futura.' };
  }
  const startsAt = absence.startsAt || absence.startedAt;
  if (startsAt && nextEndsAt.getTime() < new Date(startsAt).getTime()) {
    return { ok: false, message: 'O novo retorno precisa ser igual ou depois da data de início da ausência.' };
  }

  const oldEndsAt = absence.endsAt;
  const next = {
    ...absence,
    returnDateInput: returnInput.trim(),
    periodInput: returnInput.trim(),
    previousEndsAt: oldEndsAt,
    endsAt: nextEndsAt.toISOString(),
    updatedBy: staffId,
    updatedAt: new Date().toISOString(),
  };

  data[guild.id][userId] = next;
  writeAbsences(data);

  let dmSent = false;
  await notifyAbsenceReturnChanged(client, guild, next, oldEndsAt)
    .then(() => { dmSent = true; })
    .catch(() => { dmSent = false; });

  await sendAbsenceLog(client, guild.id, next, 'updated');

  return { ok: true, absence: next, oldEndsAt, dmSent };
}

async function startScheduledAbsence(client, guild, absence, data) {
  const member = await guild.members.fetch(absence.userId).catch(() => null);
  if (member && absence.roleId) {
    await member.roles.add(absence.roleId, 'Ausência iniciada automaticamente pelo sistema Vortex').catch(() => null);
  }

  const now = new Date();
  const next = {
    ...absence,
    status: 'active',
    startedAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };

  if (!data[guild.id]) data[guild.id] = {};
  data[guild.id][absence.userId] = next;
  await sendAbsenceLog(client, guild.id, next, 'created');
  return next;
}

async function finishAbsence(client, guild, absence, data) {
  const member = await guild.members.fetch(absence.userId).catch(() => null);
  if (member) {
    await member.roles.remove(absence.roleId, 'Ausência finalizada pelo sistema Vortex').catch(() => null);
  }

  const now = new Date();
  const next = {
    ...absence,
    status: 'finished',
    finishedAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };

  if (!data[guild.id]) data[guild.id] = {};
  data[guild.id][absence.userId] = next;

  const config = getAbsenceConfig();
  if (!config.disableEndMessage) {
    const channel = await client.channels.fetch(config.logChannelId).catch(() => null);
    if (isPrimaryGuildChannel(channel) && channel?.isTextBased?.()) {
      await channel.send({
        content: `<@${absence.userId}> Hoje é seu último dia de ausência, está na hora de trabalhar.`,
      }).catch(() => null);
      next.endMessageSentAt = now.toISOString();
    }
  }

  await sendAbsenceLog(client, guild.id, next, 'finished');
}

async function checkExpiredAbsences(client) {
  const data = readAbsences();
  const now = Date.now();

  for (const [guildId, guildAbsences] of Object.entries(data)) {
    if (!isPrimaryGuild(guildId)) continue;
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) continue;

    for (const absence of Object.values(guildAbsences || {})) {
      if (absence.status === 'scheduled' && absence.startsAt && new Date(absence.startsAt).getTime() <= now) {
        await startScheduledAbsence(client, guild, absence, data).catch((error) => {
          logger.error('Erro ao iniciar ausência agendada:', error);
        });
        continue;
      }
      if (absence.status !== 'active') continue;
      if (!absence.endsAt || new Date(absence.endsAt).getTime() > now) continue;

      await finishAbsence(client, guild, absence, data).catch((error) => {
        logger.error('Erro ao finalizar ausência:', error);
      });
    }
  }

  writeAbsences(data);
}

function initAbsenceManager(client) {
  if (interval) clearInterval(interval);
  checkExpiredAbsences(client).catch((error) => logger.error('Erro ao checar ausências no início:', error));
  interval = setInterval(() => {
    checkExpiredAbsences(client).catch((error) => logger.error('Erro ao checar ausências:', error));
  }, CHECK_INTERVAL_MS);
}

module.exports = {
  DEFAULT_ABSENCE_ROLE_ID,
  DEFAULT_ABSENCE_LOG_CHANNEL_ID,
  getAbsenceConfig,
  saveAbsenceConfig,
  getGuildAbsences,
  getActiveGuildAbsences,
  createAbsence,
  approveAbsenceRequest,
  rejectAbsenceRequest,
  updateAbsenceReturn,
  removeOwnAbsence,
  initAbsenceManager,
  parsePeriod,
  parseAbsenceDate,
  formatDate,
  formatDuration,
};
