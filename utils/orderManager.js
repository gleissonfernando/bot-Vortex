const mongoose = require('mongoose');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
} = require('discord.js');
const { buildThemedPanelPayload } = require('./panelTheme');
const { hasAnyVortexRole, hasCommandRole, hasVortexAccess } = require('./permissions');
const {
  safeDeferReply,
  safeEdit,
  safeReply,
  safeShowModal,
  safeUpdate,
} = require('./safeReply');

const ORDER_NUMBER_OFFSET = 3846;
const ORDER_DASHBOARD_URL = String(process.env.PUBLIC_DASHBOARD_URL || process.env.NEXT_PUBLIC_SITE_URL || 'https://bot-vortex.shardweb.app').replace(/\/+$/, '');
const ORDER_PANEL_EMOJI = '\u{1F4E6}';
const FAVORITE_EMOJI = '\u{2B50}';

const orderSessions = new Map();
const familySelections = new Map();

const ORDER_STATUSES = new Set(['pending', 'separating', 'transport', 'delivered', 'cancelled']);
const CATEGORY_OPTIONS = [
  { label: 'Municoes', value: 'munitions', description: 'Balas e municoes por arma' },
  { label: 'Armas', value: 'weapons', description: 'Armas cadastradas no estoque' },
  { label: 'Itens Gerais', value: 'general', description: 'Coletes, lockpick e utilitarios' },
  { label: 'Drogas', value: 'drugs', description: 'Itens de producao e venda' },
  { label: 'Personalizado', value: 'custom', description: 'Item fora do estoque padrao' },
];

function hasOrderManagerPermission(member) {
  return hasVortexAccess(member, ['admin', 'medio'])
    || hasCommandRole(member, 'encomenda')
    || Boolean(member?.permissions?.has?.(PermissionFlagsBits.ManageGuild))
    || Boolean(member?.permissions?.has?.(PermissionFlagsBits.ManageChannels));
}

function hasOrderUserPermission(member) {
  return hasOrderManagerPermission(member) || hasAnyVortexRole(member);
}

function sessionKey(interaction) {
  return `${interaction.guildId || interaction.guild?.id || 'global'}:${interaction.user.id}`;
}

function getGuildId(interaction) {
  return String(interaction.guildId || interaction.guild?.id || process.env.GUILD_ID || 'global');
}

function getActor(interaction) {
  return {
    id: String(interaction.user?.id || ''),
    name: interaction.user?.tag || interaction.user?.username || String(interaction.user?.id || 'Discord'),
  };
}

function isMongoReady() {
  return mongoose.connection.readyState === 1 && Boolean(mongoose.connection.db);
}

function getCollection(name) {
  if (!isMongoReady()) {
    throw new Error('MongoDB nao esta conectado. O Sistema de Encomendas V2 nao grava dados locais.');
  }
  return mongoose.connection.db.collection(name);
}

function objectId(value) {
  const id = String(value || '').trim();
  return mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null;
}

function createSlug(value) {
  const slug = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70);
  return slug || `familia-${Date.now()}`;
}

function parsePositiveInt(value) {
  const normalized = String(value || '').trim().replace(/\./g, '').replace(',', '.');
  const number = Math.floor(Number(normalized));
  return Number.isFinite(number) && number > 0 ? number : null;
}

function parseMoney(value, fallback = 0) {
  const normalized = String(value || '').trim().replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.');
  if (!normalized) return fallback;
  const number = Number(normalized);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function cents(value) {
  return Math.max(0, Math.round(Number(value || 0) * 100));
}

function moneyFromCents(value) {
  return Math.round(Number(value || 0)) / 100;
}

function formatMoney(valueCents) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(moneyFromCents(valueCents));
}

function statusLabel(status) {
  return {
    pending: 'Pendente',
    separating: 'Em Separacao',
    transport: 'Em Transporte',
    delivered: 'Entregue',
    cancelled: 'Cancelado',
  }[status] || String(status || 'Pendente');
}

function categoryLabel(category) {
  return (CATEGORY_OPTIONS.find((item) => item.value === category) || CATEGORY_OPTIONS[4]).label;
}

function normalizeMemberLines(value) {
  return String(value || '')
    .split(/\r?\n|,/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [discordId, ...nameParts] = line.split(/\s*-\s*/);
      return {
        discord_id: String(discordId || '').trim(),
        name: nameParts.join(' - ').trim() || null,
      };
    })
    .filter((item) => /^\d{5,32}$/.test(item.discord_id));
}

function row(...components) {
  return new ActionRowBuilder().addComponents(...components.filter(Boolean));
}

function button(customId, label, style = ButtonStyle.Secondary, options = {}) {
  const builder = new ButtonBuilder()
    .setCustomId(customId)
    .setLabel(label)
    .setStyle(style);
  if (options.emoji) builder.setEmoji(options.emoji);
  if (options.disabled) builder.setDisabled(true);
  return builder;
}

function linkButton(url, label) {
  return new ButtonBuilder()
    .setURL(url)
    .setLabel(label)
    .setStyle(ButtonStyle.Link);
}

function buildPayload(target, embed, components = [], ephemeral = true) {
  return buildThemedPanelPayload(target, embed, {
    components,
    ephemeral,
    allowedMentions: { parse: [] },
  });
}

async function respondPanel(interaction, payload, preferUpdate = true) {
  if (preferUpdate && (interaction.isButton?.() || interaction.isStringSelectMenu?.())) {
    const updated = await safeUpdate(interaction, payload);
    if (updated) return updated;
  }
  return safeReply(interaction, payload);
}

async function listFamilies(guildId, includeInactive = false) {
  const filter = { guild_id: guildId };
  if (!includeInactive) filter.active = true;
  return getCollection('order_families')
    .find(filter)
    .sort({ active: -1, name: 1 })
    .limit(100)
    .toArray();
}

async function listInventory(guildId, category = '') {
  const filter = { guild_id: guildId, active: true };
  if (category && category !== 'custom') filter.category = category;
  return getCollection('order_inventory')
    .find(filter)
    .sort({ category: 1, name: 1 })
    .limit(25)
    .toArray();
}

async function listFavorites(guildId, familyId = '') {
  const filter = { guild_id: guildId };
  if (familyId) filter.family_id = familyId;
  return getCollection('order_favorites')
    .find(filter)
    .sort({ updated_at: -1 })
    .limit(25)
    .toArray();
}

async function getSettings(guildId) {
  return getCollection('order_settings').findOne({ guild_id: guildId });
}

