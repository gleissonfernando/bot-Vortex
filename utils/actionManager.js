const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  ModalBuilder,
  SectionBuilder,
  SeparatorBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { buildThemedPanelPayload } = require('./panelTheme');
const { hasAnyVortexRole, hasVortexAccess, hasCommandRole, hasMasterAccess } = require('./permissions');
const { safeReply, safeShowModal, safeUpdate } = require('./safeReply');
const { formatLocalDate } = require('./dateTime');

const ACTIONS_PATH = path.join(__dirname, '..', 'commands', 'vortexActions.json');
const DEFAULT_REPORT_CHANNEL_ID = '1503862826262073474';
const selectedActions = new Map();

const STATUS_OPTIONS = ['Aberta', 'Em andamento', 'Finalizada', 'Cancelada'];
const FINAL_STATUSES = new Set(['Finalizada', 'Cancelada']);

function mongoReady() {
  return mongoose.connection?.readyState === 1 && mongoose.connection?.db;
}

function collection() {
  return mongoose.connection.db.collection('vortex_actions');
}

function readLocalStore() {
  try {
    return JSON.parse(fs.readFileSync(ACTIONS_PATH, 'utf8'));
  } catch {
    return { actions: [] };
  }
}

function writeLocalStore(store) {
  try {
    fs.writeFileSync(ACTIONS_PATH, JSON.stringify(store, null, 2));
  } catch {}
}

function normalizeStatus(value) {
  const raw = String(value || 'Aberta').trim();
  if (/^(vitoria|vitória|derrota)$/i.test(raw)) return 'Finalizada';
  const normalized = STATUS_OPTIONS.find((status) => status.toLowerCase() === raw.toLowerCase());
  return normalized || 'Aberta';
}

function normalizeParticipant(participant) {
  if (!participant) return null;
  const userId = String(participant.userId || participant.id || '').trim();
  if (!userId) return null;
  return {
    userId,
    tag: String(participant.tag || participant.username || participant.nome || 'Usuario'),
    addedAt: participant.addedAt || new Date().toISOString(),
  };
}

function normalizeParticipants(list) {
  const seen = new Set();
  return (Array.isArray(list) ? list : [])
    .map(normalizeParticipant)
    .filter(Boolean)
    .filter((participant) => {
      if (seen.has(participant.userId)) return false;
      seen.add(participant.userId);
      return true;
    });
}

function normalizeAction(action = {}) {
  const id = String(action.id || action.actionId || action.action_number || '').trim();
  const rawStatus = String(action.status || '').trim();
  const status = normalizeStatus(action.status);
  return {
    id,
    guildId: String(action.guildId || action.guild_id || ''),
    nome: String(action.nome || action.name || 'Acao Vortex'),
    data: String(action.data || action.date || ''),
    limite: Math.max(1, Number.parseInt(action.limite || action.limit || 1, 10) || 1),
    status,
    armamentos: String(action.armamentos || action.weapons || ''),
    valorRoubado: Number(action.valorRoubado ?? action.stolenValue ?? 0) || 0,
    negociador: String(action.negociador || action.negotiator || '').trim(),
    mvp: String(action.mvp || '').trim(),
    resultado: String(action.resultado || action.result || (/^(vitoria|vitória|derrota)$/i.test(rawStatus) ? rawStatus : '')).trim(),
    confirmados: normalizeParticipants(action.confirmados || action.confirmed),
    reservas: normalizeParticipants(action.reservas || action.reserves),
    canalId: String(action.canalId || action.channelId || ''),
    relatorioCanalId: String(action.relatorioCanalId || action.reportChannelId || action.relatorio_canal_id || DEFAULT_REPORT_CHANNEL_ID),
    mensagemId: String(action.mensagemId || action.messageId || ''),
    criadoPor: String(action.criadoPor || action.createdBy || ''),
    criadoEm: action.criadoEm || action.createdAt || new Date().toISOString(),
    iniciadaEm: action.iniciadaEm || action.iniciada_em || action.startedAt || '',
    finalizada: Boolean(action.finalizada || action.finished || FINAL_STATUSES.has(status)),
  };
}

function serializeForMongo(action) {
  return {
    ...action,
    guild_id: action.guildId,
    canal_id: action.canalId,
    relatorio_canal_id: action.relatorioCanalId,
    mensagem_id: action.mensagemId,
    criado_por: action.criadoPor,
    criado_em: action.criadoEm,
    iniciada_em: action.iniciadaEm,
    updatedAt: new Date(),
  };
}

async function listActions(guildId) {
  const gid = String(guildId || '');
  if (mongoReady()) {
    const docs = await collection().find({ guildId: gid }).sort({ criadoEm: -1 }).toArray();
    return docs.map(normalizeAction).filter((action) => action.guildId === gid);
  }
  const store = readLocalStore();
  return (store.actions || []).map(normalizeAction).filter((action) => action.guildId === gid);
}

