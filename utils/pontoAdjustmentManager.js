const fs = require('fs');
const path = require('path');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
} = require('discord.js');
const { correctOpenPointCloseTime, formatDate, formatDuration } = require('./pontoManager');
const { getPointConfig } = require('./pontoPanel');

const REQUESTS_PATH = path.join(__dirname, '..', 'commands', 'pontoAdjustRequests.json');
const CONFIG_PATH = path.join(__dirname, '..', 'commands', 'config.json');
const VORTEX_PANEL_IMAGE = path.join(__dirname, '..', 'foto', 'IMG_4234.png');
const VORTEX_PANEL_IMAGE_NAME = 'IMG_4234.png';
const MASTER_ROLE_ID = '1497703127074345040';

function ensureFile() {
  if (!fs.existsSync(REQUESTS_PATH)) {
    fs.writeFileSync(REQUESTS_PATH, `${JSON.stringify({}, null, 2)}\n`, 'utf8');
  }
}

function readJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8') || '{}');
  } catch {
    return {};
  }
}

function writeRequests(data) {
  ensureFile();
  fs.writeFileSync(REQUESTS_PATH, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function getStaffRoleIds() {
  const config = readJSON(CONFIG_PATH);
  const pointConfig = getPointConfig();
  const levels = config.VORTEX_ROLE_LEVELS || {};
  return [...new Set([
    MASTER_ROLE_ID,
    ...(Array.isArray(levels.admin) ? levels.admin : []),
    ...pointConfig.adjustStaffRoleIds,
  ].filter(Boolean).map(String))];
}

function hasPointStaffPermission(member) {
  if (!member?.roles?.cache) return false;
  return getStaffRoleIds().some((roleId) => member.roles.cache.has(roleId));
}

function normalizeChannelName(user) {
  return `ajuste-ponto-${user.username}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 90);
}

function buildRequestEmbed(interaction, closedAtInput, reason) {
  return new EmbedBuilder()
    .setColor('#FEE75C')
    .setAuthor({ name: 'VORTEX | Ajuste de Ponto', iconURL: interaction.client.user.displayAvatarURL() })
    .setTitle('Solicitacao de ajuste de ponto')
    .setDescription([
      'Um usuario solicitou fechamento manual do ponto.',
      '',
      '**Dados informados**',
      `Usuario: <@${interaction.user.id}>`,
      `Horario correto de saida: \`${closedAtInput}\``,
      `Motivo: ${reason}`,
      '',
      '**Analise**',
      'Ao aceitar, o ponto aberto do usuario sera fechado automaticamente no horario informado.',
    ].join('\n'))
    .setTimestamp()
    .setFooter({ text: 'Vortex - Sistema de Ponto' });
}

function buildDecisionRow(requestId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ponto_adjust_accept_${requestId}`)
      .setLabel('Aceitar ajuste')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`ponto_adjust_reject_${requestId}`)
      .setLabel('Recusar ajuste')
      .setStyle(ButtonStyle.Danger)
  );
}

function saveRequest(request) {
  const data = readJSON(REQUESTS_PATH);
  data[request.id] = request;
  writeRequests(data);
}

function getRequest(requestId) {
  return readJSON(REQUESTS_PATH)[requestId] || null;
}

function updateRequest(requestId, patch) {
  const data = readJSON(REQUESTS_PATH);
  if (!data[requestId]) return null;
  data[requestId] = { ...data[requestId], ...patch, updatedAt: new Date().toISOString() };
  writeRequests(data);
  return data[requestId];
}

async function createAdjustmentRequest(interaction, closedAtInput, reason) {
  const pointConfig = getPointConfig();
  const category = await interaction.guild.channels.fetch(pointConfig.adjustCategoryId).catch(() => null);
  if (!category) {
    return { ok: false, message: `Categoria de ajuste nao encontrada: <#${pointConfig.adjustCategoryId}>.` };
  }

  const staffRoleIds = getStaffRoleIds();
  const permissionOverwrites = [
    { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
    { id: interaction.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory] },
    ...staffRoleIds.map((roleId) => ({
      id: roleId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
    })),
  ];

  const channel = await interaction.guild.channels.create({
    name: normalizeChannelName(interaction.user),
    parent: pointConfig.adjustCategoryId,
    permissionOverwrites,
  });

  const requestId = `${Date.now()}${interaction.user.id}`.slice(0, 32);
  const request = {
    id: requestId,
    guildId: interaction.guild.id,
    channelId: channel.id,
    userId: interaction.user.id,
    closedAtInput,
    reason,
    status: 'pending',
    createdBy: interaction.user.id,
    createdAt: new Date().toISOString(),
  };
  saveRequest(request);

  await channel.send({
    content: `<@${interaction.user.id}> ${staffRoleIds.map((roleId) => `<@&${roleId}>`).join(' ')}`,
    embeds: [buildRequestEmbed(interaction, closedAtInput, reason)],
    components: [buildDecisionRow(requestId)],
    allowedMentions: { users: [interaction.user.id], roles: staffRoleIds },
  });

  return { ok: true, channel, request };
}

