const mongoose = require('mongoose');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  LabelBuilder,
  ModalBuilder,
  RadioGroupBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
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
const ORDER_TICKET_MODAL_ID = 'modal_order_ticket';
const ORDER_TICKET_FAMILY_FIELD = 'order_ticket_family';
const ORDER_TICKET_SUBJECT_FIELD = 'order_ticket_subject';
const ORDER_TICKET_COUPON_FIELD = 'order_ticket_coupon';
const ORDER_TICKET_CURRENCY_FIELD = 'order_ticket_currency';
const ORDER_TICKET_TEXT_MODAL_ID = 'modal_order_ticket_text';
const ORDER_TICKET_FAMILY_TEXT_FIELD = 'order_ticket_family_text';
const ORDER_TICKET_CURRENCY_TEXT_FIELD = 'order_ticket_currency_text';
const GROUPED_QUANTITIES_MODAL_ID = 'modal_order_grouped_quantities';
const GROUPED_VALUES_MODAL_ID = 'modal_order_grouped_values';
const GROUPED_QUANTITY_FIELD_PREFIX = 'grouped_quantity_';
const GROUPED_VALUE_FIELD_PREFIX = 'grouped_value_';
const FAMILY_MUNITION_PRICES_FIELD = 'munition_prices';
const FAMILY_DEFAULT_DISCOUNT_FIELD = 'default_discount';

const orderSessions = new Map();
const familySelections = new Map();

const ORDER_STATUSES = new Set(['pending', 'separating', 'transport', 'delivered', 'cancelled']);
const CURRENCY_OPTIONS = [
  { label: 'Real (BRL)', value: 'BRL', description: 'Calcular em reais', emoji: '\u{1F4B8}' },
  { label: 'Dolar (USD)', value: 'USD', description: 'Calcular em dolar', emoji: '\u{1F4B5}' },
];
const GROUPED_ORDER_ITEMS = [
  { key: 'hk_mag', label: 'HK/MAG', emoji: '\u{1F52B}' },
  { key: 'tec_five', label: 'TEC/FIVE', emoji: '\u{1F52B}' },
  { key: 'mtar_mp7', label: 'MTAR/MP7', emoji: '\u{1F52B}' },
];
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
    throw new Error('MongoDB nao esta conectado. O Sistema de Encomendas Vortex nao grava dados locais.');
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

function clampPercentage(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(100, number));
}

function parsePercentage(value, fallback = 0) {
  const raw = String(value || '').trim().replace('%', '').replace(',', '.');
  if (!raw) return fallback;
  return clampPercentage(raw);
}

function formatMoney(valueCents) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(moneyFromCents(valueCents));
}

function resolveCurrency(value) {
  return value === 'USD' ? 'USD' : 'BRL';
}

function currencyLabel(currency) {
  return resolveCurrency(currency) === 'USD' ? 'Dolar (USD)' : 'Real (BRL)';
}

function formatOrderMoney(valueCents, currency = 'BRL') {
  const resolved = resolveCurrency(currency);
  return new Intl.NumberFormat(resolved === 'USD' ? 'en-US' : 'pt-BR', {
    style: 'currency',
    currency: resolved,
  }).format(moneyFromCents(valueCents));
}

function inventoryPrice(item, currency = 'BRL') {
  const fallback = Number(item?.unit_price_cents || 0);
  return resolveCurrency(currency) === 'USD'
    ? Number(item?.price_usd_cents ?? fallback)
    : Number(item?.price_brl_cents ?? fallback);
}

function emptyGroupedItems() {
  return Object.fromEntries(GROUPED_ORDER_ITEMS.map((item) => [item.key, {
    key: item.key,
    label: item.label,
    quantity: 0,
    valueCents: 0,
  }]));
}

function groupedOrderLines(session) {
  const groupedItems = session.groupedItems || {};
  return GROUPED_ORDER_ITEMS
    .map((meta) => ({ ...meta, ...(groupedItems[meta.key] || {}) }))
    .filter((item) => Number(item.quantity || 0) > 0 && Number(item.valueCents || 0) > 0);
}

function groupedOrderTotals(session) {
  const subtotal = groupedOrderLines(session).reduce((total, item) => total + Number(item.valueCents || 0), 0);
  const percent = Math.max(0, Math.min(100, Number(session.couponPercentage || 0)));
  const discount = hasSessionDiscount(session) ? Math.round(subtotal * (percent / 100)) : 0;
  return {
    subtotal,
    discount,
    final: Math.max(0, subtotal - discount),
  };
}

function groupedOrderSummary(session) {
  const currency = resolveCurrency(session.currency);
  const lines = groupedOrderLines(session);
  const totals = groupedOrderTotals(session);
  const itemLines = lines.length
    ? lines.flatMap((item) => [
      `${item.emoji || '\u{1F52B}'} **${item.label}**`,
      `Quantidade: **${Number(item.quantity || 0).toLocaleString('pt-BR')}**`,
      `Valor: **${formatOrderMoney(item.valueCents || 0, currency)}**`,
    ]).join('\n')
    : 'Nenhum produto preenchido.';

  return [
    `**Familia:** ${session.familyName || 'Selecione'}`,
    `**Moeda:** ${currencyLabel(currency)}`,
    '',
    itemLines,
    '',
    `**Cupom/Desconto:** ${discountSummaryLabel(session)}`,
    `**Desconto:** ${Number(session.couponPercentage || 0)}%`,
    `**Valor do Desconto:** ${formatOrderMoney(totals.discount, currency)}`,
    `**Total Final:** ${formatOrderMoney(totals.final, currency)}`,
  ].join('\n');
}