async function getAction(guildId, actionId) {
  const id = String(actionId || '').trim();
  if (!id) return null;
  if (mongoReady()) {
    const doc = await collection().findOne({ guildId: String(guildId || ''), id });
    return doc ? normalizeAction(doc) : null;
  }
  return (await listActions(guildId)).find((action) => action.id === id) || null;
}

async function getLatestAction(guildId) {
  const actions = await listActions(guildId);
  return actions.find((action) => !action.finalizada) || actions[0] || null;
}

async function nextActionId(guildId) {
  const actions = await listActions(guildId);
  const max = actions.reduce((highest, action) => Math.max(highest, Number.parseInt(action.id, 10) || 0), 203);
  return String(max + 1);
}

async function saveAction(action) {
  const normalized = normalizeAction(action);
  if (mongoReady()) {
    await collection().updateOne(
      { guildId: normalized.guildId, id: normalized.id },
      { $set: serializeForMongo(normalized) },
      { upsert: true }
    );
    return normalized;
  }
  const store = readLocalStore();
  const actions = Array.isArray(store.actions) ? store.actions.map(normalizeAction) : [];
  const index = actions.findIndex((item) => item.guildId === normalized.guildId && item.id === normalized.id);
  if (index >= 0) actions[index] = normalized;
  else actions.unshift(normalized);
  writeLocalStore({ actions });
  return normalized;
}

async function deleteAction(guildId, actionId) {
  if (mongoReady()) {
    await collection().deleteOne({ guildId: String(guildId || ''), id: String(actionId || '') });
    return;
  }
  const store = readLocalStore();
  const actions = (store.actions || []).map(normalizeAction)
    .filter((action) => !(action.guildId === String(guildId || '') && action.id === String(actionId || '')));
  writeLocalStore({ actions });
}

function getSelectionKey(interaction) {
  return `${interaction.guildId}:${interaction.user?.id || 'system'}`;
}

function getSelectedActionId(interaction) {
  return selectedActions.get(getSelectionKey(interaction));
}

function setSelectedActionId(interaction, actionId) {
  selectedActions.set(getSelectionKey(interaction), String(actionId || ''));
}

function hasActionManagerPermission(member, userId = '') {
  return hasMasterAccess(member, userId)
    || hasVortexAccess(member, ['admin', 'medio'])
    || hasCommandRole(member, 'acao');
}

function hasActionUserPermission(member) {
  return hasAnyVortexRole(member) || hasActionManagerPermission(member);
}

function money(value) {
  const numeric = Number(value) || 0;
  return numeric.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function parseMoney(value) {
  const raw = String(value || '0').replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  return Number(raw) || 0;
}

function splitLines(value) {
  return String(value || '')
    .split(/\r?\n|,/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function formatParticipantList(list, emptyText) {
  const participants = normalizeParticipants(list);
  if (!participants.length) return emptyText;
  return participants
    .slice(0, 25)
    .map((participant, index) => `${index + 1}. <@${participant.userId}> | \`${participant.userId}\``)
    .join('\n');
}

function formatArmaments(value) {
  const lines = splitLines(value);
  if (!lines.length) return '1. Nao informado';
  return lines.map((line, index) => `${index + 1}. ${line}`).join('\n');
}

function parseChannelId(value) {
  const match = String(value || '').match(/\d{17,20}/);
  return match ? match[0] : '';
}

function parseActionChannels(value) {
  const ids = String(value || '').match(/\d{17,20}/g) || [];
  return {
    canalId: ids[0] || '',
    relatorioCanalId: ids[1] || DEFAULT_REPORT_CHANNEL_ID,
  };
}

function buildActionPanelPayload(action, interactionOrGuild = null) {
  const guild = interactionOrGuild?.guild || interactionOrGuild;
  const iconUrl = guild?.iconURL?.({ size: 256 }) || interactionOrGuild?.client?.user?.displayAvatarURL?.({ size: 256 }) || null;
  const blocked = action.finalizada || action.status === 'Cancelada';
  const container = new ContainerBuilder().setAccentColor(0xEF4444);
  const title = new TextDisplayBuilder().setContent([
    '### 🔫 Sistema de Ação — Vortex',
    '',
    '❔ Acompanhe a ação e gerencie sua participação.',
  ].join('\n'));

  if (iconUrl) {
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(title)
        .setThumbnailAccessory(
          new ThumbnailBuilder()
            .setURL(iconUrl)
            .setDescription('Logo Vortex')
        )
    );
  } else {
    container.addTextDisplayComponents(title);
  }

  container
    .addSeparatorComponents(new SeparatorBuilder().setDivider(false))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([
      '📋 **Detalhes**',
      `🔫 **Ação:** ${action.nome}`,
      `📅 **Data:** ${action.data || 'Nao informada'}`,
      `👥 **Limite:** ${action.limite}`,
      `➤ **Status:** \`${action.status}\``,
      '@everyone',
      '',
      `🧾 **ID:** \`${action.id}\``,
    ].join('\n')))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([
      '✅ **Confirmados**',
      formatParticipantList(action.confirmados, 'Nenhum confirmado.'),
    ].join('\n')))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([
      '🕘 **Reservas**',
      formatParticipantList(action.reservas, 'Nenhum.'),
    ].join('\n')))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
          '🚀 **Participar da ação**',
          blocked ? 'Participação bloqueada para ação finalizada/cancelada.' : 'Entra como **Titular** (ou **Reserva** se lotar).',
        ].join('\n')))
        .setButtonAccessory(
          new ButtonBuilder()
            .setCustomId(`vortex_action_join_${action.id}`)
            .setEmoji('✅')
            .setLabel('Participar')
            .setStyle(ButtonStyle.Success)
            .setDisabled(blocked)
        )
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
          '🚪 **Sair da ação**',
          'Sai da ação e atualiza a fila automaticamente.',
        ].join('\n')))
        .setButtonAccessory(
          new ButtonBuilder()
            .setCustomId(`vortex_action_leave_${action.id}`)
            .setEmoji('🚪')
            .setLabel('Sair')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(blocked)
        )
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
          '🚀 **Gerência**',
          'Acesso restrito. Abre um **painel exclusivo** com ferramentas de gerente.',
        ].join('\n')))
        .setButtonAccessory(
          new ButtonBuilder()
            .setCustomId(`vortex_action_manager_${action.id}`)
            .setEmoji('🚀')
            .setLabel('Painel do Gerente')
            .setStyle(ButtonStyle.Secondary)
        )
    )
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent('-# Vortex — Todos os direitos reservados'));

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
    embeds: [],
  };
}