async function decideAdjustment(interaction, requestId, approved) {
  if (!hasPointStaffPermission(interaction.member)) {
    return { ok: false, message: 'Sem permissao para analisar ajuste de ponto.' };
  }

  const request = getRequest(requestId);
  if (!request) return { ok: false, message: 'Solicitacao de ajuste nao encontrada.' };
  if (request.status !== 'pending') return { ok: false, message: 'Esta solicitacao ja foi analisada.' };

  if (!approved) {
    updateRequest(requestId, {
      status: 'rejected',
      decidedBy: interaction.user.id,
      decidedAt: new Date().toISOString(),
    });
    await sendAdjustmentDecisionDm(interaction, request, false, null).catch(() => {});
    return { ok: true, status: 'rejected', message: `Ajuste recusado.\nUsuario: <@${request.userId}>\nNegado por: <@${interaction.user.id}>` };
  }

  const result = await correctOpenPointCloseTime(
    request.guildId,
    request.userId,
    request.closedAtInput,
    interaction.user.id
  );

  if (!result.ok) {
    return { ok: false, message: result.message };
  }

  updateRequest(requestId, {
    status: 'approved',
    decidedBy: interaction.user.id,
    decidedAt: new Date().toISOString(),
    closedAt: result.closedAt,
    durationMs: result.durationMs,
  });

  await sendAdjustmentDecisionDm(interaction, request, true, result).catch(() => {});

  return {
    ok: true,
    status: 'approved',
    message: [
      'Ajuste aprovado e ponto fechado automaticamente.',
      `Usuario: <@${request.userId}>`,
      `Fechamento aplicado: ${formatDate(result.closedAt)}`,
      `Tempo contabilizado: ${formatDuration(result.durationMs)}`,
    ].join('\n'),
    result,
    request,
  };
}

async function sendAdjustmentDecisionDm(interaction, request, approved, result) {
  const user = await interaction.client.users.fetch(request.userId).catch(() => null);
  if (!user) return false;

  const embed = new EmbedBuilder()
    .setColor(approved ? '#57F287' : '#ED4245')
    .setAuthor({ name: 'VORTEX | Ajuste de Ponto', iconURL: interaction.client.user.displayAvatarURL() })
    .setTitle(approved ? 'Ajuste de ponto aprovado' : 'Ajuste de ponto recusado')
    .setDescription([
      `Usuario: <@${request.userId}>`,
      `Horario solicitado: \`${request.closedAtInput}\``,
      `Motivo informado: ${request.reason}`,
      approved ? `Aceito por: <@${interaction.user.id}>` : `Negado por: <@${interaction.user.id}>`,
      approved && result ? `Fechamento aplicado: ${formatDate(result.closedAt)}` : null,
      approved && result ? `Tempo contabilizado: ${formatDuration(result.durationMs)}` : null,
    ].filter(Boolean).join('\n'))
    .setImage(`attachment://${VORTEX_PANEL_IMAGE_NAME}`)
    .setTimestamp()
    .setFooter({ text: 'Vortex - Sistema de Ponto' });

  await user.send({
    embeds: [embed],
    files: [{ attachment: VORTEX_PANEL_IMAGE, name: VORTEX_PANEL_IMAGE_NAME }],
  });
  return true;
}

module.exports = {
  createAdjustmentRequest,
  decideAdjustment,
  hasPointStaffPermission,
};