async function nextOrderNumber(guildId) {
  const result = await getCollection('order_counters').findOneAndUpdate(
    { guild_id: guildId, key: 'orders' },
    { $inc: { seq: 1 }, $setOnInsert: { guild_id: guildId, key: 'orders', created_at: new Date() } },
    { upsert: true, returnDocument: 'after' },
  );
  return ORDER_NUMBER_OFFSET + Number(result?.seq || 1);
}

async function insertOrderLog(log, family = null, settings = null) {
  await getCollection('order_logs').insertOne(log);
  const webhookUrl = family?.log_webhook_url || settings?.default_logs_webhook_url || '';
  if (webhookUrl) {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embeds: [{
          color: 0x0ea5e9,
          title: `Logs de Encomenda${log.order_number ? ` #${log.order_number}` : ''}`,
          description: [
            log.family_name ? `**Familia:** ${log.family_name}` : null,
            `**Acao:** ${log.action}`,
            log.actor_name ? `**Por:** ${log.actor_name}` : null,
            log.details ? `**Detalhes:** \`${JSON.stringify(log.details).slice(0, 900)}\`` : null,
          ].filter(Boolean).join('\n'),
          timestamp: log.created_at.toISOString(),
        }],
        allowed_mentions: { parse: [] },
      }),
    }).catch(() => null);
  }
}

async function applyStockDelta(guildId, items, direction) {
  const operations = items
    .filter((item) => item.inventory_item_id && objectId(item.inventory_item_id))
    .map((item) => ({
      updateOne: {
        filter: { _id: objectId(item.inventory_item_id), guild_id: guildId },
        update: { $inc: { quantity_available: direction * item.quantity }, $set: { updated_at: new Date() } },
      },
    }));
  if (operations.length) await getCollection('order_inventory').bulkWrite(operations);
}

function buildOrderApprovalPayload(order) {
  const items = (order.items || []).map((item) => `${item.quantity.toLocaleString('pt-BR')}x ${item.name}`).join('\n');
  const embed = new EmbedBuilder()
    .setColor(Number.parseInt(String(order.family_color || '#0EA5E9').replace('#', ''), 16) || 0x0ea5e9)
    .setTitle(`${ORDER_PANEL_EMOJI} Nova Encomenda #${order.order_number}`)
    .setDescription([
      `**Familia:** ${order.family_icon || ORDER_PANEL_EMOJI} ${order.family_name}`,
      `**Solicitante:** ${order.responsible_name || order.created_by_name || 'N/A'}`,
      '',
      '**Itens:**',
      items || 'Nenhum item',
      '',
      `**Valor Total:** ${formatMoney(order.total_value_cents)}`,
      `**Status:** ${statusLabel(order.status)}`,
      `**Data:** ${new Date(order.created_at).toLocaleDateString('pt-BR')}`,
    ].join('\n'))
    .setFooter({ text: 'Vortex | Sistema de Encomendas V2' })
    .setTimestamp(order.created_at);

  return {
    embeds: [embed],
    components: [
      row(
        button(`order_approve_${String(order._id)}`, 'Aprovar', ButtonStyle.Success, { disabled: order.status !== 'pending' }),
        button(`order_cancel_${String(order._id)}`, 'Recusar', ButtonStyle.Danger, { disabled: ['cancelled', 'delivered'].includes(order.status) }),
        button(`order_transport_${String(order._id)}`, 'Em Transporte', ButtonStyle.Primary, { disabled: !['pending', 'separating'].includes(order.status) }),
        button(`order_delivered_${String(order._id)}`, 'Entregue', ButtonStyle.Success, { disabled: ['delivered', 'cancelled'].includes(order.status) }),
      ),
    ],
    allowedMentions: { parse: [] },
  };
}

async function sendApprovalMessage(interaction, order) {
  if (!order.approval_channel_id) return '';
  const channel = await interaction.client.channels.fetch(order.approval_channel_id).catch(() => null);
  if (!channel?.isTextBased?.()) return '';
  const message = await channel.send(buildOrderApprovalPayload(order)).catch(() => null);
  return message?.id || '';
}

async function editApprovalMessage(interaction, order) {
  if (!order.approval_channel_id || !order.approval_message_id) return;
  const channel = await interaction.client.channels.fetch(order.approval_channel_id).catch(() => null);
  if (!channel?.isTextBased?.()) return;
  const message = await channel.messages.fetch(order.approval_message_id).catch(() => null);
  if (message?.editable) await message.edit(buildOrderApprovalPayload(order)).catch(() => null);
}

function getSession(interaction) {
  const key = sessionKey(interaction);
  if (!orderSessions.has(key)) {
    orderSessions.set(key, {
      guildId: getGuildId(interaction),
      userId: interaction.user.id,
      familyId: '',
      familyName: '',
      category: '',
      cart: [],
    });
  }
  return orderSessions.get(key);
}

function upsertCartLine(session, line) {
  const existing = session.cart.find((item) => item.key === line.key);
  if (existing) {
    existing.quantity += line.quantity;
    existing.total_value_cents = existing.quantity * existing.unit_price_cents;
  } else {
    session.cart.push(line);
  }
}

function cartTotal(session) {
  return session.cart.reduce((total, item) => total + item.total_value_cents, 0);
}

function cartDescription(session) {
  if (!session.cart.length) return '`Carrinho vazio.`';
  return session.cart
    .map((item, index) => `${index + 1}. ${item.quantity.toLocaleString('pt-BR')}x ${item.name} - ${formatMoney(item.total_value_cents)}`)
    .join('\n')
    .slice(0, 1800);
}

function buildOrderPanelPayload(interaction = null) {
  const embed = new EmbedBuilder()
    .setColor('#0EA5E9')
    .setAuthor({ name: 'VORTEX | Encomendas V2', iconURL: interaction?.client?.user?.displayAvatarURL?.() || undefined })
    .setTitle('Sistema de Encomendas V2')
    .setDescription([
      `${ORDER_PANEL_EMOJI} **Fazer Pedido** abre o fluxo por etapas com familia, tipo e carrinho.`,
      `${FAVORITE_EMOJI} Use modelos salvos para repetir pedidos de alto volume sem montar item por item.`,
      '',
      'Todos os pedidos, familias, estoque, favoritos e logs usam MongoDB. Nada e salvo em JSON local.',
    ].join('\n'))
    .setFooter({ text: 'Vortex | Sistema de Encomendas V2' })
    .setTimestamp();

  const components = [
    row(
      button('order_start', 'Fazer Pedido', ButtonStyle.Primary, { emoji: ORDER_PANEL_EMOJI }),
      button('order_family_manage', 'Gerenciar Familias', ButtonStyle.Secondary),
      button('order_history', 'Historico', ButtonStyle.Secondary),
      linkButton(`${ORDER_DASHBOARD_URL}/dashboard/orders`, 'Painel Web'),
    ),
  ];

  return buildPayload('orders', embed, components, false);
}