function buildActionReportPayload(action, interactionOrGuild = null) {
  const guild = interactionOrGuild?.guild || interactionOrGuild;
  const iconUrl = guild?.iconURL?.() || null;
  const result = action.resultado || action.status || 'Nao informado';
  const description = [
    '❔ Relatório gerado automaticamente ao concluir a ação.',
    '',
    '📋 **Detalhes**',
    `🔫 **Ação:** ${action.nome}`,
    `📅 **Data:** ${action.data || 'Nao informada'}`,
    `👥 **Limite:** ${action.limite}`,
    `➤ **Resultado:** \`${result}\``,
    '',
    '📋 **Resumo da execução**',
    `🏅 **MVP:** ${action.mvp || 'Nao informado'}`,
    `💰 **Valor roubado:** ${money(action.valorRoubado)}`,
    `🧾 **Negociador:** ${action.negociador || 'Nao informado'}`,
    '',
    '🔫 **Armamentos**',
    formatArmaments(action.armamentos),
    '',
    '✅ **Confirmados**',
    formatParticipantList(action.confirmados, 'Nenhum confirmado.'),
    '',
    '🕘 **Reservas**',
    formatParticipantList(action.reservas, 'Nenhum.'),
    '',
    `🧾 **ID:** \`${action.id}\``,
  ].join('\n');

  return buildThemedPanelPayload('painel', {
    color: '#E11D48',
    author: { name: '🔫 Relatório da Ação', iconURL: iconUrl },
    description,
    footer: { text: 'Vortex — Todos os direitos reservados' },
  });
}

