const fs = require('fs');
const path = require('path');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
} = require('discord.js');
const {
  adjustPointSessionFlexible,
  correctOpenPointCloseTime,
  formatDate,
  formatDuration,
  parseFlexiblePointAdjustment,
} = require('./pontoManager');
const { getPointConfig } = require('./pontoPanel');
const { createPointActionTranscriptSummary } = require('./pointTranscriptNotifier');

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

function hasRangeAdjustment(request = {}) {
  return Boolean(request.pointDateInput && request.startedAtInput && request.closedAtInput);
}

function buildTimeRangeInput(request = {}) {
  return `${request.startedAtInput || ''} ate ${request.closedAtInput || ''}`.trim();
}

function buildRequestDataLines(request = {}) {
  const lines = hasRangeAdjustment(request)
    ? [
        `Data do ponto: \`${request.pointDateInput}\``,
        `Entrada informada: \`${request.startedAtInput}\``,
        `Saida informada: \`${request.closedAtInput}\``,
      ]
    : [
        `Horario correto de saida: \`${request.closedAtInput || 'N/A'}\``,
      ];

  lines.push(`Motivo: ${request.reason || 'N/A'}`);
  return lines;
}

function buildRequestEmbed(interaction, request) {
  return new EmbedBuilder()
    .setColor('#FEE75C')
    .setAuthor({ name: 'VORTEX | Ajuste de Ponto', iconURL: interaction.client.user.displayAvatarURL() })
    .setTitle('🛠️ Pedido de ajuste de ponto')
    .setDescription([
      '<@' + interaction.user.id + '> solicitou correção de ponto.',
      '',
      '**Dados informados**',
      ...buildRequestDataLines(request),
      '',
      '**Para a staff**',
      hasRangeAdjustment(request)
        ? 'Ao aceitar, o ponto sera reajustado com a entrada e saida informadas, mesmo se nao estiver aberto.'
        : 'Ao aceitar, o ponto aberto sera fechado automaticamente no horario informado.',
    ].join('\n'))
    .setTimestamp()
    .setFooter({ text: 'Vortex • Sistema de Ponto' });
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

async function createAdjustmentRequest(interaction, pointDateInput, startedAtInput, closedAtInput, reason) {
  if (arguments.length === 3) {
    reason = startedAtInput;
    closedAtInput = pointDateInput;
    pointDateInput = null;
    startedAtInput = null;
  }

  const requestInput = {
    pointDateInput: String(pointDateInput || '').trim(),
    startedAtInput: String(startedAtInput || '').trim(),
    closedAtInput: String(closedAtInput || '').trim(),
    reason: String(reason || '').trim(),
  };

  if (hasRangeAdjustment(requestInput)) {
    const parsed = parseFlexiblePointAdjustment(requestInput.pointDateInput, buildTimeRangeInput(requestInput));
    if (!parsed.ok) {
      return { ok: false, message: parsed.message };
    }
    if (parsed.closedAt.getTime() > Date.now()) {
      return { ok: false, message: 'O horario de saida nao pode estar no futuro.' };
    }
  }

  const pointConfig = getPointConfig();
  const category = await interaction.guild.channels.fetch(pointConfig.adjustCategoryId).catch(() => null);
  if (!category) {
    return { ok: false, message: `Categoria de ajuste não encontrada: <#${pointConfig.adjustCategoryId}>.` };
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
    ...requestInput,
    status: 'pending',
    createdBy: interaction.user.id,
    createdAt: new Date().toISOString(),
  };
  saveRequest(request);

  await channel.send({
    content: `<@${interaction.user.id}> ${staffRoleIds.map((roleId) => `<@&${roleId}>`).join(' ')}`,
    embeds: [buildRequestEmbed(interaction, request)],
    components: [buildDecisionRow(requestId)],
    allowedMentions: { users: [interaction.user.id], roles: staffRoleIds },
  });

  return { ok: true, channel, request };
}

async function decideAdjustment(interaction, requestId, approved) {
  if (!hasPointStaffPermission(interaction.member)) {
    return { ok: false, message: 'Sem permissão para analisar ajuste de ponto.' };
  }

  const request = getRequest(requestId);
  if (!request) return { ok: false, message: 'Solicitação de ajuste não encontrada.' };
  if (request.status !== 'pending') return { ok: false, message: 'Esta solicitação já foi analisada.' };

  if (!approved) {
    updateRequest(requestId, {
      status: 'rejected',
      decidedBy: interaction.user.id,
      decidedAt: new Date().toISOString(),
    });
    await sendAdjustmentDecisionDm(interaction, request, false, null).catch(() => {});
    return { ok: true, status: 'rejected', message: `Ajuste recusado.\nUsuário: <@${request.userId}>\nNegado por: <@${interaction.user.id}>` };
  }

  const result = hasRangeAdjustment(request)
    ? await adjustPointSessionFlexible(
        request.guildId,
        request.userId,
        request.pointDateInput,
        buildTimeRangeInput(request),
        interaction.member,
        request.reason
      )
    : await correctOpenPointCloseTime(
        request.guildId,
        request.userId,
        request.closedAtInput,
        interaction.member,
        request.reason
      );

  if (!result.ok) {
    return { ok: false, message: result.message };
  }

  updateRequest(requestId, {
    status: 'approved',
    decidedBy: interaction.user.id,
    decidedAt: new Date().toISOString(),
    startedAt: result.startedAt || null,
    closedAt: result.closedAt,
    durationMs: result.durationMs,
  });

  await sendAdjustmentDecisionDm(interaction, request, true, result).catch(() => {});

  return {
    ok: true,
    status: 'approved',
    message: [
      hasRangeAdjustment(request) ? 'Ajuste aprovado e ponto reajustado.' : 'Ajuste aprovado e ponto fechado automaticamente.',
      `Usuário: <@${request.userId}>`,
      result.startedAt ? `Entrada aplicada: ${formatDate(result.startedAt)}` : null,
      `Saida aplicada: ${formatDate(result.closedAt)}`,
      `Tempo contabilizado: ${formatDuration(result.durationMs)}`,
    ].filter(Boolean).join('\n'),
    result,
    request,
  };
}

async function sendAdjustmentDecisionDm(interaction, request, approved, result) {
  const user = await interaction.client.users.fetch(request.userId).catch(() => null);
  if (!user) return false;

  if (approved && result) {
    const summary = await createPointActionTranscriptSummary({
      guild: interaction.guild,
      target: user,
      generatedBy: interaction.user,
      action: 'closed',
      result,
    });
    await user.send({
      content: [
        hasRangeAdjustment(request)
          ? '✅ Ajuste de ponto aprovado e reajustado.'
          : '✅ Ajuste de ponto aprovado e ponto fechado automaticamente.',
        `Aprovado por: <@${interaction.user.id}>`,
        `Motivo informado: ${request.reason}`,
        '',
        summary.content,
      ].join('\n'),
      allowedMentions: { users: [interaction.user.id] },
    });
    return true;
  }

  const embed = new EmbedBuilder()
    .setColor(approved ? '#57F287' : '#ED4245')
    .setAuthor({ name: 'VORTEX | Ajuste de Ponto', iconURL: interaction.client.user.displayAvatarURL() })
    .setTitle(approved ? '✅ Ajuste de ponto aprovado' : '❌ Ajuste de ponto recusado')
    .setDescription([
      `Usuário: <@${request.userId}>`,
      ...buildRequestDataLines(request),
      approved ? `Aprovado por: <@${interaction.user.id}>` : `Recusado por: <@${interaction.user.id}>`,
      approved && result?.startedAt ? `Entrada aplicada: ${formatDate(result.startedAt)}` : null,
      approved && result ? `Saida aplicada: ${formatDate(result.closedAt)}` : null,
      approved && result ? `Tempo contabilizado: ${formatDuration(result.durationMs)}` : null,
    ].filter(Boolean).join('\n'))
    .setImage(`attachment://${VORTEX_PANEL_IMAGE_NAME}`)
    .setTimestamp()
    .setFooter({ text: 'Vortex • Sistema de Ponto' });

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