async function showFamilySelect(interaction) {
  const guildId = getGuildId(interaction);
  const families = await listFamilies(guildId);
  if (!families.length) {
    return respondPanel(interaction, buildPayload('orders', new EmbedBuilder()
      .setColor('#F59E0B')
      .setTitle('Nenhuma familia ativa')
      .setDescription('Cadastre uma familia no painel web ou em Gerenciar Familias antes de abrir pedidos.'),
    [row(button('order_family_manage', 'Gerenciar Familias', ButtonStyle.Primary))]), true);
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId('order_select_family')
    .setPlaceholder('Selecione a familia')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(families.slice(0, 25).map((family) => ({
      label: String(family.name || 'Familia').slice(0, 100),
      value: String(family._id),
      description: String(family.leader_name || family.slug || 'Sem lider').slice(0, 100),
    })));

  const embed = new EmbedBuilder()
    .setColor('#0EA5E9')
    .setTitle(`${ORDER_PANEL_EMOJI} Fazer Pedido`)
    .setDescription('Selecione a familia para continuar.');

  return respondPanel(interaction, buildPayload('orders', embed, [row(select), row(button('order_cancel_session', 'Cancelar', ButtonStyle.Secondary))]), true);
}

async function showCart(interaction) {
  const session = getSession(interaction);
  const categoryName = session.category ? categoryLabel(session.category) : 'Nao selecionado';
  const embed = new EmbedBuilder()
    .setColor('#0EA5E9')
    .setTitle(`${ORDER_PANEL_EMOJI} Pedido em andamento`)
    .setDescription([
      `**Familia:** ${session.familyName || 'Nao selecionada'}`,
      `**Tipo:** ${categoryName}`,
      '',
      '**Itens:**',
      cartDescription(session),
      '',
      `**Valor Total:** ${formatMoney(cartTotal(session))}`,
    ].join('\n'));

  const categorySelect = new StringSelectMenuBuilder()
    .setCustomId('order_select_category')
    .setPlaceholder('Tipo de Pedido')
    .addOptions(CATEGORY_OPTIONS.map((item) => ({
      ...item,
      default: item.value === session.category,
    })));

  const components = [
    row(categorySelect),
    row(
      button('order_add_item', 'Adicionar Item', ButtonStyle.Primary, { disabled: !session.category }),
      button('order_remove_item', 'Remover Item', ButtonStyle.Secondary, { disabled: !session.cart.length }),
      button('order_use_favorite', 'Usar Modelo Salvo', ButtonStyle.Secondary),
    ),
    row(
      button('order_save_favorite', 'Salvar Modelo', ButtonStyle.Secondary, { emoji: FAVORITE_EMOJI, disabled: !session.familyId || !session.cart.length }),
      button('order_finalize', 'Finalizar Pedido', ButtonStyle.Success, { disabled: !session.familyId || !session.cart.length }),
      button('order_cancel_session', 'Cancelar', ButtonStyle.Danger),
    ),
  ];

  return respondPanel(interaction, buildPayload('orders', embed, components), true);
}

async function showInventorySelect(interaction) {
  const session = getSession(interaction);
  if (!session.category) return showCart(interaction);
  if (session.category === 'custom') return safeShowModal(interaction, buildCustomItemModal(session.category));

  const items = await listInventory(session.guildId, session.category);
  if (!items.length) {
    const embed = new EmbedBuilder()
      .setColor('#F59E0B')
      .setTitle('Sem itens no estoque')
      .setDescription(`Nao existe item ativo em **${categoryLabel(session.category)}**. Cadastre no painel web ou use item personalizado.`);
    return respondPanel(interaction, buildPayload('orders', embed, [
      row(
        button('order_custom_item', 'Item Personalizado', ButtonStyle.Primary),
        button('order_back_cart', 'Voltar', ButtonStyle.Secondary),
      ),
    ]), true);
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId('order_select_inventory')
    .setPlaceholder('Selecione o item para adicionar')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(items.map((item) => ({
      label: String(item.name || 'Item').slice(0, 100),
      value: String(item._id),
      description: `${categoryLabel(item.category)} | ${item.quantity_available} disp. | ${formatMoney(item.unit_price_cents)}`.slice(0, 100),
    })));

  const embed = new EmbedBuilder()
    .setColor('#0EA5E9')
    .setTitle('Adicionar Item')
    .setDescription(`Tipo selecionado: **${categoryLabel(session.category)}**`);

  return respondPanel(interaction, buildPayload('orders', embed, [
    row(select),
    row(
      button('order_custom_item', 'Item Personalizado', ButtonStyle.Secondary),
      button('order_back_cart', 'Voltar', ButtonStyle.Secondary),
    ),
  ]), true);
}

function buildQuantityModal(itemId) {
  return new ModalBuilder()
    .setCustomId(`modal_order_quantity_${itemId}`)
    .setTitle('Adicionar item')
    .addComponents(
      row(new TextInputBuilder()
        .setCustomId('quantity')
        .setLabel('Quantidade')
        .setPlaceholder('Ex: 500')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(12)),
    );
}

function buildCustomItemModal(category = 'custom') {
  return new ModalBuilder()
    .setCustomId(`modal_order_custom_${category}`)
    .setTitle('Item personalizado')
    .addComponents(
      row(new TextInputBuilder()
        .setCustomId('name')
        .setLabel('Nome do item')
        .setPlaceholder('Ex: Lockpick')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(80)),
      row(new TextInputBuilder()
        .setCustomId('quantity')
        .setLabel('Quantidade')
        .setPlaceholder('Ex: 30')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(12)),
      row(new TextInputBuilder()
        .setCustomId('unit_price')
        .setLabel('Valor unitario')
        .setPlaceholder('Ex: 2500')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(18)),
    );
}

function buildFamilyModal(mode, family = null) {
  return new ModalBuilder()
    .setCustomId(mode === 'edit' ? `modal_order_family_edit_${String(family?._id || '')}` : 'modal_order_family_create')
    .setTitle(mode === 'edit' ? 'Editar familia' : 'Criar familia')
    .addComponents(
      row(new TextInputBuilder()
        .setCustomId('name')
        .setLabel('Nome da familia')
        .setValue(String(family?.name || '').slice(0, 80))
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(80)),
      row(new TextInputBuilder()
        .setCustomId('leader')
        .setLabel('Lider: ID - nome')
        .setValue(`${family?.leader_id || ''}${family?.leader_name ? ` - ${family.leader_name}` : ''}`.slice(0, 100))
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(100)),
      row(new TextInputBuilder()
        .setCustomId('visual')
        .setLabel('Cor #RRGGBB | emoji')
        .setValue(`${family?.color || '#0EA5E9'} | ${family?.icon || ORDER_PANEL_EMOJI}`.slice(0, 80))
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(80)),
      row(new TextInputBuilder()
        .setCustomId('webhook')
        .setLabel('Webhook de logs')
        .setValue(String(family?.log_webhook_url || '').slice(0, 200))
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(200)),
      row(new TextInputBuilder()
        .setCustomId('members')
        .setLabel('Membros: ID - nome, um por linha')
        .setValue((family?.members || []).map((member) => `${member.discord_id}${member.name ? ` - ${member.name}` : ''}`).join('\n').slice(0, 900))
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(900)),
    );
}

function buildCancelModal(orderId) {
  return new ModalBuilder()
    .setCustomId(`modal_order_cancel_${orderId}`)
    .setTitle('Recusar encomenda')
    .addComponents(
      row(new TextInputBuilder()
        .setCustomId('reason')
        .setLabel('Motivo')
        .setPlaceholder('Ex: Falta de estoque')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(600)),
    );
}

async function showRemoveSelect(interaction) {
  const session = getSession(interaction);
  if (!session.cart.length) return showCart(interaction);
  const select = new StringSelectMenuBuilder()
    .setCustomId('order_remove_line')
    .setPlaceholder('Escolha o item para remover')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(session.cart.slice(0, 25).map((item) => ({
      label: `${item.quantity}x ${item.name}`.slice(0, 100),
      value: item.key,
      description: formatMoney(item.total_value_cents).slice(0, 100),
    })));
  return respondPanel(interaction, buildPayload('orders', new EmbedBuilder()
    .setColor('#0EA5E9')
    .setTitle('Remover Item')
    .setDescription('Selecione o item que deve sair do carrinho.'),
  [row(select), row(button('order_back_cart', 'Voltar', ButtonStyle.Secondary))]), true);
}

async function showFavoriteSelect(interaction) {
  const session = getSession(interaction);
  const favorites = await listFavorites(session.guildId, session.familyId);
  if (!favorites.length) {
    return respondPanel(interaction, buildPayload('orders', new EmbedBuilder()
      .setColor('#F59E0B')
      .setTitle('Nenhum modelo salvo')
      .setDescription('Salve um modelo favorito depois de montar um carrinho.'),
    [row(button('order_back_cart', 'Voltar', ButtonStyle.Secondary))]), true);
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId('order_select_favorite')
    .setPlaceholder('Usar Modelo Salvo')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(favorites.map((favorite) => ({
      label: String(favorite.name || 'Modelo').slice(0, 100),
      value: String(favorite._id),
      description: `${favorite.family_name || 'Familia'} | ${(favorite.items || []).length} item(ns)`.slice(0, 100),
    })));

  return respondPanel(interaction, buildPayload('orders', new EmbedBuilder()
    .setColor('#0EA5E9')
    .setTitle(`${FAVORITE_EMOJI} Modelos Favoritos`)
    .setDescription('Selecione um modelo para preencher o carrinho.'),
  [row(select), row(button('order_back_cart', 'Voltar', ButtonStyle.Secondary))]), true);
}

async function saveFavorite(interaction) {
  const session = getSession(interaction);
  if (!session.familyId || !session.cart.length) return showCart(interaction);
  const familyId = objectId(session.familyId);
  const family = familyId ? await getCollection('order_families').findOne({ _id: familyId, guild_id: session.guildId }) : null;
  if (!family) return safeReply(interaction, { content: 'Familia nao encontrada.', ephemeral: true });
  const actor = getActor(interaction);
  const now = new Date();
  const doc = {
    _id: new mongoose.Types.ObjectId(),
    guild_id: session.guildId,
    family_id: String(family._id),
    family_name: family.name,
    name: `Modelo ${family.name}`,
    items: session.cart.map(({ key, ...item }) => item),
    created_by_id: actor.id,
    created_by_name: actor.name,
    created_at: now,
    updated_at: now,
  };
  await getCollection('order_favorites').insertOne(doc);
  await insertOrderLog({
    guild_id: session.guildId,
    family_id: String(family._id),
    family_name: family.name,
    action: 'favorite_saved',
    actor_id: actor.id,
    actor_name: actor.name,
    details: { name: doc.name, items: doc.items.length },
    created_at: now,
  }, family, await getSettings(session.guildId));
  return safeReply(interaction, { content: `${FAVORITE_EMOJI} Modelo salvo para ${family.name}.`, ephemeral: true });
}

async function finalizeOrder(interaction) {
  const session = getSession(interaction);
  if (!session.familyId || !session.cart.length) return showCart(interaction);

  const familyId = objectId(session.familyId);
  const family = familyId ? await getCollection('order_families').findOne({ _id: familyId, guild_id: session.guildId, active: true }) : null;
  if (!family) return safeReply(interaction, { content: 'Familia ativa nao encontrada.', ephemeral: true });

  const inventoryIds = session.cart
    .map((item) => item.inventory_item_id)
    .filter((id) => id && objectId(id))
    .map((id) => objectId(id));
  if (inventoryIds.length) {
    const stockRows = await getCollection('order_inventory').find({ guild_id: session.guildId, _id: { $in: inventoryIds } }).toArray();
    const stock = new Map(stockRows.map((item) => [String(item._id), item]));
    for (const line of session.cart) {
      if (!line.inventory_item_id) continue;
      const item = stock.get(line.inventory_item_id);
      if (!item || !item.active) return safeReply(interaction, { content: `${line.name} nao esta ativo no estoque.`, ephemeral: true });
      if (item.quantity_available < line.quantity) {
        return safeReply(interaction, { content: `${line.name} nao possui estoque suficiente. Disponivel: ${item.quantity_available}.`, ephemeral: true });
      }
    }
  }

  const actor = getActor(interaction);
  const now = new Date();
  const settings = await getSettings(session.guildId);
  const orderId = new mongoose.Types.ObjectId();
  const order = {
    _id: orderId,
    order_number: await nextOrderNumber(session.guildId),
    guild_id: session.guildId,
    family_id: String(family._id),
    family_name: family.name,
    family_slug: family.slug,
    family_color: family.color || '#0EA5E9',
    family_icon: family.icon || ORDER_PANEL_EMOJI,
    responsible_id: actor.id,
    responsible_name: actor.name,
    items: session.cart.map(({ key, ...item }) => item),
    total_value_cents: cartTotal(session),
    status: 'pending',
    stock_applied: true,
    stock_restored: false,
    approval_channel_id: settings?.order_channel_id || null,
    approval_message_id: null,
    created_by_id: actor.id,
    created_by_name: actor.name,
    source: 'discord',
    created_at: now,
    updated_at: now,
  };

  await applyStockDelta(session.guildId, order.items, -1);
  await getCollection('orders').insertOne(order);
  order.approval_message_id = await sendApprovalMessage(interaction, order);
  if (order.approval_message_id) {
    await getCollection('orders').updateOne(
      { _id: orderId, guild_id: session.guildId },
      { $set: { approval_message_id: order.approval_message_id } },
    );
  }

  await insertOrderLog({
    guild_id: session.guildId,
    order_id: String(orderId),
    order_number: order.order_number,
    family_id: order.family_id,
    family_name: order.family_name,
    action: 'order_created',
    actor_id: actor.id,
    actor_name: actor.name,
    details: { source: 'discord', items: order.items.length, totalValue: moneyFromCents(order.total_value_cents) },
    created_at: now,
  }, family, settings);

  for (const item of order.items) {
    await insertOrderLog({
      guild_id: session.guildId,
      order_id: String(orderId),
      order_number: order.order_number,
      family_id: order.family_id,
      family_name: order.family_name,
      action: 'item_added',
      actor_id: actor.id,
      actor_name: actor.name,
      details: { item: item.name, quantity: item.quantity },
      created_at: now,
    }, family, settings);
  }

  orderSessions.delete(sessionKey(interaction));
  return respondPanel(interaction, buildPayload('orders', new EmbedBuilder()
    .setColor('#22C55E')
    .setTitle(`Pedido #${order.order_number} criado`)
    .setDescription([
      `Familia: **${order.family_name}**`,
      `Itens: **${order.items.length}**`,
      `Valor Total: **${formatMoney(order.total_value_cents)}**`,
      order.approval_channel_id ? `Canal de aprovacao: <#${order.approval_channel_id}>` : 'Canal de aprovacao nao configurado no painel web.',
    ].join('\n')),
  [row(button('order_start', 'Novo Pedido', ButtonStyle.Primary), linkButton(`${ORDER_DASHBOARD_URL}/dashboard/orders`, 'Abrir Painel Web'))]), true);
}

async function showFamilyManager(interaction) {
  if (!hasOrderManagerPermission(interaction.member)) {
    return safeReply(interaction, { content: 'Voce nao tem permissao para gerenciar familias.', ephemeral: true });
  }

  const guildId = getGuildId(interaction);
  const families = await listFamilies(guildId, true);
  const selectedId = familySelections.get(sessionKey(interaction)) || String(families[0]?._id || '');
  const selected = families.find((family) => String(family._id) === selectedId) || families[0] || null;
  if (selected) familySelections.set(sessionKey(interaction), String(selected._id));

  const select = families.length
    ? new StringSelectMenuBuilder()
      .setCustomId('order_select_family_manage')
      .setPlaceholder('Selecionar familia')
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(families.slice(0, 25).map((family) => ({
        label: String(family.name || 'Familia').slice(0, 100),
        value: String(family._id),
        description: `${family.active ? 'Ativa' : 'Inativa'} | ${family.members?.length || 0} membro(s)`.slice(0, 100),
        default: selected && String(family._id) === String(selected._id),
      })))
    : null;

  const embed = new EmbedBuilder()
    .setColor(selected?.color || '#0EA5E9')
    .setTitle('Gerenciar Familias')
    .setDescription(selected ? [
      `Selecionada: **${selected.icon || ORDER_PANEL_EMOJI} ${selected.name}**`,
      `Lider: **${selected.leader_name || selected.leader_id || 'N/A'}**`,
      `Status: **${selected.active ? 'Ativa' : 'Inativa'}**`,
      `Membros: **${selected.members?.length || 0}**`,
      `Webhook: **${selected.log_webhook_url ? 'configurado' : 'nao configurado'}**`,
    ].join('\n') : 'Nenhuma familia cadastrada ainda.');

  const components = [];
  if (select) components.push(row(select));
  components.push(row(
    button('order_family_create', 'Criar Familia', ButtonStyle.Success),
    button('order_family_edit', 'Editar Familia', ButtonStyle.Primary, { disabled: !selected }),
    button('order_family_remove', 'Remover Familia', ButtonStyle.Danger, { disabled: !selected }),
  ));
  components.push(row(
    button('order_family_view', 'Visualizar Membros', ButtonStyle.Secondary, { disabled: !selected }),
    button('order_family_history', 'Historico da Familia', ButtonStyle.Secondary, { disabled: !selected }),
    linkButton(`${ORDER_DASHBOARD_URL}/dashboard/orders`, 'Painel Web'),
  ));

  return respondPanel(interaction, buildPayload('orders', embed, components), true);
}

async function selectedFamilyForManager(interaction) {
  const selectedId = familySelections.get(sessionKey(interaction));
  const id = objectId(selectedId);
  if (!id) return null;
  return getCollection('order_families').findOne({ _id: id, guild_id: getGuildId(interaction) });
}

async function removeSelectedFamily(interaction) {
  const family = await selectedFamilyForManager(interaction);
  if (!family) return showFamilyManager(interaction);
  const actor = getActor(interaction);
  await getCollection('order_families').deleteOne({ _id: family._id, guild_id: getGuildId(interaction) });
  await insertOrderLog({
    guild_id: getGuildId(interaction),
    family_id: String(family._id),
    family_name: family.name,
    action: 'family_deleted',
    actor_id: actor.id,
    actor_name: actor.name,
    created_at: new Date(),
  }, family, await getSettings(getGuildId(interaction)));
  familySelections.delete(sessionKey(interaction));
  return showFamilyManager(interaction);
}

async function showFamilyMembers(interaction) {
  const family = await selectedFamilyForManager(interaction);
  if (!family) return showFamilyManager(interaction);
  const members = (family.members || []).length
    ? family.members.map((member, index) => `${index + 1}. <@${member.discord_id}>${member.name ? ` - ${member.name}` : ''}`).join('\n')
    : '`Nenhum membro cadastrado.`';
  return safeReply(interaction, {
    embeds: [new EmbedBuilder()
      .setColor(family.color || '#0EA5E9')
      .setTitle(`Membros | ${family.name}`)
      .setDescription(members.slice(0, 3900))],
    ephemeral: true,
    allowedMentions: { parse: [] },
  });
}

async function showFamilyHistory(interaction) {
  const family = await selectedFamilyForManager(interaction);
  if (!family) return showFamilyManager(interaction);
  const logs = await getCollection('order_logs')
    .find({ guild_id: getGuildId(interaction), family_id: String(family._id) })
    .sort({ created_at: -1 })
    .limit(12)
    .toArray();
  const description = logs.length
    ? logs.map((log) => {
      const order = log.order_number ? `#${log.order_number}` : 'familia';
      return `**${new Date(log.created_at).toLocaleString('pt-BR')}** | ${order} | ${log.action} | ${log.actor_name || 'Sistema'}`;
    }).join('\n')
    : '`Nenhum historico registrado.`';
  return safeReply(interaction, {
    embeds: [new EmbedBuilder()
      .setColor(family.color || '#0EA5E9')
      .setTitle(`Historico | ${family.name}`)
      .setDescription(description.slice(0, 3900))],
    ephemeral: true,
    allowedMentions: { parse: [] },
  });
}

async function showGlobalHistory(interaction) {
  const guildId = getGuildId(interaction);
  const logs = await getCollection('order_logs')
    .find({ guild_id: guildId })
    .sort({ created_at: -1 })
    .limit(12)
    .toArray();
  const description = logs.length
    ? logs.map((log) => {
      const order = log.order_number ? `#${log.order_number}` : 'sistema';
      return `**${new Date(log.created_at).toLocaleString('pt-BR')}** | ${order} | ${log.family_name || 'N/A'} | ${log.action}`;
    }).join('\n')
    : '`Nenhum historico registrado.`';
  return safeReply(interaction, {
    embeds: [new EmbedBuilder()
      .setColor('#0EA5E9')
      .setTitle('Historico de Encomendas')
      .setDescription(description.slice(0, 3900))],
    ephemeral: true,
    allowedMentions: { parse: [] },
  });
}

async function updateOrderStatus(interaction, orderId, status, reason = '') {
  if (!ORDER_STATUSES.has(status)) return { ok: false, message: 'Status invalido.' };
  const id = objectId(orderId);
  if (!id) return { ok: false, message: 'Pedido invalido.' };

  const guildId = getGuildId(interaction);
  const orders = getCollection('orders');
  const order = await orders.findOne({ _id: id, guild_id: guildId });
  if (!order) return { ok: false, message: 'Pedido nao encontrado.' };
  if (order.status === 'delivered' || order.status === 'cancelled') {
    return { ok: false, message: 'Pedido ja esta finalizado.' };
  }

  const actor = getActor(interaction);
  const now = new Date();
  const update = {
    status,
    updated_at: now,
    decided_by_id: actor.id,
    decided_by_name: actor.name,
  };

  if (status === 'cancelled') {
    update.cancellation_reason = reason || 'Cancelado pelo Discord.';
    update.closed_at = now;
    if (order.stock_applied && !order.stock_restored) {
      await applyStockDelta(guildId, order.items || [], 1);
      update.stock_restored = true;
    }
  }

  if (status === 'delivered') {
    update.closed_at = now;
    update.delivered_by_id = actor.id;
    update.delivered_by_name = actor.name;
    update.received_by_id = order.responsible_id || null;
    update.received_by_name = order.responsible_name || null;
  }

  const result = await orders.findOneAndUpdate(
    { _id: id, guild_id: guildId },
    { $set: update },
    { returnDocument: 'after' },
  );
  if (!result) return { ok: false, message: 'Pedido nao encontrado.' };

  const family = objectId(result.family_id)
    ? await getCollection('order_families').findOne({ _id: objectId(result.family_id), guild_id: guildId })
    : null;
  const settings = await getSettings(guildId);
  await editApprovalMessage(interaction, result);
  await insertOrderLog({
    guild_id: guildId,
    order_id: String(result._id),
    order_number: result.order_number,
    family_id: result.family_id,
    family_name: result.family_name,
    action: status === 'cancelled' ? 'order_cancelled' : `status_${status}`,
    actor_id: actor.id,
    actor_name: actor.name,
    details: { status: statusLabel(status), reason: reason || null },
    created_at: now,
  }, family, settings);

  return { ok: true, order: result };
}

function parseOrderId(customId, prefix) {
  const value = String(customId || '');
  if (!value.startsWith(prefix)) return '';
  const id = value.slice(prefix.length);
  return objectId(id) ? id : '';
}

async function handleOrderButton(interaction) {
  if (!isMongoReady()) {
    return safeReply(interaction, { content: 'MongoDB nao esta conectado. O Sistema de Encomendas V2 nao salva dados locais.', ephemeral: true });
  }

  if (interaction.customId === 'order_start') {
    if (!hasOrderUserPermission(interaction.member)) {
      return safeReply(interaction, { content: 'Voce nao tem permissao para fazer encomendas.', ephemeral: true });
    }
    orderSessions.set(sessionKey(interaction), {
      guildId: getGuildId(interaction),
      userId: interaction.user.id,
      familyId: '',
      familyName: '',
      category: '',
      cart: [],
    });
    return showFamilySelect(interaction);
  }

  if (interaction.customId === 'order_family_manage') return showFamilyManager(interaction);
  if (interaction.customId === 'order_history') return showGlobalHistory(interaction);
  if (interaction.customId === 'order_back_cart') return showCart(interaction);
  if (interaction.customId === 'order_add_item') return showInventorySelect(interaction);
  if (interaction.customId === 'order_remove_item') return showRemoveSelect(interaction);
  if (interaction.customId === 'order_use_favorite') return showFavoriteSelect(interaction);
  if (interaction.customId === 'order_save_favorite') return saveFavorite(interaction);
  if (interaction.customId === 'order_finalize') {
    await safeDeferReply(interaction, { ephemeral: true });
    return finalizeOrder(interaction);
  }
  if (interaction.customId === 'order_cancel_session') {
    orderSessions.delete(sessionKey(interaction));
    return respondPanel(interaction, buildPayload('orders', new EmbedBuilder()
      .setColor('#64748B')
      .setTitle('Pedido cancelado')
      .setDescription('O carrinho atual foi descartado.'),
    [row(button('order_start', 'Fazer Pedido', ButtonStyle.Primary))]), true);
  }
  if (interaction.customId === 'order_custom_item') {
    const session = getSession(interaction);
    return safeShowModal(interaction, buildCustomItemModal(session.category || 'custom'));
  }

  if (interaction.customId === 'order_family_create') {
    if (!hasOrderManagerPermission(interaction.member)) return safeReply(interaction, { content: 'Sem permissao.', ephemeral: true });
    return safeShowModal(interaction, buildFamilyModal('create'));
  }
  if (interaction.customId === 'order_family_edit') {
    if (!hasOrderManagerPermission(interaction.member)) return safeReply(interaction, { content: 'Sem permissao.', ephemeral: true });
    const family = await selectedFamilyForManager(interaction);
    if (!family) return showFamilyManager(interaction);
    return safeShowModal(interaction, buildFamilyModal('edit', family));
  }
  if (interaction.customId === 'order_family_remove') {
    if (!hasOrderManagerPermission(interaction.member)) return safeReply(interaction, { content: 'Sem permissao.', ephemeral: true });
    return removeSelectedFamily(interaction);
  }
  if (interaction.customId === 'order_family_view') return showFamilyMembers(interaction);
  if (interaction.customId === 'order_family_history') return showFamilyHistory(interaction);

  if (/^order_(approve|cancel|transport|delivered)_/.test(interaction.customId) && !hasOrderManagerPermission(interaction.member)) {
    return safeReply(interaction, { content: 'Voce nao tem permissao para alterar o status de encomendas.', ephemeral: true });
  }

  const approveId = parseOrderId(interaction.customId, 'order_approve_');
  if (approveId) {
    await safeDeferReply(interaction, { ephemeral: true });
    const result = await updateOrderStatus(interaction, approveId, 'separating');
    return safeEdit(interaction, { content: result.ok ? `Pedido #${result.order.order_number} aprovado e enviado para separacao.` : result.message });
  }

  const transportId = parseOrderId(interaction.customId, 'order_transport_');
  if (transportId) {
    await safeDeferReply(interaction, { ephemeral: true });
    const result = await updateOrderStatus(interaction, transportId, 'transport');
    return safeEdit(interaction, { content: result.ok ? `Pedido #${result.order.order_number} marcado em transporte.` : result.message });
  }

  const deliveredId = parseOrderId(interaction.customId, 'order_delivered_');
  if (deliveredId) {
    await safeDeferReply(interaction, { ephemeral: true });
    const result = await updateOrderStatus(interaction, deliveredId, 'delivered');
    return safeEdit(interaction, { content: result.ok ? `Pedido #${result.order.order_number} entregue.` : result.message });
  }

  const cancelId = parseOrderId(interaction.customId, 'order_cancel_');
  if (cancelId) return safeShowModal(interaction, buildCancelModal(cancelId));

  return safeReply(interaction, { content: 'Acao de encomenda invalida.', ephemeral: true });
}

async function handleOrderSelect(interaction) {
  if (!isMongoReady()) {
    return safeReply(interaction, { content: 'MongoDB nao esta conectado. O Sistema de Encomendas V2 nao salva dados locais.', ephemeral: true });
  }

  if (interaction.customId === 'order_select_family') {
    const session = getSession(interaction);
    const id = objectId(interaction.values[0]);
    const family = id ? await getCollection('order_families').findOne({ _id: id, guild_id: session.guildId, active: true }) : null;
    if (!family) return safeReply(interaction, { content: 'Familia nao encontrada.', ephemeral: true });
    session.familyId = String(family._id);
    session.familyName = family.name;
    return showCart(interaction);
  }

  if (interaction.customId === 'order_select_category') {
    const session = getSession(interaction);
    session.category = CATEGORY_OPTIONS.some((item) => item.value === interaction.values[0]) ? interaction.values[0] : 'custom';
    return showCart(interaction);
  }

  if (interaction.customId === 'order_select_inventory') {
    const id = objectId(interaction.values[0]);
    if (!id) return safeReply(interaction, { content: 'Item invalido.', ephemeral: true });
    return safeShowModal(interaction, buildQuantityModal(String(id)));
  }

  if (interaction.customId === 'order_remove_line') {
    const session = getSession(interaction);
    const key = String(interaction.values[0] || '');
    session.cart = session.cart.filter((item) => item.key !== key);
    return showCart(interaction);
  }

  if (interaction.customId === 'order_select_favorite') {
    const session = getSession(interaction);
    const id = objectId(interaction.values[0]);
    const favorite = id ? await getCollection('order_favorites').findOne({ _id: id, guild_id: session.guildId }) : null;
    if (!favorite) return safeReply(interaction, { content: 'Modelo nao encontrado.', ephemeral: true });
    session.familyId = favorite.family_id;
    session.familyName = favorite.family_name;
    session.cart = (favorite.items || []).map((item, index) => ({
      key: item.inventory_item_id || `favorite-${String(favorite._id)}-${index}`,
      inventory_item_id: item.inventory_item_id || null,
      name: item.name,
      category: item.category || 'custom',
      quantity: item.quantity,
      unit_price_cents: item.unit_price_cents,
      total_value_cents: item.total_value_cents,
    }));
    return showCart(interaction);
  }

  if (interaction.customId === 'order_select_family_manage') {
    familySelections.set(sessionKey(interaction), String(interaction.values[0] || ''));
    return showFamilyManager(interaction);
  }

  return safeReply(interaction, { content: 'Selecao de encomenda invalida.', ephemeral: true });
}

async function handleOrderModal(interaction) {
  if (!isMongoReady()) {
    return safeReply(interaction, { content: 'MongoDB nao esta conectado. O Sistema de Encomendas V2 nao salva dados locais.', ephemeral: true });
  }

  if (interaction.customId.startsWith('modal_order_quantity_')) {
    const itemId = interaction.customId.replace('modal_order_quantity_', '');
    await safeDeferReply(interaction, { ephemeral: true });
    const session = getSession(interaction);
    const id = objectId(itemId);
    const item = id ? await getCollection('order_inventory').findOne({ _id: id, guild_id: session.guildId, active: true }) : null;
    const quantity = parsePositiveInt(interaction.fields.getTextInputValue('quantity'));
    if (!item) return safeEdit(interaction, { content: 'Item nao encontrado no estoque.' });
    if (!quantity) return safeEdit(interaction, { content: 'Informe uma quantidade maior que zero.' });
    if (item.quantity_available < quantity) return safeEdit(interaction, { content: `${item.name} possui apenas ${item.quantity_available} disponivel.` });

    upsertCartLine(session, {
      key: String(item._id),
      inventory_item_id: String(item._id),
      name: item.name,
      category: item.category,
      quantity,
      unit_price_cents: item.unit_price_cents,
      total_value_cents: item.unit_price_cents * quantity,
    });
    return safeEdit(interaction, { content: `${quantity.toLocaleString('pt-BR')}x ${item.name} adicionado ao carrinho.` });
  }

  if (interaction.customId.startsWith('modal_order_custom_')) {
    await safeDeferReply(interaction, { ephemeral: true });
    const session = getSession(interaction);
    const category = interaction.customId.replace('modal_order_custom_', '') || 'custom';
    const name = interaction.fields.getTextInputValue('name').trim().slice(0, 80);
    const quantity = parsePositiveInt(interaction.fields.getTextInputValue('quantity'));
    const unitPrice = parseMoney(interaction.fields.getTextInputValue('unit_price'), 0);
    if (!name || name.length < 2) return safeEdit(interaction, { content: 'Informe o nome do item.' });
    if (!quantity) return safeEdit(interaction, { content: 'Informe uma quantidade maior que zero.' });
    if (unitPrice === null) return safeEdit(interaction, { content: 'Valor unitario invalido.' });
    const unitPriceCents = cents(unitPrice);
    upsertCartLine(session, {
      key: `custom-${Date.now()}`,
      inventory_item_id: null,
      name,
      category: CATEGORY_OPTIONS.some((item) => item.value === category) ? category : 'custom',
      quantity,
      unit_price_cents: unitPriceCents,
      total_value_cents: unitPriceCents * quantity,
    });
    return safeEdit(interaction, { content: `${quantity.toLocaleString('pt-BR')}x ${name} adicionado ao carrinho.` });
  }

  if (interaction.customId === 'modal_order_family_create' || interaction.customId.startsWith('modal_order_family_edit_')) {
    if (!hasOrderManagerPermission(interaction.member)) return safeReply(interaction, { content: 'Sem permissao.', ephemeral: true });
    await safeDeferReply(interaction, { ephemeral: true });
    const guildId = getGuildId(interaction);
    const actor = getActor(interaction);
    const now = new Date();
    const name = interaction.fields.getTextInputValue('name').trim().slice(0, 80);
    const leaderText = interaction.fields.getTextInputValue('leader').trim();
    const visualText = interaction.fields.getTextInputValue('visual').trim();
    const webhook = interaction.fields.getTextInputValue('webhook').trim();
    const members = normalizeMemberLines(interaction.fields.getTextInputValue('members'));
    const [leaderIdRaw, ...leaderNameParts] = leaderText.split(/\s*-\s*/);
    const leaderId = /^\d{5,32}$/.test(leaderIdRaw || '') ? leaderIdRaw : '';
    const leaderName = leaderNameParts.join(' - ').trim() || (!leaderId ? leaderText : '');
    const [colorRaw, iconRaw] = visualText.split('|').map((item) => item.trim());
    const color = /^#[0-9a-f]{6}$/i.test(colorRaw || '') ? colorRaw.toUpperCase() : '#0EA5E9';
    const icon = (iconRaw || ORDER_PANEL_EMOJI).slice(0, 32);
    if (!name || name.length < 2) return safeEdit(interaction, { content: 'Informe o nome da familia.' });

    const editId = interaction.customId.startsWith('modal_order_family_edit_')
      ? objectId(interaction.customId.replace('modal_order_family_edit_', ''))
      : null;

    if (editId) {
      const result = await getCollection('order_families').findOneAndUpdate(
        { _id: editId, guild_id: guildId },
        {
          $set: {
            name,
            slug: createSlug(name),
            leader_id: leaderId || null,
            leader_name: leaderName || null,
            color,
            icon,
            log_webhook_url: webhook || null,
            members,
            active: true,
            updated_at: now,
          },
        },
        { returnDocument: 'after' },
      );
      if (!result) return safeEdit(interaction, { content: 'Familia nao encontrada.' });
      await insertOrderLog({
        guild_id: guildId,
        family_id: String(result._id),
        family_name: result.name,
        action: 'family_updated',
        actor_id: actor.id,
        actor_name: actor.name,
        details: { source: 'discord' },
        created_at: now,
      }, result, await getSettings(guildId));
      return safeEdit(interaction, { content: `Familia ${result.name} atualizada.` });
    }

    const doc = {
      _id: new mongoose.Types.ObjectId(),
      guild_id: guildId,
      name,
      slug: createSlug(name),
      leader_id: leaderId || null,
      leader_name: leaderName || null,
      color,
      icon,
      log_webhook_url: webhook || null,
      members,
      active: true,
      created_by_id: actor.id,
      created_by_name: actor.name,
      created_at: now,
      updated_at: now,
    };
    await getCollection('order_families').insertOne(doc);
    familySelections.set(sessionKey(interaction), String(doc._id));
    await insertOrderLog({
      guild_id: guildId,
      family_id: String(doc._id),
      family_name: doc.name,
      action: 'family_created',
      actor_id: actor.id,
      actor_name: actor.name,
      details: { source: 'discord' },
      created_at: now,
    }, doc, await getSettings(guildId));
    return safeEdit(interaction, { content: `Familia ${doc.name} criada.` });
  }

  const cancelId = parseOrderId(interaction.customId, 'modal_order_cancel_');
  if (cancelId) {
    if (!hasOrderManagerPermission(interaction.member)) return safeReply(interaction, { content: 'Sem permissao.', ephemeral: true });
    await safeDeferReply(interaction, { ephemeral: true });
    const reason = interaction.fields.getTextInputValue('reason').trim();
    const result = await updateOrderStatus(interaction, cancelId, 'cancelled', reason);
    return safeEdit(interaction, { content: result.ok ? `Pedido #${result.order.order_number} recusado/cancelado.` : result.message });
  }

  return safeReply(interaction, { content: 'Formulario de encomenda invalido.', ephemeral: true });
}

module.exports = {
  buildOrderPanelPayload,
  handleOrderButton,
  handleOrderModal,
  handleOrderSelect,
  hasOrderManagerPermission,
  hasOrderUserPermission,
};