async function buildActionAdminPanelPayload(interaction) {
  const actions = await listActions(interaction.guildId);
  const selectedId = getSelectedActionId(interaction) || actions[0]?.id || '';
  if (selectedId && !getSelectedActionId(interaction)) setSelectedActionId(interaction, selectedId);
  const selected = actions.find((action) => action.id === selectedId) || actions[0] || null;
  const activeCount = actions.filter((action) => !action.finalizada).length;
  const selectedText = selected
    ? [
        `Selecionada: **${selected.nome}**`,
        `ID: \`${selected.id}\` | Status: \`${selected.status}\` | Limite: **${selected.limite}**`,
        `Confirmados: **${selected.confirmados.length}** | Reservas: **${selected.reservas.length}**`,
        `Painel: ${selected.canalId ? `<#${selected.canalId}>` : '`Nao configurado`'} | Relatorio: <#${selected.relatorioCanalId || DEFAULT_REPORT_CHANNEL_ID}>`,
        `Mensagem: ${selected.mensagemId ? `\`${selected.mensagemId}\`` : '`Nao criada`'}`,
      ].join('\n')
    : 'Nenhuma ação cadastrada ainda.';

  const rows = [];
  if (actions.length) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('vortex_action_admin_select')
        .setPlaceholder('Selecionar ação cadastrada')
        .addOptions(actions.slice(0, 25).map((action) => ({
          label: action.nome.slice(0, 100),
          value: action.id,
          description: `ID ${action.id} • ${action.status}`.slice(0, 100),
          default: action.id === selected?.id,
        })))
    ));
  }

  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('vortex_action_start')
      .setLabel('Iniciar ação')
      .setEmoji('🚀')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!selected),
    new ButtonBuilder()
      .setCustomId('vortex_action_finish')
      .setLabel('Finalizar ação')
      .setEmoji('🏁')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!selected),
  ));

  return buildThemedPanelPayload('painel', {
    color: '#E11D48',
    author: { name: 'VORTEX 🔫 | SISTEMA DE AÇÃO', iconURL: interaction.guild?.iconURL?.() || interaction.client?.user?.displayAvatarURL?.() },
    description: [
      '### Sistema de Ação Vortex',
      '',
      'Selecione uma ação cadastrada para **Iniciar** ou **Finalizar ação**.',
      'Ao iniciar, o painel público será enviado no canal configurado e ficará atualizando a mesma mensagem.',
      '',
      `Ações cadastradas: **${actions.length}** | Ativas: **${activeCount}**`,
      '',
      selectedText,
    ].join('\n'),
    footer: { text: 'Vortex — Gerenciamento de Ações' },
  }, { components: rows });
}

function addModalText(modal, customId, label, style = TextInputStyle.Short, required = true, value = '') {
  const input = new TextInputBuilder()
    .setCustomId(customId)
    .setLabel(label.slice(0, 45))
    .setStyle(style)
    .setRequired(required);
  if (value) input.setValue(String(value).slice(0, style === TextInputStyle.Paragraph ? 4000 : 400));
  modal.addComponents(new ActionRowBuilder().addComponents(input));
}

function buildActionModal(mode, action = null) {
  const modal = new ModalBuilder()
    .setCustomId(mode === 'edit' ? `modal_vortex_action_edit_${action.id}` : 'modal_vortex_action_create')
    .setTitle(mode === 'edit' ? 'Editar ação Vortex' : 'Cadastrar ação Vortex');

  addModalText(modal, 'nome', 'Nome da ação', TextInputStyle.Short, true, action?.nome || '');
  addModalText(modal, 'data', 'Data da ação', TextInputStyle.Short, true, action?.data || '');
  addModalText(modal, 'limite', 'Limite de participantes', TextInputStyle.Short, true, action?.limite || '');
  addModalText(modal, 'armamentos', 'Armamentos', TextInputStyle.Paragraph, true, action?.armamentos || '');
  addModalText(
    modal,
    'canais',
    'Canal painel | Canal relatorio',
    TextInputStyle.Short,
    true,
    action ? `${action.canalId || ''} | ${action.relatorioCanalId || DEFAULT_REPORT_CHANNEL_ID}` : ''
  );
  return modal;
}

function getSelectedOrLatest(interaction) {
  const selected = getSelectedActionId(interaction);
  return selected ? getAction(interaction.guildId, selected) : getLatestAction(interaction.guildId);
}

async function refreshPublicPanel(client, action) {
  if (!action?.canalId || !action?.mensagemId) return false;
  const channel = await client.channels.fetch(action.canalId).catch(() => null);
  if (!channel?.isTextBased?.()) return false;
  const message = await channel.messages.fetch(action.mensagemId).catch(() => null);
  if (!message) return false;
  await message.edit(buildActionPanelPayload(action, channel.guild)).catch(() => null);
  return true;
}

async function startAction(interaction, action) {
  const channelId = action.canalId || interaction.channelId;
  const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) {
    return safeReply(interaction, { content: 'Canal configurado para o painel e invalido ou nao foi encontrado.', ephemeral: true });
  }
  action.status = action.status === 'Aberta' ? 'Aberta' : normalizeStatus(action.status);
  action.finalizada = false;
  action.iniciadaEm = new Date().toISOString();
  action.data = formatLocalDate(action.iniciadaEm);
  action.canalId = channel.id;

  const message = await channel.send(buildActionPanelPayload(action, interaction));
  action.mensagemId = message.id;
  await saveAction(action);
  return safeReply(interaction, { content: `Ação **${action.nome}** iniciada em ${channel}.`, ephemeral: true });
}

function userParticipant(user) {
  return {
    userId: String(user.id),
    tag: user.tag || user.username || 'Usuario',
    addedAt: new Date().toISOString(),
  };
}

function removeUser(action, userId) {
  const uid = String(userId || '');
  const wasConfirmed = action.confirmados.some((participant) => participant.userId === uid);
  action.confirmados = action.confirmados.filter((participant) => participant.userId !== uid);
  action.reservas = action.reservas.filter((participant) => participant.userId !== uid);
  if (wasConfirmed && action.reservas.length) {
    const promoted = action.reservas.shift();
    action.confirmados.push(promoted);
  }
  return wasConfirmed;
}

async function sendActionReport(interaction, action) {
  const reportChannelId = action.relatorioCanalId || DEFAULT_REPORT_CHANNEL_ID;
  const channel = await interaction.client.channels.fetch(reportChannelId).catch(() => null);
  if (!channel?.isTextBased?.()) {
    await safeReply(interaction, {
      content: `Nao encontrei o canal de relatorio <#${reportChannelId}>. O relatorio foi enviado aqui.`,
      ephemeral: true,
    });
    return interaction.channel.send(buildActionReportPayload(action, interaction));
  }
  return channel.send(buildActionReportPayload(action, channel.guild || interaction));
}

