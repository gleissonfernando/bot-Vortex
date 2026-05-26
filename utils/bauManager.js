const fs = require('fs');
const path = require('path');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { buildThemedPanelPayload } = require('./panelTheme');
const { getUserProfile } = require('./profileManager');
const { hasCommandRole, hasVortexLevel } = require('./permissions');
const { safeDeferReply, safeEdit, safeReply, safeShowModal } = require('./safeReply');
const { isPrimaryGuild } = require('./guildScope');
const { logger } = require('./logger');

const STORAGE_PATH = path.join(__dirname, '..', 'commands', 'bauStorage.json');
const BAU_BANNER_FILE_NAME = 'sistema-de-bau-banner.png';
const BAU_BANNER_PATH = path.join(__dirname, '..', 'public', BAU_BANNER_FILE_NAME);
const BAU_LOG_CHANNEL_ID = '1508602673203642418';
const TIME_ZONE = 'America/Sao_Paulo';
const MAX_EVENTS = 1500;
const MAX_REPORTS = 90;
const MAX_PANELS_PER_CHEST = 30;

const CHESTS = {
  membros: {
    id: 'membros',
    label: 'Bau Membros',
    description: 'Estoque usado pelos membros cadastrados.',
  },
  gerencia: {
    id: 'gerencia',
    label: 'Bau Gerencia',
    description: 'Estoque reservado para a gerencia.',
  },
};

function ensureStorageFile() {
  const dir = path.dirname(STORAGE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(STORAGE_PATH)) {
    fs.writeFileSync(STORAGE_PATH, `${JSON.stringify({ version: 1, guilds: {} }, null, 2)}\n`, 'utf8');
  }
}

function readStorage() {
  ensureStorageFile();
  try {
    const parsed = JSON.parse(fs.readFileSync(STORAGE_PATH, 'utf8') || '{}');
    if (!parsed.guilds || typeof parsed.guilds !== 'object') parsed.guilds = {};
    if (!parsed.version) parsed.version = 1;
    return parsed;
  } catch {
    return { version: 1, guilds: {} };
  }
}

function writeStorage(data) {
  ensureStorageFile();
  fs.writeFileSync(STORAGE_PATH, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function normalizeChestKey(value) {
  const key = String(value || '').trim().toLowerCase();
  if (key === 'gerencia' || key === 'gerência' || key === 'gestao' || key === 'gestão') return 'gerencia';
  return 'membros';
}

function createEmptyGuildData() {
  return {
    chests: {
      membros: { id: 'membros', label: CHESTS.membros.label, items: {}, updatedAt: null },
      gerencia: { id: 'gerencia', label: CHESTS.gerencia.label, items: {}, updatedAt: null },
    },
    events: [],
    reports: [],
    panels: {},
  };
}

function ensureGuildData(data, guildId) {
  const id = String(guildId || 'global');
  if (!data.guilds[id] || typeof data.guilds[id] !== 'object') {
    data.guilds[id] = createEmptyGuildData();
  }
  const guildData = data.guilds[id];
  if (!guildData.chests || typeof guildData.chests !== 'object') guildData.chests = {};
  for (const chestKey of Object.keys(CHESTS)) {
    if (!guildData.chests[chestKey] || typeof guildData.chests[chestKey] !== 'object') {
      guildData.chests[chestKey] = { id: chestKey, label: CHESTS[chestKey].label, items: {}, updatedAt: null };
    }
    if (!guildData.chests[chestKey].items || typeof guildData.chests[chestKey].items !== 'object') {
      guildData.chests[chestKey].items = {};
    }
    guildData.chests[chestKey].id = chestKey;
    guildData.chests[chestKey].label = CHESTS[chestKey].label;
  }
  if (!Array.isArray(guildData.events)) guildData.events = [];
  if (!Array.isArray(guildData.reports)) guildData.reports = [];
  if (!guildData.panels || typeof guildData.panels !== 'object') guildData.panels = {};
  return guildData;
}

function normalizeItemName(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 80);
}

function createItemId(name) {
  const normalized = normalizeItemName(name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return normalized || `item-${Date.now()}`;
}

function parseQuantity(value, { allowZero = false } = {}) {
  const raw = String(value || '').trim().replace(/\./g, '').replace(',', '.');
  const quantity = Math.floor(Number(raw));
  if (!Number.isFinite(quantity) || quantity < 0 || (!allowZero && quantity <= 0)) return null;
  return quantity;
}

function formatQuantity(value) {
  return new Intl.NumberFormat('pt-BR').format(Math.max(0, Number(value) || 0));
}

function formatDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function getSaoPauloParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date).reduce((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value;
    return acc;
  }, {});

  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    hour: parts.hour,
    minute: parts.minute,
  };
}