function parseGroupedProductInput(input) {
  const raw = String(input || '').trim();
  if (!raw) return { quantity: 0, valueCents: 0 };
  const explicitParts = raw.split(/[|;]/).map((part) => part.trim()).filter(Boolean);
  const parts = explicitParts.length >= 2 ? explicitParts : (raw.match(/\d[\d.,]*/g) || []);
  const quantity = parsePositiveInt(parts[0] || '0') || 0;
  const amount = parseMoney(parts.slice(1).join(' ') || '0', 0);
  return {
    quantity,
    valueCents: cents(amount || 0),
  };
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

function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function modalTextValue(fields, customId) {
  try {
    return String(fields.getTextInputValue(customId) || '').trim();
  } catch {
    return '';
  }
}

function groupedQuantityFieldId(item) {
  return `${GROUPED_QUANTITY_FIELD_PREFIX}${item.key}`;
}

function groupedValueFieldId(item) {
  return `${GROUPED_VALUE_FIELD_PREFIX}${item.key}`;
}

function groupedOrderSubject(session) {
  const currency = resolveCurrency(session.currency);
  return groupedOrderLines(session)
    .map((item) => `${item.label} ${Number(item.quantity || 0).toLocaleString('pt-BR')} | ${formatOrderMoney(item.valueCents || 0, currency)}`)
    .join('; ');
}

function matchGroupedOrderItem(value) {
  const normalized = normalizeSearchText(value);
  if (!normalized) return null;
  return GROUPED_ORDER_ITEMS.find((item) => {
    const label = normalizeSearchText(item.label);
    const key = normalizeSearchText(item.key);
    return normalized.includes(label) || normalized.includes(key) || label.includes(normalized) || key.includes(normalized);
  }) || null;
}

function parseMunitionUnitPrices(value) {
  const result = {};
  const segments = String(value || '')
    .split(/\r?\n|;/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const segment of segments) {
    const meta = matchGroupedOrderItem(segment);
    if (!meta) continue;
    const explicit = segment.split(/[=:|]/).slice(1).join(' ').trim();
    const numbers = segment.match(/\d[\d.,]*/g) || [];
    const priceText = explicit || numbers[numbers.length - 1] || '';
    if (!priceText) continue;
    const price = parseMoney(priceText, 0);
    if (price === null) continue;
    result[meta.key] = cents(price);
  }

  return result;
}

function familyMunitionUnitPrices(family) {
  const source = family?.munition_unit_prices || family?.munition_prices || {};
  return GROUPED_ORDER_ITEMS.reduce((prices, item) => {
    prices[item.key] = Math.max(0, Number(source?.[item.key] || 0));
    return prices;
  }, {});
}

function formatFamilyPriceInput(family) {
  const prices = familyMunitionUnitPrices(family);
  return GROUPED_ORDER_ITEMS
    .map((item) => `${item.label}=${moneyFromCents(prices[item.key] || 0)}`)
    .join('; ');
}

function formatFamilyPricesShort(family, currency = 'BRL') {
  const prices = familyMunitionUnitPrices(family);
  const configured = GROUPED_ORDER_ITEMS
    .filter((item) => Number(prices[item.key] || 0) > 0)
    .map((item) => `${item.label}: ${formatOrderMoney(prices[item.key], currency)}`);
  return configured.length ? configured.join(' | ') : 'nao configurado';
}

function familyDefaultDiscountPercentage(family) {
  return clampPercentage(family?.default_discount_percentage ?? family?.default_discount_percent ?? 0) ?? 0;
}

function applyFamilyDefaultDiscount(session, family) {
  const percentage = familyDefaultDiscountPercentage(family);
  session.familyDiscountPercentage = percentage;
  session.couponId = '';
  session.couponCode = '';
  if (percentage > 0) {
    session.discountSource = 'family';
    session.couponMode = 'no';
    session.couponPercentage = percentage;
  } else {
    session.discountSource = 'none';
    session.couponMode = 'no';
    session.couponPercentage = 0;
  }
}

function hasSessionDiscount(session) {
  return Number(session?.couponPercentage || 0) > 0
    && ['coupon', 'family'].includes(String(session?.discountSource || ''));
}

function discountSummaryLabel(session) {
  if (session?.discountSource === 'coupon') return session.couponCode || 'Selecione';
  if (session?.discountSource === 'family') return `Desconto da familia (${Number(session.couponPercentage || 0)}%)`;
  return 'Nao';
}

function applyFamilyPricesToGroupedItems(groupedItems, family) {
  const prices = familyMunitionUnitPrices(family);
  const missing = [];
  for (const item of GROUPED_ORDER_ITEMS) {
    const line = groupedItems[item.key];
    if (!line || !Number(line.quantity || 0)) continue;
    if (Number(line.valueCents || 0) > 0) continue;
    const unitPrice = Number(prices[item.key] || 0);
    if (unitPrice > 0) {
      line.valueCents = unitPrice * Number(line.quantity || 0);
    } else {
      missing.push(item.label);
    }
  }
  return missing;
}

function parseOrderTicketSubject(subject) {
  const grouped = emptyGroupedItems();
  const segments = String(subject || '')
    .split(/\r?\n|;/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const segment of segments) {
    const normalized = normalizeSearchText(segment);
    const meta = GROUPED_ORDER_ITEMS.find((item) => {
      const labelKey = normalizeSearchText(item.label);
      const itemKey = normalizeSearchText(item.key);
      return normalized.includes(labelKey) || normalized.includes(itemKey);
    });
    if (!meta) continue;

    const parsed = parseGroupedProductInput(segment);
    if (!parsed.quantity) continue;
    grouped[meta.key] = {
      key: meta.key,
      label: meta.label,
      emoji: meta.emoji,
      quantity: parsed.quantity,
      valueCents: parsed.valueCents,
    };
  }

  return grouped;
}

function applyGroupedQuantityFields(session, fields) {
  session.groupedItems = session.groupedItems || emptyGroupedItems();
  let totalQuantity = 0;

  for (const item of GROUPED_ORDER_ITEMS) {
    const current = session.groupedItems[item.key] || {};
    const quantity = parsePositiveInt(modalTextValue(fields, groupedQuantityFieldId(item))) || 0;
    totalQuantity += quantity;
    session.groupedItems[item.key] = {
      key: item.key,
      label: item.label,
      emoji: item.emoji,
      quantity,
      valueCents: quantity ? Number(current.valueCents || 0) : 0,
    };
  }

  return totalQuantity;
}

function applyGroupedValueFields(session, fields) {
  session.groupedItems = session.groupedItems || emptyGroupedItems();
  const errors = [];

  for (const item of GROUPED_ORDER_ITEMS) {
    const current = session.groupedItems[item.key] || {};
    const rawValue = modalTextValue(fields, groupedValueFieldId(item));
    const parsedValue = parseMoney(rawValue, 0);
    const quantity = Number(current.quantity || 0);

    if (parsedValue === null) {
      errors.push(`Valor Total ${item.label}`);
      continue;
    }
    if (!quantity && Number(parsedValue || 0) > 0) {
      errors.push(`Quantidade ${item.label}`);
      continue;
    }

    session.groupedItems[item.key] = {
      key: item.key,
      label: item.label,
      emoji: item.emoji,
      quantity,
      valueCents: cents(parsedValue || 0),
    };
  }

  return errors;
}

async function findCouponByCode(guildId, familyId, value) {
  const normalized = normalizeSearchText(value);
  if (!normalized) return null;
  const coupons = await listCoupons(guildId, familyId);
  return coupons.find((coupon) => {
    const code = normalizeSearchText(coupon.code || '');
    const name = normalizeSearchText(coupon.name || '');
    return code === normalized || name === normalized;
  }) || null;
}

async function resolveOrderTicketFamily(guildId, value) {
  const raw = String(value || '').trim();
  const id = objectId(raw);
  if (id) {
    const family = await getCollection('order_families').findOne({ _id: id, guild_id: guildId, active: true });
    if (family) return family;
  }

  const normalized = normalizeSearchText(raw);
  if (!normalized) return null;
  const families = await listFamilies(guildId);
  return families.find((family) => {
    const name = normalizeSearchText(family.name);
    const slug = normalizeSearchText(family.slug);
    return name === normalized || slug === normalized;
  }) || families.find((family) => {
    const name = normalizeSearchText(family.name);
    return name.includes(normalized) || normalized.includes(name);
  }) || null;
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

async function listCoupons(guildId, familyId = '') {
  const now = new Date();
  const rows = await getCollection('order_coupons')
    .find({
      guild_id: guildId,
      active: true,
      $or: [
        { expires_at: null },
        { expires_at: { $exists: false } },
        { expires_at: { $gte: now } },
      ],
    })
    .sort({ name: 1 })
    .limit(24)
    .toArray();

  return rows.filter((coupon) => {
    const familyIds = Array.isArray(coupon.family_ids) ? coupon.family_ids.map(String) : [];
    if (coupon.usage_limit && Number(coupon.used_count || 0) >= Number(coupon.usage_limit)) return false;
    return !familyIds.length || familyIds.includes(String(familyId || ''));
  });
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
  const currency = resolveCurrency(order.currency);
  const items = (order.items || []).map((line) => [
    `${line.emoji || '\u{1F52B}'} **${line.name}**`,
    `Quantidade: ${Number(line.quantity || 0).toLocaleString('pt-BR')}`,
    `Valor: ${formatOrderMoney(Number(line.total_value_cents || 0), currency)}`,
  ].join('\n')).join('\n\n');
  const subtotal = Number(order.subtotal_value_cents ?? order.total_value_cents ?? 0);
  const discount = Number(order.discount_value_cents ?? 0);
  const final = Number(order.final_value_cents ?? order.total_value_cents ?? Math.max(0, subtotal - discount));
  const discountLabel = order.coupon_code
    ? `${order.coupon_code} (${Number(order.coupon_percentage || 0)}%)`
    : Number(order.coupon_percentage || 0) > 0
      ? `Desconto da familia (${Number(order.coupon_percentage || 0)}%)`
      : 'Sem desconto';
  const embed = new EmbedBuilder()
    .setColor(Number.parseInt(String(order.family_color || '#0EA5E9').replace('#', ''), 16) || 0x0ea5e9)
    .setTitle(`${ORDER_PANEL_EMOJI} Nova Encomenda`)
    .setDescription([
      `**ID da Encomenda:** #${order.order_number}`,
      '',
      `**\u{1F464} Solicitante:** ${order.responsible_mention || order.responsible_name || order.created_by_name || 'N/A'}`,
      `**\u{1F3E0} Familia:** ${order.family_icon || ORDER_PANEL_EMOJI} ${order.family_name}`,
      `**\u{1F4B1} Moeda:** ${currencyLabel(currency)}`,
      order.subject ? `**Assunto:** ${String(order.subject).slice(0, 500)}` : null,
      '',
      items ? '**Itens da Encomenda:**' : '**Itens da Encomenda:**',
      items || 'Nenhum item',
      '',
      `**\u{1F3DF} Cupom/Desconto:** ${discountLabel}`,
      `**\u{1F4B8} Desconto:** ${formatOrderMoney(discount, currency)}`,
      `**\u{1F4B0} Total Final:** ${formatOrderMoney(final, currency)}`,
      `**\u{1F4C5} Data:** ${new Date(order.created_at).toLocaleDateString('pt-BR')}`,
      `**Status:** ${order.status === 'pending' ? '\u{1F7E1} Pendente' : statusLabel(order.status)}`,
    ].filter(Boolean).join('\n'))
    .setFooter({ text: 'Vortex | Sistema de Encomendas' })
    .setTimestamp(order.created_at);

  return {
    content: order.responsible_role_id ? `<@&${order.responsible_role_id}>` : undefined,
    embeds: [embed],
    components: [
      row(
        button(`order_approve_${String(order._id)}`, 'Aprovar', ButtonStyle.Success, { disabled: order.status !== 'pending' }),
        button(`order_cancel_${String(order._id)}`, 'Recusar', ButtonStyle.Danger, { disabled: ['cancelled', 'delivered'].includes(order.status) }),
        button(`order_transport_${String(order._id)}`, 'Em Transporte', ButtonStyle.Primary, { disabled: !['pending', 'separating'].includes(order.status) }),
        button(`order_delivered_${String(order._id)}`, 'Entregue', ButtonStyle.Success, { disabled: ['delivered', 'cancelled'].includes(order.status) }),
      ),
    ],
    allowedMentions: order.responsible_role_id ? { parse: [], roles: [String(order.responsible_role_id)] } : { parse: [] },
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
      familyLeaderName: '',
      familyOrderChannelId: '',
      familyResponsibleRoleId: '',
      mode: 'grouped',
      currency: 'BRL',
      currencySelected: false,
      productId: '',
      productName: '',
      quantity: 0,
      couponMode: 'no',
      couponId: '',
      couponCode: '',
      couponPercentage: 0,
      discountSource: 'none',
      familyDiscountPercentage: 0,
      subject: '',
      couponInput: '',
      groupedItems: emptyGroupedItems(),
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
  if (session.productId && session.quantity > 0 && Number.isFinite(session.unitPriceCents)) {
    const gross = session.unitPriceCents * session.quantity;
    const discount = hasSessionDiscount(session) ? Math.round(gross * (Number(session.couponPercentage || 0) / 100)) : 0;
    return Math.max(0, gross - discount);
  }
  return session.cart.reduce((total, item) => total + item.total_value_cents, 0);
}

function orderPreviewTotals(session) {
  const quantity = Math.max(0, Number(session.quantity || 0));
  const unit = Number(session.unitPriceCents || 0);
  const gross = unit * quantity;
  const percent = Math.max(0, Math.min(100, Number(session.couponPercentage || 0)));
  const discount = hasSessionDiscount(session) ? Math.round(gross * (percent / 100)) : 0;
  return {
    gross,
    discount,
    final: Math.max(0, gross - discount),
  };
}

function cartDescription(session) {
  if (session.productId) {
    const totals = orderPreviewTotals(session);
    return [
      `Produto: **${session.productName || 'Nao selecionado'}**`,
      `Quantidade: **${Number(session.quantity || 0).toLocaleString('pt-BR')}**`,
      `Unitario: **${formatOrderMoney(session.unitPriceCents || 0, session.currency)}**`,
      `Bruto: **${formatOrderMoney(totals.gross, session.currency)}**`,
      `Cupom/Desconto: **${discountSummaryLabel(session)}**`,
      `Desconto: **${formatOrderMoney(totals.discount, session.currency)}**`,
      `Final: **${formatOrderMoney(totals.final, session.currency)}**`,
    ].join('\n');
  }
  if (!session.cart.length) return '`Carrinho vazio.`';
  return session.cart
    .map((item, index) => `${index + 1}. ${item.quantity.toLocaleString('pt-BR')}x ${item.name} - ${formatMoney(item.total_value_cents)}`)
    .join('\n')
    .slice(0, 1800);
}

function buildOrderPanelPayload(interaction = null) {
  const embed = new EmbedBuilder()
    .setColor('#0EA5E9')
    .setAuthor({ name: 'VORTEX | Encomendas', iconURL: interaction?.client?.user?.displayAvatarURL?.() || undefined })
    .setTitle('Sistema de Encomendas Vortex')
    .setDescription([
      '### Nova encomenda',
      '',
      'Clique em **Abrir Nova Encomenda** para iniciar seu pedido.',
      'Escolha a familia, informe as municoes, quantidades e valores totais, adicione cupom se tiver e envie para aprovacao.',
      '',
      '**Antes de enviar**',
      'Confira os valores, descontos e total final no resumo.',
    ].join('\n'))
    .setFooter({ text: 'Vortex | Sistema de Encomendas' })
    .setTimestamp();

  const components = [
    row(
      button('order_start', 'Abrir Nova Encomenda', ButtonStyle.Primary, { emoji: '\u{2795}' }),
    ),
  ];

  return buildPayload('orders', embed, components, false);
}

function buildOrderTicketModal(families) {
  const familySelect = new StringSelectMenuBuilder()
    .setCustomId(ORDER_TICKET_FAMILY_FIELD)
    .setPlaceholder('Selecione a categoria da encomenda')
    .setRequired(true)
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(families.slice(0, 25).map((family) => ({
      label: String(family.name || 'Familia').slice(0, 100),
      value: String(family._id),
      description: String(family.leader_name || family.slug || 'Sem lider').slice(0, 100),
    })));

  const couponInput = new TextInputBuilder()
    .setCustomId(ORDER_TICKET_COUPON_FIELD)
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(80)
    .setPlaceholder('Ex: VORTEX10');

  const currencyRadio = new RadioGroupBuilder()
    .setCustomId(ORDER_TICKET_CURRENCY_FIELD)
    .setRequired(true)
    .setOptions(
      { label: 'Real (BRL)', value: 'BRL', description: 'Calcular a encomenda em reais.', default: true },
      { label: 'Dolar (USD)', value: 'USD', description: 'Calcular a encomenda em dolar.' },
    );

  const modal = new ModalBuilder()
    .setCustomId(ORDER_TICKET_MODAL_ID)
    .setTitle('Abrir Nova Encomenda');

  modal.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    '\u{26A0}\u{FE0F} Este formulario sera enviado ao Sistema de Encomendas Vortex. Depois informe as quantidades e valores das municoes.',
  ));
  modal.addLabelComponents(
    new LabelBuilder()
      .setLabel('Selecione a Categoria da Encomenda *')
      .setStringSelectMenuComponent(familySelect),
    new LabelBuilder()
      .setLabel('Insira seu CUPOM')
      .setDescription('Deixe em branco se nao se aplica.')
      .setTextInputComponent(couponInput),
    new LabelBuilder()
      .setLabel('Qual moeda sera usada na encomenda? *')
      .setRadioGroupComponent(currencyRadio),
  );

  return modal;
}

function buildOrderTicketTextModal(families) {
  const familyNames = families
    .slice(0, 6)
    .map((family) => String(family.name || 'Familia'))
    .join(', ');
  const defaultFamily = families.length === 1 ? String(families[0].name || '') : '';

  const modal = new ModalBuilder()
    .setCustomId(ORDER_TICKET_TEXT_MODAL_ID)
    .setTitle('Abrir Nova Encomenda');

  const familyInput = new TextInputBuilder()
    .setCustomId(ORDER_TICKET_FAMILY_TEXT_FIELD)
    .setLabel('Categoria da Encomenda *')
    .setPlaceholder(familyNames ? `Ex: ${familyNames.slice(0, 92)}` : 'Ex: Vortex')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(2)
    .setMaxLength(100);
  if (defaultFamily) familyInput.setValue(defaultFamily.slice(0, 100));

  modal.addComponents(
    row(familyInput),
    row(new TextInputBuilder()
      .setCustomId(ORDER_TICKET_SUBJECT_FIELD)
      .setLabel('Assunto da Encomenda *')
      .setPlaceholder('Ex: HK/MAG 100; TEC/FIVE 50. Valor manual opcional: HK/MAG 100 | R$ 50000')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMinLength(10)
      .setMaxLength(1000)),
    row(new TextInputBuilder()
      .setCustomId(ORDER_TICKET_COUPON_FIELD)
      .setLabel('Insira seu CUPOM')
      .setPlaceholder('Deixe em branco se nao se aplica. Ex: VORTEX10')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(80)),
    row(new TextInputBuilder()
      .setCustomId(ORDER_TICKET_CURRENCY_TEXT_FIELD)
      .setLabel('Moeda *')
      .setPlaceholder('BRL ou USD')
      .setValue('BRL')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(3)),
  );

  return modal;
}

async function showOrderTicketModal(interaction) {
  const session = getSession(interaction);
  const families = await listFamilies(session.guildId);
  if (!families.length) {
    return safeReply(interaction, {
      content: 'Cadastre uma familia ativa no painel administrativo antes de abrir encomendas.',
      ephemeral: true,
    });
  }
  return safeShowModal(interaction, buildOrderTicketModal(families))
    .catch(() => {
      if (interaction.replied || interaction.deferred) return null;
      return safeShowModal(interaction, buildOrderTicketTextModal(families));
    });
}

async function buildOrderAdminPanelPayload(interaction = null) {
  const guildId = interaction ? getGuildId(interaction) : String(process.env.GUILD_ID || 'global');
  const [families, coupons, products, settings] = isMongoReady()
    ? await Promise.all([
      getCollection('order_families').countDocuments({ guild_id: guildId }),
      getCollection('order_coupons').countDocuments({ guild_id: guildId }),
      getCollection('order_inventory').countDocuments({ guild_id: guildId }),
      getSettings(guildId),
    ])
    : [0, 0, 0, null];

  const embed = new EmbedBuilder()
    .setColor('#0EA5E9')
    .setAuthor({ name: 'VORTEX | Gerenciamento de Encomendas', iconURL: interaction?.client?.user?.displayAvatarURL?.() || undefined })
    .setTitle('Painel Administrativo')
    .setDescription([
      `Familias cadastradas: **${families}**`,
      `Cupons cadastrados: **${coupons}**`,
      `Produtos cadastrados: **${products}**`,
      `Canal de registro: ${settings?.order_channel_id ? `<#${settings.order_channel_id}>` : '**nao configurado**'}`,
      '',
      'Use o painel web para editar familias, cupons, valores BRL/USD e status. Use os botoes abaixo para publicar o painel publico ou acessar atalhos de gerenciamento.',
    ].join('\n'))
    .setFooter({ text: 'Vortex | Sistema de Encomendas' })
    .setTimestamp();

  return buildPayload('orders', embed, [
    row(
      button('order_publish_public_panel', 'Publicar Painel Publico', ButtonStyle.Success, { emoji: ORDER_PANEL_EMOJI }),
      button('order_family_manage', 'Familias', ButtonStyle.Secondary),
      button('order_history', 'Historico', ButtonStyle.Secondary),
    ),
    row(
      linkButton(`${ORDER_DASHBOARD_URL}/dashboard/orders`, 'Abrir Painel Web'),
    ),
  ], true);
}

async function showCurrencySelection(interaction) {
  const embed = new EmbedBuilder()
    .setColor('#0EA5E9')
    .setTitle('Qual moeda sera utilizada nesta encomenda?')
    .setDescription('Escolha a moeda antes de abrir o formulario de encomenda.');

  return respondPanel(interaction, buildPayload('orders', embed, [
    row(
      button('order_currency_USD', 'Dolar', ButtonStyle.Primary, { emoji: '\u{1F4B5}' }),
      button('order_currency_BRL', 'Real', ButtonStyle.Success, { emoji: '\u{1F4B8}' }),
      button('order_cancel_session', 'Cancelar', ButtonStyle.Danger),
    ),
  ]), true);
}

async function showGroupedOrderForm(interaction) {
  const session = getSession(interaction);
  const [families, coupons] = await Promise.all([
    listFamilies(session.guildId),
    listCoupons(session.guildId, session.familyId),
  ]);

  if (!families.length) {
    return respondPanel(interaction, buildPayload('orders', new EmbedBuilder()
      .setColor('#F59E0B')
      .setTitle('Nenhuma familia ativa')
      .setDescription('Cadastre uma familia no painel administrativo antes de abrir encomendas.'),
    [row(linkButton(`${ORDER_DASHBOARD_URL}/dashboard/orders`, 'Abrir Painel Web'))]), true);
  }

  const familySelect = new StringSelectMenuBuilder()
    .setCustomId('order_select_family')
    .setPlaceholder('Selecionar Familia')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(families.slice(0, 25).map((family) => ({
      label: String(family.name || 'Familia').slice(0, 100),
      value: String(family._id),
      description: String(family.leader_name || 'Sem lider').slice(0, 100),
      default: String(family._id) === String(session.familyId || ''),
    })));

  const components = [
    row(familySelect),
    row(
      button('order_coupon_yes', 'Cupom: Sim', session.couponMode === 'yes' ? ButtonStyle.Success : ButtonStyle.Secondary),
      button('order_coupon_no', 'Cupom: Nao', session.couponMode === 'no' ? ButtonStyle.Success : ButtonStyle.Secondary),
    ),
  ];

  if (session.couponMode === 'yes') {
    const couponOptions = coupons.length
      ? coupons.slice(0, 25).map((coupon) => ({
        label: String(coupon.code || coupon.name || 'Cupom').slice(0, 100),
        value: String(coupon._id),
        description: `${Number(coupon.percentage || 0)}% de desconto`.slice(0, 100),
        default: String(coupon._id) === String(session.couponId || ''),
      }))
      : [{ label: 'Nenhum cupom ativo', value: 'none', description: 'Cadastre cupons no painel', default: true }];
    components.push(row(new StringSelectMenuBuilder()
      .setCustomId('order_select_coupon')
      .setPlaceholder('Selecionar Cupom')
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(couponOptions)));
  }

  const hasLines = groupedOrderLines(session).length > 0;
  components.push(row(
    button('order_grouped_items', 'Preencher Municoes', ButtonStyle.Primary),
    button('order_grouped_review', 'Ver Resumo', ButtonStyle.Success, { disabled: !session.familyId || !hasLines || (session.couponMode === 'yes' && !session.couponId) }),
    button('order_cancel_session', 'Cancelar', ButtonStyle.Danger),
  ));

  const embed = new EmbedBuilder()
    .setColor('#0EA5E9')
    .setTitle('Formulario de Nova Encomenda')
    .setDescription(groupedOrderSummary(session));

  return respondPanel(interaction, buildPayload('orders', embed, components), true);
}

function buildGroupedQuantitiesModal(session) {
  const groupedItems = session.groupedItems || {};
  const modal = new ModalBuilder()
    .setCustomId(GROUPED_QUANTITIES_MODAL_ID)
    .setTitle('Nova Encomenda - Quantidades');

  modal.addComponents(...GROUPED_ORDER_ITEMS.map((item) => {
    const current = groupedItems[item.key] || {};
    return row(new TextInputBuilder()
      .setCustomId(groupedQuantityFieldId(item))
      .setLabel(`Quantidade ${item.label}`)
      .setPlaceholder('Ex: 100')
      .setValue(current.quantity ? String(current.quantity).slice(0, 12) : '')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(12));
  }));

  return modal;
}

function buildGroupedValuesModal(session) {
  const groupedItems = session.groupedItems || {};
  const currency = resolveCurrency(session.currency);
  const labelSuffix = currency === 'USD' ? '$' : 'R$';
  const modal = new ModalBuilder()
    .setCustomId(GROUPED_VALUES_MODAL_ID)
    .setTitle(`Nova Encomenda - Valores ${currency}`);

  modal.addComponents(...GROUPED_ORDER_ITEMS.map((item) => {
    const current = groupedItems[item.key] || {};
    return row(new TextInputBuilder()
      .setCustomId(groupedValueFieldId(item))
      .setLabel(`Valor Total ${item.label}`)
      .setPlaceholder(`Ex: ${labelSuffix}50000`)
      .setValue(current.valueCents ? String(moneyFromCents(current.valueCents)).slice(0, 18) : '')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(18));
  }));

  return modal;
}

function buildGroupedItemsModal(session) {
  return buildGroupedQuantitiesModal(session);
}

async function showGroupedConfirmation(interaction) {
  const session = getSession(interaction);
  const lines = groupedOrderLines(session);
  if (!session.familyId || !lines.length) return showGroupedOrderForm(interaction);
  if (session.couponMode === 'yes' && !session.couponId) return showGroupedOrderForm(interaction);

  const embed = new EmbedBuilder()
    .setColor('#22C55E')
    .setTitle('Resumo da Encomenda')
    .setDescription(groupedOrderSummary(session));

  return respondPanel(interaction, buildPayload('orders', embed, [
    row(
      button('order_grouped_confirm', 'Confirmar Encomenda', ButtonStyle.Success, { emoji: '\u{2705}' }),
      button('order_grouped_back', 'Voltar', ButtonStyle.Secondary),
      button('order_cancel_session', 'Cancelar', ButtonStyle.Danger, { emoji: '\u{274C}' }),
    ),
  ]), true);
}

async function showOrderBuilder(interaction) {
  const session = getSession(interaction);
  const [families, munitions, allProducts, coupons] = await Promise.all([
    listFamilies(session.guildId),
    listInventory(session.guildId, 'munitions'),
    listInventory(session.guildId),
    listCoupons(session.guildId, session.familyId),
  ]);
  const products = munitions.length ? munitions : allProducts;

  if (!families.length || !products.length) {
    return respondPanel(interaction, buildPayload('orders', new EmbedBuilder()
      .setColor('#F59E0B')
      .setTitle('Encomendas indisponiveis')
      .setDescription([
        !families.length ? 'Cadastre pelo menos uma familia ativa.' : null,
        !products.length ? 'Cadastre pelo menos uma municao/produto ativo.' : null,
      ].filter(Boolean).join('\n')),
    [row(linkButton(`${ORDER_DASHBOARD_URL}/dashboard/orders`, 'Abrir Painel Web'))]), true);
  }

  const familySelect = new StringSelectMenuBuilder()
    .setCustomId('order_select_family')
    .setPlaceholder('Familia')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(families.slice(0, 25).map((family) => ({
      label: String(family.name || 'Familia').slice(0, 100),
      value: String(family._id),
      description: String(family.leader_name || 'Sem lider').slice(0, 100),
      default: String(family._id) === String(session.familyId || ''),
    })));

  const currencySelect = new StringSelectMenuBuilder()
    .setCustomId('order_select_currency')
    .setPlaceholder('Moeda')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(CURRENCY_OPTIONS.map((item) => ({
      ...item,
      default: item.value === resolveCurrency(session.currency),
    })));

  const productSelect = new StringSelectMenuBuilder()
    .setCustomId('order_select_product')
    .setPlaceholder('Tipo de Municao')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(products.slice(0, 25).map((item) => ({
      label: String(item.name || 'Municao').slice(0, 100),
      value: String(item._id),
      description: `${Number(item.package_quantity || 1)} por pacote | BRL ${moneyFromCents(inventoryPrice(item, 'BRL'))} | USD ${moneyFromCents(inventoryPrice(item, 'USD'))}`.slice(0, 100),
      default: String(item._id) === String(session.productId || ''),
    })));

  const couponOptions = [
    {
      label: 'Sem desconto',
      value: 'none',
      description: 'Nao aplicar cupom',
      default: !session.couponId,
    },
    ...coupons.slice(0, 24).map((coupon) => ({
      label: String(coupon.code || coupon.name || 'Cupom').slice(0, 100),
      value: String(coupon._id),
      description: `${Number(coupon.percentage || 0)}% de desconto`.slice(0, 100),
      default: String(coupon._id) === String(session.couponId || ''),
    })),
  ];
  const couponSelect = new StringSelectMenuBuilder()
    .setCustomId('order_select_coupon')
    .setPlaceholder('Cupom de Desconto')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(couponOptions);

  const totals = orderPreviewTotals(session);
  const embed = new EmbedBuilder()
    .setColor('#0EA5E9')
    .setTitle(`${ORDER_PANEL_EMOJI} Fazer Encomenda`)
    .setDescription([
      `**Familia:** ${session.familyName || 'Selecione'}`,
      `**Lider:** ${session.familyLeaderName || 'N/A'}`,
      `**Moeda:** ${currencyLabel(session.currency)}`,
      `**Municao:** ${session.productName || 'Selecione'}`,
      `**Quantidade:** ${Number(session.quantity || 0).toLocaleString('pt-BR')}`,
      `**Cupom:** ${session.couponCode || 'Sem desconto'}`,
      '',
      `**Valor Bruto:** ${formatOrderMoney(totals.gross, session.currency)}`,
      `**Desconto:** ${formatOrderMoney(totals.discount, session.currency)}`,
      `**Valor Final:** ${formatOrderMoney(totals.final, session.currency)}`,
    ].join('\n'));

  return respondPanel(interaction, buildPayload('orders', embed, [
    row(familySelect),
    row(currencySelect),
    row(productSelect),
    row(couponSelect),
    row(
      button('order_set_quantity', 'Quantidade', ButtonStyle.Secondary),
      button('order_finalize', 'Finalizar Encomenda', ButtonStyle.Success, { disabled: !session.familyId || !session.productId || !session.quantity }),
      button('order_cancel_session', 'Cancelar', ButtonStyle.Danger),
    ),
  ]), true);
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

function buildOrderQuantityModal(session) {
  return new ModalBuilder()
    .setCustomId('modal_order_v2_quantity')
    .setTitle('Quantidade da encomenda')
    .addComponents(
      row(new TextInputBuilder()
        .setCustomId('quantity')
        .setLabel('Quantidade')
        .setPlaceholder('Ex: 100')
        .setValue(session?.quantity ? String(session.quantity).slice(0, 12) : '')
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
        .setCustomId(FAMILY_MUNITION_PRICES_FIELD)
        .setLabel('Valor unidade muni')
        .setPlaceholder('HK/MAG=500; TEC/FIVE=500; MTAR/MP7=500')
        .setValue(formatFamilyPriceInput(family).slice(0, 200))
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(200)),
      row(new TextInputBuilder()
        .setCustomId(FAMILY_DEFAULT_DISCOUNT_FIELD)
        .setLabel('Desconto padrao (%)')
        .setPlaceholder('Ex: 10')
        .setValue(String(familyDefaultDiscountPercentage(family) || '').slice(0, 8))
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(8)),
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

async function finalizeGroupedOrder(interaction, useEditReply = false) {
  const session = getSession(interaction);
  const lines = groupedOrderLines(session);
  if (!session.familyId || !lines.length) {
    return safeEdit(interaction, { content: 'Selecione familia e preencha pelo menos um produto antes de confirmar.' });
  }
  if (session.discountSource === 'coupon' && !session.couponId) {
    return safeEdit(interaction, { content: 'Selecione o cupom ou marque Cupom: Nao antes de confirmar.' });
  }

  const familyId = objectId(session.familyId);
  const family = familyId ? await getCollection('order_families').findOne({ _id: familyId, guild_id: session.guildId, active: true }) : null;
  if (!family) return safeEdit(interaction, { content: 'Familia ativa nao encontrada.' });

  let coupon = null;
  if (session.discountSource === 'coupon' && session.couponId) {
    const couponId = objectId(session.couponId);
    coupon = couponId ? await getCollection('order_coupons').findOne({ _id: couponId, guild_id: session.guildId, active: true }) : null;
    if (!coupon) return safeEdit(interaction, { content: 'Cupom nao encontrado ou inativo.' });
    if (coupon.expires_at && new Date(coupon.expires_at).getTime() < Date.now()) return safeEdit(interaction, { content: 'Cupom expirado.' });
    if (coupon.usage_limit && Number(coupon.used_count || 0) >= Number(coupon.usage_limit)) return safeEdit(interaction, { content: 'Cupom atingiu o limite de usos.' });
    const familyIds = Array.isArray(coupon.family_ids) ? coupon.family_ids.map(String) : [];
    if (familyIds.length && !familyIds.includes(String(family._id))) return safeEdit(interaction, { content: 'Cupom nao liberado para esta familia.' });
    session.couponCode = coupon.code || coupon.name || '';
    session.couponPercentage = Number(coupon.percentage || 0);
  } else if (session.discountSource !== 'family') {
    session.couponId = '';
    session.couponCode = '';
    session.couponPercentage = 0;
    session.discountSource = 'none';
  }

  if (!coupon && session.discountSource === 'family') {
    const defaultDiscount = familyDefaultDiscountPercentage(family);
    session.couponId = '';
    session.couponCode = '';
    session.couponPercentage = defaultDiscount;
    session.discountSource = defaultDiscount > 0 ? 'family' : 'none';
  }

  const currency = resolveCurrency(session.currency);
  const totals = groupedOrderTotals(session);
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
    family_leader_name: family.leader_name || null,
    responsible_id: actor.id,
    responsible_name: actor.name,
    responsible_mention: `<@${actor.id}>`,
    subject: session.subject || null,
    items: lines.map((line) => ({
      inventory_item_id: null,
      name: line.label,
      emoji: line.emoji,
      category: 'munitions',
      package_quantity: 1,
      quantity: Number(line.quantity || 0),
      unit_price_cents: line.quantity ? Math.round(Number(line.valueCents || 0) / Number(line.quantity || 1)) : Number(line.valueCents || 0),
      total_value_cents: Number(line.valueCents || 0),
    })),
    currency,
    subtotal_value_cents: totals.subtotal,
    discount_value_cents: totals.discount,
    final_value_cents: totals.final,
    coupon_id: coupon?._id ? String(coupon._id) : null,
    coupon_code: coupon?.code || null,
    coupon_percentage: Number(session.couponPercentage || 0),
    discount_source: session.discountSource || (coupon ? 'coupon' : 'none'),
    total_value_cents: totals.final,
    status: 'pending',
    stock_applied: false,
    stock_restored: false,
    approval_channel_id: family.order_channel_id || settings?.order_channel_id || null,
    approval_message_id: null,
    responsible_role_id: family.responsible_role_id || null,
    created_by_id: actor.id,
    created_by_name: actor.name,
    source: 'discord',
    created_at: now,
    updated_at: now,
  };

  await getCollection('orders').insertOne(order);
  if (coupon?._id) {
    await getCollection('order_coupons').updateOne(
      { _id: coupon._id, guild_id: session.guildId },
      { $inc: { used_count: 1 }, $set: { updated_at: now } },
    );
  }

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
    details: {
      source: 'discord',
      currency,
      subject: session.subject || null,
      items: order.items.length,
      subtotalValue: moneyFromCents(totals.subtotal),
      couponInput: session.couponInput || null,
      coupon: coupon?.code || null,
      discountSource: session.discountSource || 'none',
      discountValue: moneyFromCents(totals.discount),
      totalValue: moneyFromCents(totals.final),
    },
    created_at: now,
  }, family, settings);

  orderSessions.delete(sessionKey(interaction));
  const payload = buildPayload('orders', new EmbedBuilder()
    .setColor('#22C55E')
    .setTitle(`Encomenda #${order.order_number} criada`)
    .setDescription([
      `Familia: **${order.family_name}**`,
      session.subject ? `Assunto: **${String(session.subject).slice(0, 120)}**` : null,
      `Moeda: **${currencyLabel(currency)}**`,
      `Total final: **${formatOrderMoney(totals.final, currency)}**`,
      order.approval_channel_id ? `Canal de envio: <#${order.approval_channel_id}>` : 'Canal de envio nao configurado.',
    ].filter(Boolean).join('\n')),
  [row(button('order_start', 'Nova Encomenda', ButtonStyle.Primary, { emoji: '\u{2795}' }), linkButton(`${ORDER_DASHBOARD_URL}/dashboard/orders`, 'Abrir Painel Web'))]);
  return useEditReply ? safeEdit(interaction, payload) : respondPanel(interaction, payload, true);
}

async function finalizeOrder(interaction) {
  const session = getSession(interaction);
  if (session.productId) {
    if (!session.familyId || !session.productId || !session.quantity) {
      return safeEdit(interaction, { content: 'Selecione familia, municao e quantidade antes de finalizar.' });
    }

    const familyId = objectId(session.familyId);
    const productId = objectId(session.productId);
    const [family, product] = await Promise.all([
      familyId ? getCollection('order_families').findOne({ _id: familyId, guild_id: session.guildId, active: true }) : null,
      productId ? getCollection('order_inventory').findOne({ _id: productId, guild_id: session.guildId, active: true }) : null,
    ]);
    if (!family) return safeEdit(interaction, { content: 'Familia ativa nao encontrada.' });
    if (!product) return safeEdit(interaction, { content: 'Municao ativa nao encontrada.' });

    let coupon = null;
    if (session.couponId) {
      const couponId = objectId(session.couponId);
      coupon = couponId ? await getCollection('order_coupons').findOne({ _id: couponId, guild_id: session.guildId, active: true }) : null;
      if (!coupon) return safeEdit(interaction, { content: 'Cupom nao encontrado ou inativo.' });
      if (coupon.expires_at && new Date(coupon.expires_at).getTime() < Date.now()) return safeEdit(interaction, { content: 'Cupom expirado.' });
      const familyIds = Array.isArray(coupon.family_ids) ? coupon.family_ids.map(String) : [];
      if (familyIds.length && !familyIds.includes(String(family._id))) return safeEdit(interaction, { content: 'Cupom nao liberado para esta familia.' });
    }

    const currency = resolveCurrency(session.currency);
    const unitPriceCents = inventoryPrice(product, currency);
    const quantity = Math.max(1, Number(session.quantity || 1));
    const subtotal = unitPriceCents * quantity;
    const couponPercentage = coupon
      ? Math.max(0, Math.min(100, Number(coupon.percentage || 0)))
      : session.discountSource === 'family'
        ? familyDefaultDiscountPercentage(family)
        : 0;
    const discount = Math.round(subtotal * (couponPercentage / 100));
    const final = Math.max(0, subtotal - discount);
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
      family_leader_name: family.leader_name || null,
      responsible_id: actor.id,
      responsible_name: actor.name,
      items: [{
        inventory_item_id: String(product._id),
        name: product.name,
        category: product.category || 'munitions',
        package_quantity: Number(product.package_quantity || 1),
        quantity,
        unit_price_cents: unitPriceCents,
        unit_price_brl_cents: inventoryPrice(product, 'BRL'),
        unit_price_usd_cents: inventoryPrice(product, 'USD'),
        total_value_cents: subtotal,
      }],
      currency,
      subtotal_value_cents: subtotal,
      discount_value_cents: discount,
      final_value_cents: final,
      coupon_id: coupon?._id ? String(coupon._id) : null,
      coupon_code: coupon?.code || null,
      coupon_percentage: couponPercentage,
      discount_source: coupon ? 'coupon' : (couponPercentage > 0 ? 'family' : 'none'),
      total_value_cents: final,
      status: 'pending',
      stock_applied: false,
      stock_restored: false,
      approval_channel_id: family.order_channel_id || settings?.order_channel_id || null,
      approval_message_id: null,
      created_by_id: actor.id,
      created_by_name: actor.name,
      source: 'discord',
      created_at: now,
      updated_at: now,
    };

    await getCollection('orders').insertOne(order);
    if (coupon?._id) {
      await getCollection('order_coupons').updateOne(
        { _id: coupon._id, guild_id: session.guildId },
        { $inc: { used_count: 1 }, $set: { updated_at: now } },
      );
    }
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
      details: {
        source: 'discord',
        product: product.name,
        quantity,
        currency,
        subtotalValue: moneyFromCents(subtotal),
        coupon: coupon?.code || null,
        discountValue: moneyFromCents(discount),
        totalValue: moneyFromCents(final),
      },
      created_at: now,
    }, family, settings);

    orderSessions.delete(sessionKey(interaction));
    return respondPanel(interaction, buildPayload('orders', new EmbedBuilder()
      .setColor('#22C55E')
      .setTitle(`Encomenda #${order.order_number} criada`)
      .setDescription([
        `Familia: **${order.family_name}**`,
        `Produto: **${product.name}**`,
        `Quantidade: **${quantity.toLocaleString('pt-BR')}**`,
        `Moeda: **${currencyLabel(currency)}**`,
        `Valor Bruto: **${formatOrderMoney(subtotal, currency)}**`,
        `Cupom/Desconto: **${coupon?.code || (couponPercentage > 0 ? `Desconto da familia (${couponPercentage}%)` : 'Sem desconto')}**`,
        `Desconto: **${formatOrderMoney(discount, currency)}**`,
        `Valor Final: **${formatOrderMoney(final, currency)}**`,
        order.approval_channel_id ? `Canal de registro: <#${order.approval_channel_id}>` : 'Canal de registro nao configurado no painel web.',
      ].join('\n')),
    [row(button('order_start', 'Nova Encomenda', ButtonStyle.Primary, { emoji: ORDER_PANEL_EMOJI }), linkButton(`${ORDER_DASHBOARD_URL}/dashboard/orders`, 'Abrir Painel Web'))]), true);
  }

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
    approval_channel_id: family.order_channel_id || settings?.order_channel_id || null,
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
      `Valor un. muni: **${formatFamilyPricesShort(selected)}**`,
      `Desconto padrao: **${familyDefaultDiscountPercentage(selected)}%**`,
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
    return safeReply(interaction, { content: 'MongoDB nao esta conectado. O Sistema de Encomendas Vortex nao salva dados locais.', ephemeral: true });
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
      familyLeaderName: '',
      familyOrderChannelId: '',
      familyResponsibleRoleId: '',
      mode: 'grouped',
      currency: 'BRL',
      currencySelected: true,
      productId: '',
      productName: '',
      quantity: 0,
      couponMode: 'no',
      couponId: '',
      couponCode: '',
      couponPercentage: 0,
      discountSource: 'none',
      familyDiscountPercentage: 0,
      subject: '',
      couponInput: '',
      groupedItems: emptyGroupedItems(),
      category: '',
      cart: [],
    });
    return showOrderTicketModal(interaction);
  }

  if (interaction.customId === 'order_currency_USD' || interaction.customId === 'order_currency_BRL') {
    const session = getSession(interaction);
    session.mode = 'grouped';
    session.currency = interaction.customId.endsWith('USD') ? 'USD' : 'BRL';
    session.currencySelected = true;
    return showGroupedOrderForm(interaction);
  }

  if (interaction.customId === 'order_publish_public_panel') {
    if (!hasOrderManagerPermission(interaction.member)) return safeReply(interaction, { content: 'Sem permissao.', ephemeral: true });
    await interaction.channel?.send(buildOrderPanelPayload(interaction)).catch(() => null);
    return safeReply(interaction, { content: 'Painel publico de encomendas publicado neste canal.', ephemeral: true });
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
  if (interaction.customId === 'order_coupon_yes') {
    const session = getSession(interaction);
    session.couponMode = 'yes';
    session.discountSource = 'coupon';
    session.couponId = '';
    session.couponCode = '';
    session.couponPercentage = 0;
    return showGroupedOrderForm(interaction);
  }
  if (interaction.customId === 'order_coupon_no') {
    const session = getSession(interaction);
    if (session.familyId) {
      const familyId = objectId(session.familyId);
      const family = familyId ? await getCollection('order_families').findOne({ _id: familyId, guild_id: session.guildId, active: true }) : null;
      if (family) applyFamilyDefaultDiscount(session, family);
    } else {
      session.couponMode = 'no';
      session.couponId = '';
      session.couponCode = '';
      session.couponPercentage = 0;
      session.discountSource = 'none';
    }
    return showGroupedOrderForm(interaction);
  }
  if (interaction.customId === 'order_grouped_items') {
    const session = getSession(interaction);
    if (!session.currencySelected) return showCurrencySelection(interaction);
    return safeShowModal(interaction, buildGroupedItemsModal(session));
  }
  if (interaction.customId === 'order_grouped_review') return showGroupedConfirmation(interaction);
  if (interaction.customId === 'order_grouped_back') return showGroupedOrderForm(interaction);
  if (interaction.customId === 'order_grouped_confirm') {
    await safeDeferReply(interaction, { ephemeral: true });
    return finalizeGroupedOrder(interaction);
  }
  if (interaction.customId === 'order_set_quantity') {
    const session = getSession(interaction);
    if (!session.productId) return safeReply(interaction, { content: 'Selecione uma municao antes de informar a quantidade.', ephemeral: true });
    return safeShowModal(interaction, buildOrderQuantityModal(session));
  }
  if (interaction.customId === 'order_cancel_session') {
    orderSessions.delete(sessionKey(interaction));
    return respondPanel(interaction, buildPayload('orders', new EmbedBuilder()
      .setColor('#64748B')
      .setTitle('Encomenda cancelada')
      .setDescription('A encomenda atual foi descartada.'),
    [row(button('order_start', 'Nova Encomenda', ButtonStyle.Primary, { emoji: '\u{2795}' }))]), true);
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
    return safeReply(interaction, { content: 'MongoDB nao esta conectado. O Sistema de Encomendas Vortex nao salva dados locais.', ephemeral: true });
  }

  if (interaction.customId === 'order_select_family') {
    const session = getSession(interaction);
    const id = objectId(interaction.values[0]);
    const family = id ? await getCollection('order_families').findOne({ _id: id, guild_id: session.guildId, active: true }) : null;
    if (!family) return safeReply(interaction, { content: 'Familia nao encontrada.', ephemeral: true });
    session.familyId = String(family._id);
    session.familyName = family.name;
    session.familyLeaderName = family.leader_name || '';
    session.familyOrderChannelId = family.order_channel_id || '';
    session.familyResponsibleRoleId = family.responsible_role_id || '';
    applyFamilyDefaultDiscount(session, family);
    if (session.mode === 'grouped') return showGroupedOrderForm(interaction);
    return showOrderBuilder(interaction);
  }

  if (interaction.customId === 'order_select_currency') {
    const session = getSession(interaction);
    session.currency = resolveCurrency(interaction.values[0]);
    if (session.productId) {
      const id = objectId(session.productId);
      const item = id ? await getCollection('order_inventory').findOne({ _id: id, guild_id: session.guildId, active: true }) : null;
      if (item) session.unitPriceCents = inventoryPrice(item, session.currency);
    }
    return showOrderBuilder(interaction);
  }

  if (interaction.customId === 'order_select_product') {
    const session = getSession(interaction);
    const id = objectId(interaction.values[0]);
    const item = id ? await getCollection('order_inventory').findOne({ _id: id, guild_id: session.guildId, active: true }) : null;
    if (!item) return safeReply(interaction, { content: 'Municao nao encontrada.', ephemeral: true });
    session.productId = String(item._id);
    session.productName = item.name;
    session.productCategory = item.category || 'munitions';
    session.packageQuantity = Number(item.package_quantity || 1);
    session.unitPriceCents = inventoryPrice(item, session.currency);
    session.unitPriceBrlCents = inventoryPrice(item, 'BRL');
    session.unitPriceUsdCents = inventoryPrice(item, 'USD');
    return showOrderBuilder(interaction);
  }

  if (interaction.customId === 'order_select_coupon') {
    const session = getSession(interaction);
    const value = String(interaction.values[0] || '');
    if (value === 'none') {
      if (session.familyId) {
        const familyId = objectId(session.familyId);
        const family = familyId ? await getCollection('order_families').findOne({ _id: familyId, guild_id: session.guildId, active: true }) : null;
        if (family) applyFamilyDefaultDiscount(session, family);
      } else {
        session.couponId = '';
        session.couponCode = '';
        session.couponPercentage = 0;
        session.discountSource = 'none';
      }
      return session.mode === 'grouped' ? showGroupedOrderForm(interaction) : showOrderBuilder(interaction);
    }
    const id = objectId(value);
    const coupon = id ? await getCollection('order_coupons').findOne({ _id: id, guild_id: session.guildId, active: true }) : null;
    if (!coupon) return safeReply(interaction, { content: 'Cupom nao encontrado.', ephemeral: true });
    const familyIds = Array.isArray(coupon.family_ids) ? coupon.family_ids.map(String) : [];
    if (familyIds.length && !familyIds.includes(String(session.familyId || ''))) {
      return safeReply(interaction, { content: 'Cupom nao liberado para esta familia.', ephemeral: true });
    }
    if (coupon.usage_limit && Number(coupon.used_count || 0) >= Number(coupon.usage_limit)) {
      return safeReply(interaction, { content: 'Cupom atingiu o limite de usos.', ephemeral: true });
    }
    if (coupon.expires_at && new Date(coupon.expires_at).getTime() < Date.now()) {
      return safeReply(interaction, { content: 'Cupom expirado.', ephemeral: true });
    }
    session.couponId = String(coupon._id);
    session.couponCode = coupon.code || coupon.name;
    session.couponPercentage = Number(coupon.percentage || 0);
    session.discountSource = 'coupon';
    return session.mode === 'grouped' ? showGroupedOrderForm(interaction) : showOrderBuilder(interaction);
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

async function resolveOrderTicketSetup(interaction, {
  familyInput,
  couponInput,
  currency,
}) {
  if (!hasOrderUserPermission(interaction.member)) {
    return { ok: false, message: 'Voce nao tem permissao para fazer encomendas.' };
  }

  const guildId = getGuildId(interaction);
  const family = await resolveOrderTicketFamily(guildId, familyInput);
  if (!family) return { ok: false, message: 'Categoria/familia de encomenda nao encontrada.' };

  const session = getSession(interaction);
  session.familyId = String(family._id);
  session.familyName = family.name;
  session.familyLeaderName = family.leader_name || '';
  session.familyOrderChannelId = family.order_channel_id || '';
  session.familyResponsibleRoleId = family.responsible_role_id || '';
  session.mode = 'grouped';
  session.currency = resolveCurrency(currency);
  session.currencySelected = true;
  session.subject = '';
  session.couponInput = String(couponInput || '').trim();

  if (session.couponInput) {
    const coupon = await findCouponByCode(session.guildId, session.familyId, session.couponInput);
    if (!coupon) {
      return { ok: false, message: `Cupom \`${session.couponInput.slice(0, 60)}\` nao encontrado ou nao liberado para esta familia.` };
    }
    session.couponMode = 'yes';
    session.couponId = String(coupon._id);
    session.couponCode = coupon.code || coupon.name || session.couponInput;
    session.couponPercentage = Number(coupon.percentage || 0);
    session.discountSource = 'coupon';
  } else {
    applyFamilyDefaultDiscount(session, family);
  }

  return { ok: true, session, family };
}

async function submitOrderTicketModal(interaction, {
  familyInput,
  subject,
  couponInput,
  currency,
}) {
  await safeDeferReply(interaction, { ephemeral: true });

  const setup = await resolveOrderTicketSetup(interaction, { familyInput, couponInput, currency });
  if (!setup.ok) return safeEdit(interaction, { content: setup.message });
  const { session, family } = setup;

  const groupedItems = parseOrderTicketSubject(subject);
  const missingPrices = applyFamilyPricesToGroupedItems(groupedItems, family);
  const parsedLines = groupedOrderLines({ groupedItems });
  if (!parsedLines.length) {
    return safeEdit(interaction, {
      content: [
        'Informe pelo menos um produto no assunto e cadastre o valor unitario da muni na familia.',
        'Modelo com valor automatico: `HK/MAG 100; TEC/FIVE 50; MTAR/MP7 25`',
        'Ou informe valor manual: `HK/MAG 100 | R$ 50000`',
      ].join('\n'),
    });
  }
  if (missingPrices.length) {
    return safeEdit(interaction, {
      content: `Cadastre o valor unitario de ${missingPrices.join(', ')} nessa familia ou informe o valor manual no assunto.`,
    });
  }

  session.subject = String(subject || '').trim();
  session.groupedItems = groupedItems;

  return finalizeGroupedOrder(interaction, true);
}

async function handleOrderModal(interaction) {
  if (!isMongoReady()) {
    return safeReply(interaction, { content: 'MongoDB nao esta conectado. O Sistema de Encomendas Vortex nao salva dados locais.', ephemeral: true });
  }

  if (interaction.customId === ORDER_TICKET_MODAL_ID) {
    const setup = await resolveOrderTicketSetup(interaction, {
      familyInput: String(interaction.fields.getStringSelectValues(ORDER_TICKET_FAMILY_FIELD)?.[0] || ''),
      couponInput: modalTextValue(interaction.fields, ORDER_TICKET_COUPON_FIELD),
      currency: interaction.fields.getRadioGroup(ORDER_TICKET_CURRENCY_FIELD, true),
    });
    if (!setup.ok) return safeReply(interaction, { content: setup.message, ephemeral: true });
    return safeShowModal(interaction, buildGroupedQuantitiesModal(setup.session));
  }

  if (interaction.customId === ORDER_TICKET_TEXT_MODAL_ID) {
    return submitOrderTicketModal(interaction, {
      familyInput: interaction.fields.getTextInputValue(ORDER_TICKET_FAMILY_TEXT_FIELD).trim(),
      subject: interaction.fields.getTextInputValue(ORDER_TICKET_SUBJECT_FIELD).trim(),
      couponInput: interaction.fields.getTextInputValue(ORDER_TICKET_COUPON_FIELD).trim(),
      currency: interaction.fields.getTextInputValue(ORDER_TICKET_CURRENCY_TEXT_FIELD).trim(),
    });
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

  if (interaction.customId === 'modal_order_v2_quantity') {
    await safeDeferReply(interaction, { ephemeral: true });
    const session = getSession(interaction);
    const quantity = parsePositiveInt(interaction.fields.getTextInputValue('quantity'));
    if (!session.productId) return safeEdit(interaction, { content: 'Selecione uma municao antes de informar a quantidade.' });
    if (!quantity) return safeEdit(interaction, { content: 'Informe uma quantidade maior que zero.' });
    session.quantity = quantity;
    return showOrderBuilder(interaction);
  }

  if (interaction.customId === 'modal_order_grouped_items') {
    await safeDeferReply(interaction, { ephemeral: true });
    const session = getSession(interaction);
    session.groupedItems = session.groupedItems || emptyGroupedItems();
    for (const item of GROUPED_ORDER_ITEMS) {
      const parsed = parseGroupedProductInput(interaction.fields.getTextInputValue(item.key));
      session.groupedItems[item.key] = {
        key: item.key,
        label: item.label,
        emoji: item.emoji,
        quantity: parsed.quantity,
        valueCents: parsed.valueCents,
      };
    }
    if (session.familyId) {
      const familyId = objectId(session.familyId);
      const family = familyId ? await getCollection('order_families').findOne({ _id: familyId, guild_id: session.guildId, active: true }) : null;
      if (family) applyFamilyPricesToGroupedItems(session.groupedItems, family);
    }
    if (!groupedOrderLines(session).length) {
      return safeEdit(interaction, { content: 'Preencha pelo menos um produto com quantidade e valor maior que zero, ou cadastre o valor unitario da muni na familia.' });
    }
    session.subject = groupedOrderSubject(session);
    return showGroupedConfirmation(interaction);
  }

  if (interaction.customId === GROUPED_QUANTITIES_MODAL_ID) {
    const session = getSession(interaction);
    const totalQuantity = applyGroupedQuantityFields(session, interaction.fields);
    if (!totalQuantity) {
      return safeReply(interaction, { content: 'Preencha pelo menos uma quantidade maior que zero.', ephemeral: true });
    }
    return safeShowModal(interaction, buildGroupedValuesModal(session));
  }

  if (interaction.customId === GROUPED_VALUES_MODAL_ID) {
    await safeDeferReply(interaction, { ephemeral: true });
    const session = getSession(interaction);
    const fieldErrors = applyGroupedValueFields(session, interaction.fields);
    if (fieldErrors.length) {
      return safeEdit(interaction, { content: `Revise estes campos: ${fieldErrors.join(', ')}.` });
    }

    let missingPrices = [];
    if (session.familyId) {
      const familyId = objectId(session.familyId);
      const family = familyId ? await getCollection('order_families').findOne({ _id: familyId, guild_id: session.guildId, active: true }) : null;
      if (family) missingPrices = applyFamilyPricesToGroupedItems(session.groupedItems, family);
    }
    if (missingPrices.length) {
      return safeEdit(interaction, { content: `Informe o Valor Total de ${missingPrices.join(', ')} ou cadastre o valor unitario na familia.` });
    }
    if (!groupedOrderLines(session).length) {
      return safeEdit(interaction, { content: 'Preencha pelo menos um produto com quantidade e valor maior que zero.' });
    }
    session.subject = groupedOrderSubject(session);
    return showGroupedConfirmation(interaction);
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
    const munitionUnitPrices = parseMunitionUnitPrices(modalTextValue(interaction.fields, FAMILY_MUNITION_PRICES_FIELD));
    const defaultDiscount = parsePercentage(modalTextValue(interaction.fields, FAMILY_DEFAULT_DISCOUNT_FIELD), 0);
    const [leaderIdRaw, ...leaderNameParts] = leaderText.split(/\s*-\s*/);
    const leaderId = /^\d{5,32}$/.test(leaderIdRaw || '') ? leaderIdRaw : '';
    const leaderName = leaderNameParts.join(' - ').trim() || (!leaderId ? leaderText : '');
    const [colorRaw, iconRaw] = visualText.split('|').map((item) => item.trim());
    const color = /^#[0-9a-f]{6}$/i.test(colorRaw || '') ? colorRaw.toUpperCase() : '#0EA5E9';
    const icon = (iconRaw || ORDER_PANEL_EMOJI).slice(0, 32);
    if (!name || name.length < 2) return safeEdit(interaction, { content: 'Informe o nome da familia.' });
    if (defaultDiscount === null) return safeEdit(interaction, { content: 'Informe um desconto entre 0 e 100.' });

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
            munition_unit_prices: munitionUnitPrices,
            default_discount_percentage: defaultDiscount,
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
        details: { source: 'discord', munitionPrices: Object.keys(munitionUnitPrices).length, defaultDiscount },
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
      log_webhook_url: null,
      members: [],
      munition_unit_prices: munitionUnitPrices,
      default_discount_percentage: defaultDiscount,
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
      details: { source: 'discord', munitionPrices: Object.keys(munitionUnitPrices).length, defaultDiscount },
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
  buildOrderAdminPanelPayload,
  buildOrderPanelPayload,
  handleOrderButton,
  handleOrderModal,
  handleOrderSelect,
  hasOrderManagerPermission,
  hasOrderUserPermission,
};