async function finishAction(interaction, action, { sendReport = true } = {}) {
  action.finalizada = true;
  action.status = 'Finalizada';
  if (!action.resultado) action.resultado = 'Vitoria';
  await saveAction(action);
  await refreshPublicPanel(interaction.client, action);
  if (sendReport) {
    return sendActionReport(interaction, action);
  }
  return null;
}

function buildManagerPanel(action, interaction, options = {}) {
  const ephemeral = options.ephemeral !== false;
  const participantOptions = [...action.confirmados, ...action.reservas].slice(0, 25).map((participant) => ({
    label: (participant.tag || participant.userId).slice(0, 100),
    value: participant.userId,
    description: participant.userId,
  }));
  const reserveOptions = action.reservas.slice(0, 25).map((participant) => ({
    label: (participant.tag || participant.userId).slice(0, 100),
    value: participant.userId,
    description: participant.userId,
  }));

  const rows = [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`vortex_action_manager_status_${action.id}`)
        .setPlaceholder('Alterar status')
        .addOptions(STATUS_OPTIONS.map((status) => ({
          label: status,
          value: status,
          default: status === action.status,
        })))
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`vortex_action_manager_meta_${action.id}`).setLabel('Editar resumo').setEmoji('🧾').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`vortex_action_manager_finish_${action.id}`).setLabel('Finalizar ação').setEmoji('🏁').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`vortex_action_manager_report_${action.id}`).setLabel('Gerar relatório').setEmoji('📋').setStyle(ButtonStyle.Primary)
    ),
  ];

  if (participantOptions.length) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`vortex_action_manager_remove_${action.id}`)
        .setPlaceholder('Remover participante')
        .addOptions(participantOptions)
    ));
  }
  if (reserveOptions.length) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`vortex_action_manager_promote_${action.id}`)
        .setPlaceholder('Mover reserva para confirmado')
        .addOptions(reserveOptions)
    ));
  }

  return buildThemedPanelPayload('painel', {
    color: '#E11D48',
    author: { name: '🚀 Gerência — Sistema de Ação Vortex', iconURL: interaction.guild?.iconURL?.() || null },
    description: [
      `Ação: **${action.nome}** | ID: \`${action.id}\``,
      `Status: \`${action.status}\` | Resultado: \`${action.resultado || 'Nao informado'}\``,
      '',
      '✅ **Confirmados**',
      formatParticipantList(action.confirmados, 'Nenhum confirmado.'),
      '',
      '🕘 **Reservas**',
      formatParticipantList(action.reservas, 'Nenhum.'),
    ].join('\n'),
    footer: { text: 'Vortex — Painel restrito de gerência' },
  }, { components: rows, ephemeral });
}

function buildMetaModal(action) {
  const modal = new ModalBuilder()
    .setCustomId(`modal_vortex_action_meta_${action.id}`)
    .setTitle('Resumo da ação Vortex');
  addModalText(modal, 'mvp', 'MVP', TextInputStyle.Short, false, action.mvp || '');
  addModalText(modal, 'valorRoubado', 'Valor roubado', TextInputStyle.Short, false, action.valorRoubado || 0);
  addModalText(modal, 'negociador', 'Negociador', TextInputStyle.Short, false, action.negociador || '');
  addModalText(modal, 'resultado', 'Resultado final', TextInputStyle.Short, false, action.resultado || action.status || '');
  return modal;
}

function buildFinalizeModal(action) {
  const modal = new ModalBuilder()
    .setCustomId(`modal_vortex_action_finish_${action.id}`)
    .setTitle('Finalizar ação Vortex');
  addModalText(modal, 'resultado', 'Resultado: Vitoria ou Derrota', TextInputStyle.Short, true, action.resultado || 'Vitoria');
  addModalText(modal, 'mvp', 'MVP', TextInputStyle.Short, false, action.mvp || '');
  addModalText(modal, 'valorRoubado', 'Valor roubado', TextInputStyle.Short, false, action.valorRoubado || 0);
  addModalText(modal, 'negociador', 'Negociador', TextInputStyle.Short, false, action.negociador || '');
  return modal;
}