function toItemList(chest) {
  return Object.values(chest?.items || {})
    .filter((item) => item && item.id)
    .map((item) => ({
      id: String(item.id),
      name: normalizeItemName(item.name || item.id),
      quantity: Math.max(0, Math.floor(Number(item.quantity) || 0)),
      createdAt: item.createdAt || null,
      createdBy: item.createdBy || null,
      updatedAt: item.updatedAt || null,
      updatedBy: item.updatedBy || null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

function getChestSnapshot(guildId, chestKey = 'membros') {
  const data = readStorage();
  const guildData = ensureGuildData(data, guildId);
  const key = normalizeChestKey(chestKey);
  const chest = guildData.chests[key];
  const items = toItemList(chest);
  return {
    id: key,
    label: CHESTS[key].label,
    description: CHESTS[key].description,
    items,
    totalItems: items.length,
    totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
    updatedAt: chest.updatedAt || null,
  };
}

function formatItemLines(items, limit = 40) {
  if (!items.length) return 'Nenhum item cadastrado neste bau.';
  const shown = items.slice(0, limit).map((item) => {
    return `- **${item.name}**: **${formatQuantity(item.quantity)}** unidade(s)`;
  });
  if (items.length > limit) shown.push(`... mais ${items.length - limit} item(ns) cadastrado(s).`);
  return shown.join('\n');
}

function buildBauPanelRows(chestKey) {
  const key = normalizeChestKey(chestKey);
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`bau_deposit_${key}`)
        .setLabel('Colocar item')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`bau_withdraw_${key}`)
        .setLabel('Retirar item')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`bau_register_${key}`)
        .setLabel('Cadastrar produto')
        .setStyle(ButtonStyle.Primary),
    ),
  ];
}

function buildBauPanelPayload(guildId, chestKey = 'membros') {
  const snapshot = getChestSnapshot(guildId, chestKey);
  const hasBanner = fs.existsSync(BAU_BANNER_PATH);
  const description = [
    snapshot.description,
    '',
    '**Estoque atual**',
    formatItemLines(snapshot.items),
  ].join('\n');

  const view = {
    color: snapshot.id === 'gerencia' ? 0xF59E0B : 0x0EA5E9,
    author: { name: `VORTEX | ${snapshot.label}` },
    description,
    footer: { text: 'Retiradas e entradas exigem nome cadastrado no sistema.' },
  };

  return buildThemedPanelPayload('bau', view, {
    bannerUrl: hasBanner ? `attachment://${BAU_BANNER_FILE_NAME}` : undefined,
    components: buildBauPanelRows(snapshot.id),
    files: hasBanner ? [{ attachment: BAU_BANNER_PATH, name: BAU_BANNER_FILE_NAME }] : [],
  });
}

function hasBauManagerPermission(member) {
  return hasVortexLevel(member, ['admin', 'medio']) || hasCommandRole(member, 'bau-membros') || hasCommandRole(member, 'bau');
}

function getProfileName(profile) {
  return normalizeItemName(profile?.nomeGame || profile?.displayName || '');
}

function getRegisteredProfile(guildId, userId) {
  const profile = getUserProfile(guildId, userId);
  const profileName = getProfileName(profile);
  if (!profile || !profileName) return null;
  return { profile, profileName };
}

function findItem(chest, itemName) {
  const normalizedName = normalizeItemName(itemName);
  const itemId = createItemId(normalizedName);
  const direct = chest.items[itemId];
  if (direct) return direct;
  const lower = normalizedName.toLowerCase();
  return Object.values(chest.items).find((item) => normalizeItemName(item.name).toLowerCase() === lower) || null;
}

