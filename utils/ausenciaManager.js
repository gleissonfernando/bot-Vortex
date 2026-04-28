const fs = require('fs');
const path = require('path');
const { EmbedBuilder } = require('discord.js');
const { logger } = require('./logger');
const { formatDate: formatRealDate } = require('./pontoManager');

const AUSENCIAS_PATH = path.join(__dirname, '..', 'commands', 'ausencias.json');
const CONFIG_PATH = path.join(__dirname, '..', 'commands', 'config.json');
const DEFAULT_ABSENCE_ROLE_ID = '1498359212252725339';
const DEFAULT_ABSENCE_LOG_CHANNEL_ID = '1498359968087146516';
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

function parsePeriod(input, now = new Date()) {
  const raw = String(input || '').trim().toLowerCase();
  const hoursTimeMatch = raw.match(/^(\d{1,3}):(\d{2})$/);
  if (hoursTimeMatch) {
    const hours = Number(hoursTimeMatch[1]);
    const minutes = Number(hoursTimeMatch[2]);
    if (hours < 0 || minutes < 0 || minutes > 59) return null;
    const totalMs = (hours * 60 + minutes) * 60 * 1000;
    if (totalMs <= 0) return null;
    return new Date(now.getTime() + totalMs);
  }

  const hoursMatch = raw.match(/^(\d{1,4})\s*h$/i);
  if (hoursMatch) {
    const hours = Number(hoursMatch[1]);
    if (hours <= 0) return null;
    return new Date(now.getTime() + hours * 60 * 60 * 1000);
  }

  const daysMatch = raw.match(/^(\d{1,3})(?:\s*(?:d|dia|dias))?$/i);
  if (daysMatch) {
    const days = Number(daysMatch[1]);
    if (days <= 0) return null;
    return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  }

  const dateMatch = raw.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{4}))?$/);
  if (dateMatch) {
    const day = Number(dateMatch[1]);
    const month = Number(dateMatch[2]) - 1;
    let year = dateMatch[3] ? Number(dateMatch[3]) : now.getFullYear();
    let end = new Date(year, month, day, 23, 59, 59, 999);
    if (Number.isNaN(end.getTime())) return null;
    if (end.getDate() !== day || end.getMonth() !== month || end.getFullYear() !== year) return null;
    if (!dateMatch[3] && end.getTime() <= now.getTime()) {
      year += 1;
      end = new Date(year, month, day, 23, 59, 59, 999);
      if (end.getDate() !== day || end.getMonth() !== month || end.getFullYear() !== year) return null;
    }
    if (end.getTime() <= now.getTime()) return null;
    return end;
  }

  return null;
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

async function sendAbsenceLog(client, guildId, absence, action = 'created') {
  const config = getAbsenceConfig();
  const channel = await client.channels.fetch(config.logChannelId).catch(() => null);
  if (!channel?.isTextBased?.()) return false;

  const isCreated = action === 'created';
  const isUpdated = action === 'updated';
  const isRemoved = action === 'removed';
  const embed = new EmbedBuilder()
    .setColor(isCreated ? '#7000FF' : isUpdated ? '#FEE75C' : isRemoved ? '#ED4245' : '#57F287')
    .setTitle(isCreated ? 'Ausência Registrada' : isUpdated ? 'Retorno de Ausência Alterado' : isRemoved ? 'Ausência Retirada' : 'Ausência Finalizada')
    .setDescription(isCreated
      ? `O usuário <@${absence.userId}> entrou em modo ausência e recebeu o cargo <@&${absence.roleId}>.`
      : isUpdated
        ? `A data de retorno de <@${absence.userId}> foi alterada por <@${absence.updatedBy}>.`
        : isRemoved
          ? `O usuário <@${absence.userId}> retirou a própria ausência e o cargo <@&${absence.roleId}> foi removido.`
          : `A ausência de <@${absence.userId}> terminou e o cargo <@&${absence.roleId}> foi removido.`)
    .addFields(
      { name: 'Nome', value: absence.name || 'N/A', inline: true },
      { name: 'ID', value: `\`${absence.discordId || absence.userId}\``, inline: true },
      { name: 'Motivo', value: absence.reason || 'N/A', inline: false },
      { name: 'Período informado', value: absence.periodInput || 'N/A', inline: true },
      { name: 'Início', value: formatDate(absence.startedAt), inline: true },
      { name: 'Fim', value: formatDate(absence.endsAt), inline: true },
      { name: 'Tempo', value: formatDuration(new Date(absence.endsAt).getTime() - new Date(absence.startedAt).getTime()), inline: true },
      { name: 'Cargo de ausência', value: `<@&${absence.roleId}>`, inline: true }
    )
    .setFooter({ text: `Vortex - Sistema de Ausência • ${guildId}` })
    .setTimestamp();

  await channel.send({ embeds: [embed] }).catch(() => null);
  return true;
}

async function createAbsence(interaction, { name, discordId, reason, periodInput }) {
  const config = getAbsenceConfig();
  const endsAt = parsePeriod(periodInput);
  if (!endsAt) {
    return {
      ok: false,
      message: 'Período inválido. Para horas, use `12:00`, `2h`, `12h` ou similar. Para data, use `DD/MM` ou `DD/MM/AAAA`. Para dias, use quantidade como `3`.',
    };
  }

  const targetId = discordId.trim();
  if (targetId !== interaction.user.id) {
    return {
      ok: false,
      message: 'O ID informado precisa ser o seu ID do Discord.',
    };
  }

  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) {
    return { ok: false, message: 'Não consegui encontrar seu membro no servidor.' };
  }

  const role = await interaction.guild.roles.fetch(config.roleId).catch(() => null);
  if (!role) {
    return { ok: false, message: `Cargo de ausência <@&${config.roleId}> não encontrado.` };
  }

  const activeAbsence = getActiveGuildAbsences(interaction.guild.id).find((absence) => absence.userId === interaction.user.id);
  if (member.roles.cache.has(role.id) || activeAbsence) {
    return {
      ok: false,
      message: 'Solicitação recusada: você já está em ausência. Quando sua ausência acabar, você poderá solicitar outra. Se precisar alterar algo, entre em contato com a gerência para avaliarem seu caso.',
    };
  }

  await member.roles.add(role.id, 'Ausência registrada pelo sistema Vortex');

  const now = new Date();
  const absence = saveAbsence({
    guildId: interaction.guild.id,
    userId: interaction.user.id,
    name: name.trim(),
    discordId: targetId,
    reason: reason.trim(),
    periodInput: periodInput.trim(),
    startedAt: now.toISOString(),
    endsAt: endsAt.toISOString(),
    status: 'active',
    roleId: role.id,
    logChannelId: config.logChannelId,
    endMessageSentAt: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  });

  await sendAbsenceLog(interaction.client, interaction.guild.id, absence, 'created');

  return { ok: true, absence };
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

  const nextEndsAt = parsePeriod(returnInput);
  if (!nextEndsAt) {
    return {
      ok: false,
      message: 'Retorno inválido. Use data `DD/MM` ou `DD/MM/AAAA`, quantidade de dias como `3`, ou horas como `12:00`/`12h`.',
    };
  }

  const oldEndsAt = absence.endsAt;
  const next = {
    ...absence,
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
    if (channel?.isTextBased?.()) {
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
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) continue;

    for (const absence of Object.values(guildAbsences || {})) {
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
  updateAbsenceReturn,
  removeOwnAbsence,
  initAbsenceManager,
  parsePeriod,
  formatDate,
  formatDuration,
};