async function handleActionButton(interaction) {
  const customId = String(interaction.customId || '');
  if (customId === 'vortex_action_create') {
    if (!hasActionManagerPermission(interaction.member, interaction.user.id)) {
      return safeReply(interaction, { content: 'Voce nao tem permissao para cadastrar ações.', ephemeral: true });
    }
    return safeShowModal(interaction, buildActionModal('create'));
  }

  if (customId === 'vortex_action_refresh_admin') {
    return safeUpdate(interaction, await buildActionAdminPanelPayload(interaction));
  }

  if (['vortex_action_edit', 'vortex_action_delete', 'vortex_action_start', 'vortex_action_finish', 'vortex_action_report'].includes(customId)) {
    if (!hasActionManagerPermission(interaction.member, interaction.user.id)) {
      return safeReply(interaction, { content: 'Voce nao tem permissao para gerenciar ações.', ephemeral: true });
    }
    const action = await getSelectedOrLatest(interaction);
    if (!action) return safeReply(interaction, { content: 'Nenhuma ação selecionada.', ephemeral: true });
    if (customId === 'vortex_action_edit') return safeShowModal(interaction, buildActionModal('edit', action));
    if (customId === 'vortex_action_delete') {
      await deleteAction(interaction.guildId, action.id);
      selectedActions.delete(getSelectionKey(interaction));
      return safeUpdate(interaction, await buildActionAdminPanelPayload(interaction));
    }
    if (customId === 'vortex_action_start') return startAction(interaction, action);
    if (customId === 'vortex_action_finish') {
      return safeShowModal(interaction, buildFinalizeModal(action));
    }
    if (customId === 'vortex_action_report') {
      await sendActionReport(interaction, action);
      return safeReply(interaction, { content: 'Relatório gerado.', ephemeral: true });
    }
  }

  const joinMatch = customId.match(/^vortex_action_join_(.+)$/);
  if (joinMatch) {
    if (!hasActionUserPermission(interaction.member)) {
      return safeReply(interaction, { content: 'Voce nao tem permissao para participar das ações Vortex.', ephemeral: true });
    }
    const action = await getAction(interaction.guildId, joinMatch[1]);
    if (!action) return safeReply(interaction, { content: 'Ação nao encontrada.', ephemeral: true });
    if (action.finalizada || action.status === 'Cancelada') {
      return safeReply(interaction, { content: 'Essa ação está finalizada ou cancelada.', ephemeral: true });
    }
    const exists = [...action.confirmados, ...action.reservas].some((participant) => participant.userId === interaction.user.id);
    if (exists) {
      return safeReply(interaction, { content: 'Voce ja está participando dessa ação.', ephemeral: true });
    }
    const participant = userParticipant(interaction.user);
    const enteredAsReserve = action.confirmados.length >= action.limite;
    if (enteredAsReserve) action.reservas.push(participant);
    else action.confirmados.push(participant);
    await saveAction(action);
    await refreshPublicPanel(interaction.client, action);
    return safeReply(interaction, {
      content: enteredAsReserve ? 'Voce entrou como reserva.' : 'Voce entrou como titular confirmado.',
      ephemeral: true,
    });
  }

  const leaveMatch = customId.match(/^vortex_action_leave_(.+)$/);
  if (leaveMatch) {
    const action = await getAction(interaction.guildId, leaveMatch[1]);
    if (!action) return safeReply(interaction, { content: 'Ação nao encontrada.', ephemeral: true });
    if (action.finalizada || action.status === 'Cancelada') {
      return safeReply(interaction, { content: 'Essa ação está finalizada ou cancelada.', ephemeral: true });
    }
    const wasIn = [...action.confirmados, ...action.reservas].some((participant) => participant.userId === interaction.user.id);
    if (!wasIn) return safeReply(interaction, { content: 'Voce nao está nessa ação.', ephemeral: true });
    removeUser(action, interaction.user.id);
    await saveAction(action);
    await refreshPublicPanel(interaction.client, action);
    return safeReply(interaction, { content: 'Voce saiu da ação e a fila foi atualizada.', ephemeral: true });
  }

  const managerMatch = customId.match(/^vortex_action_manager_(\d+)$/);
  if (managerMatch) {
    if (!hasActionManagerPermission(interaction.member, interaction.user.id)) {
      return safeReply(interaction, { content: 'Acesso restrito aos gerentes/admins.', ephemeral: true });
    }
    const action = await getAction(interaction.guildId, managerMatch[1]);
    if (!action) return safeReply(interaction, { content: 'Ação nao encontrada.', ephemeral: true });
    return safeReply(interaction, buildManagerPanel(action, interaction, { ephemeral: true }));
  }

  const metaMatch = customId.match(/^vortex_action_manager_meta_(.+)$/);
  if (metaMatch) {
    if (!hasActionManagerPermission(interaction.member, interaction.user.id)) {
      return safeReply(interaction, { content: 'Acesso restrito aos gerentes/admins.', ephemeral: true });
    }
    const action = await getAction(interaction.guildId, metaMatch[1]);
    if (!action) return safeReply(interaction, { content: 'Ação nao encontrada.', ephemeral: true });
    return safeShowModal(interaction, buildMetaModal(action));
  }

  const finishMatch = customId.match(/^vortex_action_manager_finish_(.+)$/);
  if (finishMatch) {
    if (!hasActionManagerPermission(interaction.member, interaction.user.id)) {
      return safeReply(interaction, { content: 'Acesso restrito aos gerentes/admins.', ephemeral: true });
    }
    const action = await getAction(interaction.guildId, finishMatch[1]);
    if (!action) return safeReply(interaction, { content: 'Ação nao encontrada.', ephemeral: true });
    return safeShowModal(interaction, buildFinalizeModal(action));
  }

  const reportMatch = customId.match(/^vortex_action_manager_report_(.+)$/);
  if (reportMatch) {
    if (!hasActionManagerPermission(interaction.member, interaction.user.id)) {
      return safeReply(interaction, { content: 'Acesso restrito aos gerentes/admins.', ephemeral: true });
    }
    const action = await getAction(interaction.guildId, reportMatch[1]);
    if (!action) return safeReply(interaction, { content: 'Ação nao encontrada.', ephemeral: true });
    await sendActionReport(interaction, action);
    return safeReply(interaction, { content: 'Relatório gerado.', ephemeral: true });
  }

  return null;
}