function addEvent(guildData, event) {
  guildData.events.push({
    id: `bau-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    ...event,
  });
  guildData.events = guildData.events.slice(-MAX_EVENTS);
  return guildData.events[guildData.events.length - 1];
}

function applyBauAction({
  guildId,
  chestKey,
  action,
  user,
  member,
  itemName,
  quantity,
  note = '',
}) {
  const key = normalizeChestKey(chestKey);
  const name = normalizeItemName(itemName);
  if (!name) return { ok: false, message: 'Informe o nome do item.' };

  const managerAction = action === 'register';
  if (managerAction && !hasBauManagerPermission(member)) {
    return { ok: false, message: 'Voce nao tem permissao para cadastrar produto no bau.' };
  }

  const quantityValue = parseQuantity(quantity, { allowZero: managerAction });
  if (quantityValue === null) {
    return { ok: false, message: managerAction ? 'Informe uma quantidade inicial valida. Use 0 se quiser apenas cadastrar.' : 'Informe uma quantidade maior que zero.' };
  }

  const registered = managerAction ? null : getRegisteredProfile(guildId, user.id);
  if (!managerAction && !registered) {
    return {
      ok: false,
      message: 'Seu nome nao esta cadastrado no sistema. Peca para a gerencia cadastrar seu perfil antes de movimentar o bau.',
    };
  }

  const data = readStorage();
  const guildData = ensureGuildData(data, guildId);
  const chest = guildData.chests[key];
  const now = new Date().toISOString();
  let item = findItem(chest, name);

  if (action === 'withdraw' && !item) {
    return { ok: false, message: `O item "${name}" ainda nao esta cadastrado neste bau.` };
  }

  const before = Math.max(0, Number(item?.quantity) || 0);
  let after = before;
  let itemId = item?.id || createItemId(name);

  if (action === 'withdraw') {
    if (before < quantityValue) {
      return { ok: false, message: `Estoque insuficiente. Disponivel: ${formatQuantity(before)}.` };
    }
    after = before - quantityValue;
    item.quantity = after;
    item.updatedAt = now;
    item.updatedBy = user.id;
    if (after <= 0) {
      delete chest.items[itemId];
    }
  } else if (action === 'deposit') {
    if (!item) {
      item = {
        id: itemId,
        name,
        quantity: 0,
        createdAt: now,
        createdBy: user.id,
      };
      chest.items[itemId] = item;
    }
    after = before + quantityValue;
    item.quantity = after;
    item.updatedAt = now;
    item.updatedBy = user.id;
  } else if (action === 'register') {
    if (!item) {
      item = {
        id: itemId,
        name,
        quantity: 0,
        createdAt: now,
        createdBy: user.id,
      };
      chest.items[itemId] = item;
    } else {
      itemId = item.id;
      item.name = name;
    }
    after = before + quantityValue;
    item.quantity = after;
    item.updatedAt = now;
    item.updatedBy = user.id;
  } else {
    return { ok: false, message: 'Acao de bau invalida.' };
  }

  chest.updatedAt = now;
  const event = addEvent(guildData, {
    chest: key,
    chestLabel: CHESTS[key].label,
    action,
    userId: user.id,
    userTag: user.tag || user.username || user.id,
    memberDisplayName: member?.displayName || user.username || user.id,
    profileName: registered?.profileName || getProfileName(getUserProfile(guildId, user.id)) || null,
    itemId,
    itemName: item.name,
    quantity: quantityValue,
    quantityBefore: before,
    quantityAfter: after,
    note: normalizeItemName(note).slice(0, 120),
  });

  writeStorage(data);
  return { ok: true, event, item, before, after, action, chestKey: key };
}

function actionLabel(action) {
  if (action === 'withdraw') return 'Retirada';
  if (action === 'deposit') return 'Entrada';
  if (action === 'register') return 'Cadastro de produto';
  if (action === 'daily_report') return 'Relatorio diario';
  return 'Movimento';
}

function actionColor(action) {
  if (action === 'withdraw') return '#ED4245';
  if (action === 'deposit') return '#57F287';
  if (action === 'register') return '#5865F2';
  return '#00D9FF';
}

async function sendBauLog(client, event) {
  const channel = await client.channels.fetch(BAU_LOG_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased?.()) return false;

  const memberLine = [
    `<@${event.userId}>`,
    event.profileName ? `Nome cadastrado: **${event.profileName}**` : null,
    `Discord ID: \`${event.userId}\``,
  ].filter(Boolean).join('\n');

  const embed = new EmbedBuilder()
    .setColor(actionColor(event.action))
    .setTitle(`Bau | ${actionLabel(event.action)}`)
    .setDescription([
      `Bau: **${event.chestLabel || CHESTS[event.chest]?.label || event.chest}**`,
      `Item: **${event.itemName}**`,
      `Quantidade: **${formatQuantity(event.quantity)}**`,
      `Estoque antes: **${formatQuantity(event.quantityBefore)}**`,
      `Estoque depois: **${formatQuantity(event.quantityAfter)}**`,
      event.note ? `Observacao: ${event.note}` : null,
    ].filter(Boolean).join('\n'))
    .addFields({ name: 'Membro identificado', value: memberLine, inline: false })
    .setTimestamp(new Date(event.createdAt || Date.now()))
    .setFooter({ text: 'Vortex | Sistema de Bau' });

  const message = await channel.send({
    embeds: [embed],
    allowedMentions: { parse: [] },
  }).catch(() => null);
  return Boolean(message);
}

function registerBauPanel(guildId, chestKey, channelId, messageId) {
  const data = readStorage();
  const guildData = ensureGuildData(data, guildId);
  const key = normalizeChestKey(chestKey);
  const panels = Array.isArray(guildData.panels[key]) ? guildData.panels[key] : [];
  const next = [
    ...panels.filter((panel) => String(panel.messageId) !== String(messageId)),
    {
      channelId: String(channelId),
      messageId: String(messageId),
      createdAt: new Date().toISOString(),
    },
  ].slice(-MAX_PANELS_PER_CHEST);
  guildData.panels[key] = next;
  writeStorage(data);
}

async function updateBauPanels(client, guildId, chestKey) {
  const data = readStorage();
  const guildData = ensureGuildData(data, guildId);
  const key = normalizeChestKey(chestKey);
  const panels = Array.isArray(guildData.panels[key]) ? guildData.panels[key] : [];
  const active = [];

  for (const panel of panels) {
    const channel = await client.channels.fetch(panel.channelId).catch(() => null);
    if (!channel?.isTextBased?.()) continue;
    const message = await channel.messages.fetch(panel.messageId).catch(() => null);
    if (!message) continue;
    await message.edit(buildBauPanelPayload(guildId, key)).catch(() => null);
    active.push(panel);
  }

  guildData.panels[key] = active.slice(-MAX_PANELS_PER_CHEST);
  writeStorage(data);
}

function buildBauModal(action, chestKey) {
  const key = normalizeChestKey(chestKey);
  const isRegister = action === 'register';
  const titleAction = action === 'withdraw' ? 'Retirar' : action === 'deposit' ? 'Colocar' : 'Cadastrar';
  const modal = new ModalBuilder()
    .setCustomId(`modal_bau_${action}_${key}`)
    .setTitle(`${CHESTS[key].label} | ${titleAction}`);

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('item_name')
        .setLabel('Nome do item')
        .setPlaceholder('Ex: g4, muni de g3, drogas')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(80),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('quantity')
        .setLabel(isRegister ? 'Quantidade inicial' : 'Quantidade')
        .setPlaceholder(isRegister ? 'Ex: 0 ou 200' : 'Ex: 200')
        .setStyle(TextInputStyle.Short)
        .setRequired(!isRegister)
        .setMaxLength(12),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('note')
        .setLabel('Observacao')
        .setPlaceholder('Opcional')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(120),
    ),
  );

  return modal;
}