async function handleActionSelect(interaction) {
  const customId = String(interaction.customId || '');
  if (customId === 'vortex_action_admin_select') {
    setSelectedActionId(interaction, interaction.values[0]);
    return safeUpdate(interaction, await buildActionAdminPanelPayload(interaction));
  }

  const statusMatch = customId.match(/^vortex_action_manager_status_(.+)$/);
  if (statusMatch) {
    if (!hasActionManagerPermission(interaction.member, interaction.user.id)) {
      return safeReply(interaction, { content: 'Acesso restrito aos gerentes/admins.', ephemeral: true });
    }
    const action = await getAction(interaction.guildId, statusMatch[1]);
    if (!action) return safeReply(interaction, { content: 'Ação nao encontrada.', ephemeral: true });
    action.status = normalizeStatus(interaction.values[0]);
    action.finalizada = FINAL_STATUSES.has(action.status);
    if (action.finalizada && !action.resultado) action.resultado = action.status;
    await saveAction(action);
    await refreshPublicPanel(interaction.client, action);
    return safeUpdate(interaction, buildManagerPanel(action, interaction, { ephemeral: false }));
  }

  const removeMatch = customId.match(/^vortex_action_manager_remove_(.+)$/);
  if (removeMatch) {
    if (!hasActionManagerPermission(interaction.member, interaction.user.id)) {
      return safeReply(interaction, { content: 'Acesso restrito aos gerentes/admins.', ephemeral: true });
    }
    const action = await getAction(interaction.guildId, removeMatch[1]);
    if (!action) return safeReply(interaction, { content: 'Ação nao encontrada.', ephemeral: true });
    removeUser(action, interaction.values[0]);
    await saveAction(action);
    await refreshPublicPanel(interaction.client, action);
    return safeUpdate(interaction, buildManagerPanel(action, interaction, { ephemeral: false }));
  }

  const promoteMatch = customId.match(/^vortex_action_manager_promote_(.+)$/);
  if (promoteMatch) {
    if (!hasActionManagerPermission(interaction.member, interaction.user.id)) {
      return safeReply(interaction, { content: 'Acesso restrito aos gerentes/admins.', ephemeral: true });
    }
    const action = await getAction(interaction.guildId, promoteMatch[1]);
    if (!action) return safeReply(interaction, { content: 'Ação nao encontrada.', ephemeral: true });
    const userId = interaction.values[0];
    const participant = action.reservas.find((item) => item.userId === userId);
    if (participant) {
      action.reservas = action.reservas.filter((item) => item.userId !== userId);
      action.confirmados = action.confirmados.filter((item) => item.userId !== userId);
      action.confirmados.push(participant);
      while (action.confirmados.length > action.limite) {
        const moved = action.confirmados.pop();
        if (moved && moved.userId !== participant.userId) action.reservas.unshift(moved);
      }
      await saveAction(action);
      await refreshPublicPanel(interaction.client, action);
    }
    return safeUpdate(interaction, buildManagerPanel(action, interaction, { ephemeral: false }));
  }

  return null;
}