function parseBauCustomId(customId) {
  const parts = String(customId || '').split('_');
  if (parts[0] === 'bau') return { action: parts[1], chestKey: normalizeChestKey(parts[2]) };
  if (parts[0] === 'modal' && parts[1] === 'bau') return { action: parts[2], chestKey: normalizeChestKey(parts[3]) };
  return { action: null, chestKey: 'membros' };
}

async function handleBauButton(interaction) {
  const { action, chestKey } = parseBauCustomId(interaction.customId);
  if (!action) return safeReply(interaction, { content: 'Botao de bau invalido.', ephemeral: true });

  if (action === 'refresh' || action === 'view') {
    return safeReply(interaction, {
      content: 'Esse botao foi removido do painel de bau. Publique o painel novamente para receber o modelo atualizado.',
      ephemeral: true,
    });
  }

  if (action === 'register' && !hasBauManagerPermission(interaction.member)) {
    return safeReply(interaction, {
      content: 'Voce nao tem permissao para cadastrar produtos no bau.',
      ephemeral: true,
    });
  }

  return safeShowModal(interaction, buildBauModal(action, chestKey));
}

async function handleBauModal(interaction) {
  const { action, chestKey } = parseBauCustomId(interaction.customId);
  if (!action) return safeReply(interaction, { content: 'Formulario de bau invalido.', ephemeral: true });

  await safeDeferReply(interaction, { ephemeral: true });

  const result = applyBauAction({
    guildId: interaction.guildId,
    chestKey,
    action,
    user: interaction.user,
    member: interaction.member,
    itemName: interaction.fields.getTextInputValue('item_name'),
    quantity: interaction.fields.getTextInputValue('quantity') || '0',
    note: interaction.fields.getTextInputValue('note') || '',
  });

  if (!result.ok) {
    return safeEdit(interaction, { content: result.message });
  }

  await sendBauLog(interaction.client, result.event).catch((error) => {
    logger.error('Erro ao enviar log do bau:', error);
  });
  await updateBauPanels(interaction.client, interaction.guildId, result.chestKey).catch((error) => {
    logger.error('Erro ao atualizar painel do bau:', error);
  });

  return safeEdit(interaction, {
    content: [
      `${actionLabel(result.action)} registrada com sucesso.`,
      `Bau: **${CHESTS[result.chestKey].label}**`,
      `Item: **${result.item.name}**`,
      `Quantidade: **${formatQuantity(result.event.quantity)}**`,
      `Estoque atual: **${formatQuantity(result.after)}**`,
    ].join('\n'),
    allowedMentions: { parse: [] },
  });
}

function summarizeRecentEvents(events, sinceMs) {
  const recent = events.filter((event) => new Date(event.createdAt).getTime() >= sinceMs);
  const summary = {
    withdrawQuantity: 0,
    depositQuantity: 0,
    registerQuantity: 0,
    registeredItems: 0,
    movementCount: recent.length,
  };

  for (const event of recent) {
    const quantity = Math.max(0, Number(event.quantity) || 0);
    if (event.action === 'withdraw') summary.withdrawQuantity += quantity;
    if (event.action === 'deposit') summary.depositQuantity += quantity;
    if (event.action === 'register') {
      summary.registerQuantity += quantity;
      summary.registeredItems += 1;
    }
  }

  return summary;
}

function buildReportLines(guildData) {
  return Object.keys(CHESTS).map((chestKey) => {
    const chest = guildData.chests[chestKey];
    const items = toItemList(chest);
    return [
      `**${CHESTS[chestKey].label}**`,
      formatItemLines(items, 12),
    ].join('\n');
  }).join('\n\n');
}

async function sendDailyBauReportForGuild(client, guild, force = false) {
  if (!force && !isPrimaryGuild(guild.id)) return false;

  const data = readStorage();
  const guildData = ensureGuildData(data, guild.id);
  const now = new Date();
  const parts = getSaoPauloParts(now);
  const alreadySent = guildData.reports.some((report) => report.dateKey === parts.dateKey);
  if (!force && alreadySent) return false;

  const sinceMs = now.getTime() - 24 * 60 * 60 * 1000;
  const summary = summarizeRecentEvents(guildData.events, sinceMs);
  const chests = Object.keys(CHESTS).map((chestKey) => getChestSnapshot(guild.id, chestKey));
  const report = {
    id: `bau-report-${parts.dateKey}`,
    dateKey: parts.dateKey,
    createdAt: now.toISOString(),
    generatedBy: client.user?.id || 'system',
    chests,
    summary,
  };

  guildData.reports.push(report);
  guildData.reports = guildData.reports.slice(-MAX_REPORTS);
  writeStorage(data);

  const channel = await client.channels.fetch(BAU_LOG_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased?.()) return false;

  await channel.send({
    content: [
      '**VORTEX | RELATORIO DIARIO DO BAU**',
      '',
      `Data: **${formatDate(now)}**`,
      '',
      buildReportLines(guildData),
      '',
      '**Movimentos nas ultimas 24h**',
      `Retirado: **${formatQuantity(summary.withdrawQuantity)}**`,
      `Colocado: **${formatQuantity(summary.depositQuantity)}**`,
      `Cadastrado: **${formatQuantity(summary.registeredItems)}** item(ns) / **${formatQuantity(summary.registerQuantity)}** unidade(s)`,
    ].join('\n'),
    allowedMentions: { parse: [] },
  });

  return true;
}

let dailyInterval = null;

function initDailyBauReport(client) {
  if (dailyInterval) clearInterval(dailyInterval);
  dailyInterval = setInterval(() => {
    const parts = getSaoPauloParts();
    if (!(parts.hour === '05' && parts.minute === '00')) return;

    for (const guild of client.guilds.cache.values()) {
      sendDailyBauReportForGuild(client, guild).catch((error) => logger.error('Erro no relatorio diario do bau:', error));
    }
  }, 30 * 1000);
}

module.exports = {
  BAU_LOG_CHANNEL_ID,
  CHESTS,
  STORAGE_PATH,
  buildBauPanelPayload,
  getChestSnapshot,
  handleBauButton,
  handleBauModal,
  hasBauManagerPermission,
  initDailyBauReport,
  registerBauPanel,
  sendDailyBauReportForGuild,
  updateBauPanels,
};