async function handleActionModal(interaction) {
  const customId = String(interaction.customId || '');
  if (customId === 'modal_vortex_action_create' || customId.startsWith('modal_vortex_action_edit_')) {
    if (!hasActionManagerPermission(interaction.member, interaction.user.id)) {
      return safeReply(interaction, { content: 'Voce nao tem permissao para salvar ações.', ephemeral: true });
    }
    const editId = customId.replace('modal_vortex_action_edit_', '');
    const existing = customId.startsWith('modal_vortex_action_edit_')
      ? await getAction(interaction.guildId, editId)
      : null;
    const channels = parseActionChannels(interaction.fields.getTextInputValue('canais'));
    if (!channels.canalId) {
      return safeReply(interaction, {
        content: 'Informe o ID ou mencao do canal onde o painel da ação será enviado.',
        ephemeral: true,
      });
    }
    const action = normalizeAction({
      ...(existing || {}),
      id: existing?.id || await nextActionId(interaction.guildId),
      guildId: interaction.guildId,
      nome: interaction.fields.getTextInputValue('nome'),
      data: interaction.fields.getTextInputValue('data'),
      limite: interaction.fields.getTextInputValue('limite'),
      armamentos: interaction.fields.getTextInputValue('armamentos'),
      canalId: channels.canalId,
      relatorioCanalId: channels.relatorioCanalId || DEFAULT_REPORT_CHANNEL_ID,
      status: existing?.status || 'Aberta',
      criadoPor: existing?.criadoPor || interaction.user.id,
      criadoEm: existing?.criadoEm || new Date().toISOString(),
    });
    await saveAction(action);
    setSelectedActionId(interaction, action.id);
    if (action.mensagemId) await refreshPublicPanel(interaction.client, action);
    return safeReply(interaction, {
      content: `Ação **${action.nome}** salva com ID \`${action.id}\`.`,
      ephemeral: true,
    });
  }

  const metaMatch = customId.match(/^modal_vortex_action_meta_(.+)$/);
  if (metaMatch) {
    if (!hasActionManagerPermission(interaction.member, interaction.user.id)) {
      return safeReply(interaction, { content: 'Acesso restrito aos gerentes/admins.', ephemeral: true });
    }
    const action = await getAction(interaction.guildId, metaMatch[1]);
    if (!action) return safeReply(interaction, { content: 'Ação nao encontrada.', ephemeral: true });
    action.mvp = interaction.fields.getTextInputValue('mvp') || '';
    action.valorRoubado = parseMoney(interaction.fields.getTextInputValue('valorRoubado'));
    action.negociador = interaction.fields.getTextInputValue('negociador') || '';
    action.resultado = interaction.fields.getTextInputValue('resultado') || '';
    if (action.resultado) action.status = normalizeStatus(action.resultado);
    await saveAction(action);
    await refreshPublicPanel(interaction.client, action);
    return safeReply(interaction, { content: 'Resumo da ação atualizado.', ephemeral: true });
  }

  const finishMatch = customId.match(/^modal_vortex_action_finish_(.+)$/);
  if (finishMatch) {
    if (!hasActionManagerPermission(interaction.member, interaction.user.id)) {
      return safeReply(interaction, { content: 'Acesso restrito aos gerentes/admins.', ephemeral: true });
    }
    const action = await getAction(interaction.guildId, finishMatch[1]);
    if (!action) return safeReply(interaction, { content: 'Ação nao encontrada.', ephemeral: true });
    const resultado = interaction.fields.getTextInputValue('resultado') || 'Vitoria';
    action.resultado = /derrota/i.test(resultado) ? 'Derrota' : 'Vitoria';
    action.mvp = interaction.fields.getTextInputValue('mvp') || '';
    action.valorRoubado = parseMoney(interaction.fields.getTextInputValue('valorRoubado'));
    action.negociador = interaction.fields.getTextInputValue('negociador') || '';
    await finishAction(interaction, action);
    return safeReply(interaction, {
      content: `Ação **${action.nome}** finalizada. Relatório enviado em <#${action.relatorioCanalId || DEFAULT_REPORT_CHANNEL_ID}>.`,
      ephemeral: true,
    });
  }

  return null;
}

async function startActionById(interaction, actionId = '') {
  if (!hasActionManagerPermission(interaction.member, interaction.user.id)) {
    return safeReply(interaction, { content: 'Voce nao tem permissao para iniciar ações.', ephemeral: true });
  }
  const action = actionId ? await getAction(interaction.guildId, actionId) : await getLatestAction(interaction.guildId);
  if (!action) return safeReply(interaction, { content: 'Nenhuma ação encontrada.', ephemeral: true });
  setSelectedActionId(interaction, action.id);
  return startAction(interaction, action);
}

async function finishActionById(interaction, actionId = '', resultado = '') {
  if (!hasActionManagerPermission(interaction.member, interaction.user.id)) {
    return safeReply(interaction, { content: 'Voce nao tem permissao para finalizar ações.', ephemeral: true });
  }
  const action = actionId ? await getAction(interaction.guildId, actionId) : await getLatestAction(interaction.guildId);
  if (!action) return safeReply(interaction, { content: 'Nenhuma ação encontrada.', ephemeral: true });
  if (resultado) {
    action.resultado = /derrota/i.test(resultado) ? 'Derrota' : 'Vitoria';
  }
  await finishAction(interaction, action);
  return safeReply(interaction, { content: `Ação **${action.nome}** finalizada.`, ephemeral: true });
}

async function reportActionById(interaction, actionId = '') {
  if (!hasActionManagerPermission(interaction.member, interaction.user.id)) {
    return safeReply(interaction, { content: 'Voce nao tem permissao para gerar relatórios.', ephemeral: true });
  }
  const action = actionId ? await getAction(interaction.guildId, actionId) : await getLatestAction(interaction.guildId);
  if (!action) return safeReply(interaction, { content: 'Nenhuma ação encontrada.', ephemeral: true });
  await sendActionReport(interaction, action);
  return safeReply(interaction, { content: 'Relatório gerado.', ephemeral: true });
}

module.exports = {
  buildActionAdminPanelPayload,
  buildActionPanelPayload,
  buildActionReportPayload,
  handleActionButton,
  handleActionSelect,
  handleActionModal,
  hasActionManagerPermission,
  hasActionUserPermission,
  listActions,
  getAction,
  startActionById,
  finishActionById,
  reportActionById,
};
