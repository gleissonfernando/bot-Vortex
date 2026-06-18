const mongoose = require('mongoose');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
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
const { getMasterRoleIds, getMasterUserIds, getVortexRoleIds, hasAnyVortexRole, hasCommandRole, hasVortexAccess } = require('./permissions');
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
const ORDER_WORK_CATEGORY_ID = '1450053400606543965';
const ORDER_LOG_CATEGORY_ID = '1497684838352949319';
const ORDER_LOG_CHANNEL_NAME = 'logs-encomendas';
const ORDER_TICKET_MODAL_ID = 'modal_order_ticket';
const ORDER_TICKET_FAMILY_FIELD = 'order_ticket_family';
const ORDER_TICKET_SUBJECT_FIELD = 'order_ticket_subject';
const ORDER_TICKET_COUPON_FIELD = 'order_ticket_coupon';
const ORDER_TICKET_COUPON_MODE_FIELD = 'order_ticket_coupon_mode';
const ORDER_TICKET_CURRENCY_FIELD = 'order_ticket_currency';
const ORDER_TICKET_DISCOUNT_FIELD = 'desconto_encomenda';
const ORDER_FILL_MUNITIONS_BUTTON = 'order_fill_munitions';
const ORDER_HISTORY_FAMILY_SELECT = 'order_history_family_select';
const ORDER_TICKET_TEXT_MODAL_ID = 'modal_order_ticket_text';
const ORDER_TICKET_FAMILY_TEXT_FIELD = 'order_ticket_family_text';
const ORDER_TICKET_CURRENCY_TEXT_FIELD = 'order_ticket_currency_text';
const GROUPED_QUANTITIES_MODAL_ID = 'modal_order_grouped_quantities';
const GROUPED_VALUES_MODAL_ID = 'modal_order_grouped_values';
const ORDER_EDIT_QUANTITIES_MODAL_ID = 'modal_order_edit_quantities';
const GROUPED_QUANTITY_FIELD_PREFIX = 'grouped_quantity_';
const GROUPED_VALUE_FIELD_PREFIX = 'grouped_value_';
const GROUPED_TOTAL_VALUE_FIELD = 'valor_encomenda';
const FAMILY_MUNITION_PRICES_FIELD = 'munition_prices';
const FAMILY_DEFAULT_DISCOUNT_FIELD = 'default_discount';
const FAMILY_VALUES_MODAL_ID = 'modal_order_family_values';
const ORDER_DISCOUNT_MODAL_ID = 'modal_order_default_discount';
const ORDER_DISCOUNT_PERCENT_FIELD = 'order_default_discount_percent';
const ORDER_MUNITION_MODAL_ID = 'modal_order_munition';
const ORDER_MUNITION_NAME_FIELD = 'order_munition_name';
const ORDER_MUNITION_IDENTIFIER_FIELD = 'order_munition_identifier';
const ORDER_MUNITION_ORDER_FIELD = 'order_munition_order';
const ORDER_MUNITION_ACTIVE_FIELD = 'order_munition_active';
const MODAL_FIELD_PAGE_SIZE = 5;
const ORDER_TICKET_MUNITION_FIELDS = [
  { key: 'hk_mag', customId: 'hk_mag_quantidade', label: 'HK/MAG', placeholder: 'Digite a quantidade', description: 'Quantidade' },
  { key: 'tec_five', customId: 'tec_five_quantidade', label: 'TEC/FIVE', placeholder: 'Digite a quantidade', description: 'Quantidade' },
  { key: 'mtar_mp7', customId: 'mtar_mp7_quantidade', label: 'MTAR/MP7', placeholder: 'Digite a quantidade', description: 'Quantidade' },
];

const orderSessions = new Map();
const familySelections = new Map();
const munitionSelections = new Map();

const ORDER_STATUSES = new Set(['pending', 'separating', 'transport', 'delivered', 'cancelled']);
const CURRENCY_OPTIONS = [
  { label: 'Real (BRL)', value: 'BRL', description: 'Calcular em reais', emoji: '\u{1F4B8}' },
  { label: 'Dolar (USD)', value: 'USD', description: 'Calcular em dolar', emoji: '\u{1F4B5}' },
];
const DEFAULT_MUNITIONS = [
  { key: 'hk_mag', label: 'HK/MAG', emoji: '\u{1F52B}', order: 1 },
  { key: 'tec_five', label: 'TEC/FIVE', emoji: '\u{1F52B}', order: 2 },
  { key: 'mtar_mp7', label: 'MTAR/MP7', emoji: '\u{1F52B}', order: 3 },
  { key: 'ak103', label: 'AK103', emoji: '\u{1F52B}', order: 4 },
  { key: 'thompson', label: 'THOMPSON', emoji: '\u{1F52B}', order: 5 },
  { key: 'g36', label: 'G36', emoji: '\u{1F52B}', order: 6 },
  { key: 'fal', label: 'FAL', emoji: '\u{1F52B}', order: 7 },
  { key: 'municao_sniper', label: 'MUNICAO SNIPER', emoji: '\u{1F52B}', order: 8 },
];
const GROUPED_ORDER_ITEMS = DEFAULT_MUNITIONS;
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

function createIdentifier(value) {
  const identifier = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return identifier || `munition_${Date.now()}`;
}

function normalizeMunitionDoc(doc) {
  if (!doc) return null;
  return {
    id: String(doc._id || ''),
    key: String(doc.identificador || doc.identifier || createIdentifier(doc.nome || doc.name || 'munition')),
    label: String(doc.nome || doc.name || 'Municao').slice(0, 100),
    emoji: '\u{1F52B}',
    order: Math.max(1, Number(doc.ordem || doc.order || 1)),
    active: doc.ativo !== false && doc.active !== false,
  };
}

function fallbackMunitions() {
  return DEFAULT_MUNITIONS.map((item) => ({ ...item, id: '', active: true }));
}

function sessionMunitions(session) {
  if (Array.isArray(session?.munitions)) {
    return session.munitions.filter((item) => item?.active !== false);
  }
  return fallbackMunitions();
}

function normalizeMunitionList(rows, useFallback = true) {
  const normalized = (rows || [])
    .map(normalizeMunitionDoc)
    .filter(Boolean)
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0) || String(a.label).localeCompare(String(b.label)));
  return normalized.length ? normalized : (useFallback ? fallbackMunitions() : []);
}

async function ensureDefaultMunitions(guildId) {
  const collection = getCollection('munitions');
  const existing = await collection.countDocuments({ guild_id: guildId });
  if (!existing) {
    const now = new Date();
    await collection.insertMany(DEFAULT_MUNITIONS.map((item) => ({
      _id: new mongoose.Types.ObjectId(),
      guild_id: guildId,
      nome: item.label,
      identificador: item.key,
      ativo: true,
      ordem: item.order,
      created_at: now,
      updated_at: now,
    }))).catch(() => null);
  }
  return collection;
}

async function listMunitions(guildId, includeInactive = false) {
  const collection = await ensureDefaultMunitions(guildId);
  const filter = { guild_id: guildId };
  if (!includeInactive) filter.ativo = true;
  const rows = await collection
    .find(filter)
    .sort({ ativo: -1, ordem: 1, nome: 1 })
    .limit(100)
    .toArray();
  return normalizeMunitionList(rows, false);
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

function parseOptionalQuantityInput(value) {
  const raw = String(value || '').trim();
  if (!raw) return { ok: true, value: 0 };
  if (!/^\d+$/.test(raw)) return { ok: false, value: 0 };
  const number = Number(raw);
  if (!Number.isSafeInteger(number) || number <= 0) return { ok: false, value: 0 };
  return { ok: true, value: number };
}

function parseRequiredMoneyInput(value) {
  const raw = String(value || '').trim();
  if (!raw) return { ok: false, valueCents: 0 };
  const parsed = parseMoney(raw, null);
  if (parsed === null || parsed <= 0) return { ok: false, valueCents: 0 };
  return { ok: true, valueCents: cents(parsed) };
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

function calculateLineTotalCents(quantity, unitPriceCents) {
  const parsedQuantity = Math.max(0, Math.floor(Number(quantity || 0)));
  const parsedUnit = Math.max(0, Math.round(Number(unitPriceCents || 0)));
  return parsedQuantity * parsedUnit;
}

function calculateDiscountCents(subtotalCents, percentage) {
  const subtotal = Math.max(0, Math.round(Number(subtotalCents || 0)));
  const percent = clampPercentage(percentage) ?? 0;
  return Math.round(subtotal * (percent / 100));
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

function formatManualOrderMoney(valueCents, currency = 'BRL') {
  const value = moneyFromCents(valueCents);
  const resolved = resolveCurrency(currency);
  const formatted = new Intl.NumberFormat(resolved === 'USD' ? 'en-US' : 'pt-BR', {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  }).format(value);
  return resolved === 'USD' ? `$${formatted}` : `R$ ${formatted}`;
}

function inventoryPrice(item, currency = 'BRL') {
  const fallback = Number(item?.unit_price_cents || 0);
  return resolveCurrency(currency) === 'USD'
    ? Number(item?.price_usd_cents ?? fallback)
    : Number(item?.price_brl_cents ?? fallback);
}

function emptyGroupedItems(munitions = GROUPED_ORDER_ITEMS) {
  return Object.fromEntries(munitions.map((item) => [item.key, {
    key: item.key,
    label: item.label,
    emoji: item.emoji,
    munition_id: item.id || null,
    quantity: 0,
    unitPriceCents: 0,
    valueCents: 0,
  }]));
}

function munitionPriceDescription(session, item, fallback = 'Quantidade') {
  const prices = session?.familyMunitionUnitPrices || {};
  const price = Number(prices?.[item?.key] || 0);
  if (price <= 0) return fallback;
  return `${fallback} | Valor: ${formatOrderMoney(price, resolveCurrency(session?.currency))}`.slice(0, 100);
}

function pruneGroupedItemsForSession(session) {
  if (!session) return;
  const activeKeys = new Set(sessionMunitions(session).map((item) => item.key));
  if (!activeKeys.size) {
    session.groupedItems = {};
    return;
  }
  session.groupedItems = Object.fromEntries(
    Object.entries(session.groupedItems || {}).filter(([key]) => activeKeys.has(key)),
  );
}

function removeMunitionFromActiveSessions(guildId, munition) {
  const key = String(munition?.key || '');
  const id = String(munition?.id || '');
  for (const session of orderSessions.values()) {
    if (String(session.guildId || '') !== String(guildId || '')) continue;
    session.munitions = (session.munitions || []).filter((item) => String(item.key) !== key && String(item.id || '') !== id);
    if (session.groupedItems && key) delete session.groupedItems[key];
    if (session.familyMunitionUnitPrices && key) delete session.familyMunitionUnitPrices[key];
  }
}

function groupedOrderLines(session) {
  pruneGroupedItemsForSession(session);
  const groupedItems = session.groupedItems || {};
  return sessionMunitions(session)
    .map((meta) => ({ ...meta, ...(groupedItems[meta.key] || {}) }))
    .filter((item) => Number(item.quantity || 0) > 0 && Number(item.valueCents || 0) > 0);
}

function groupedOrderTotals(session) {
  const subtotal = groupedOrderLines(session).reduce((total, item) => total + Number(item.valueCents || 0), 0);
  const percent = Math.max(0, Math.min(100, Number(session.couponPercentage || 0)));
  const discount = hasSessionDiscount(session) ? calculateDiscountCents(subtotal, percent) : 0;
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
    ? lines.flatMap((item) => {
      const base = [
        `${item.emoji || '\u{1F52B}'} **${item.label}**`,
        `Quantidade: **${Number(item.quantity || 0).toLocaleString('pt-BR')}**`,
        `Valor Unitario: **${formatOrderMoney(item.unitPriceCents || 0, currency)}**`,
        `Subtotal: **${formatOrderMoney(item.valueCents || 0, currency)}**`,
      ];
      return base;
    }).join('\n')
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
  ].filter(Boolean).join('\n');
}

function parseGroupedProductInput(input) {
  const raw = String(input || '').trim();
  if (!raw) return { quantity: 0, unitPriceCents: 0, valueCents: 0 };
  const explicitParts = raw.split(/[|;]/).map((part) => part.trim()).filter(Boolean);
  const parts = explicitParts.length >= 2 ? explicitParts : (raw.match(/\d[\d.,]*/g) || []);
  const quantity = parsePositiveInt(parts[0] || '0') || 0;
  const unitPrice = parseMoney(parts.slice(1).join(' ') || '0', 0);
  const unitPriceCents = cents(unitPrice || 0);
  return {
    quantity,
    unitPriceCents,
    valueCents: calculateLineTotalCents(quantity, unitPriceCents),
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
  if (item?.customId) return item.customId;
  return `${GROUPED_QUANTITY_FIELD_PREFIX}${item.key}`;
}

function groupedValueFieldId(item) {
  return `${GROUPED_VALUE_FIELD_PREFIX}${item.key}`;
}

function orderTicketMunitionFields(session) {
  const munitions = sessionMunitions(session);
  return munitions.map((munition) => {
    const fixed = ORDER_TICKET_MUNITION_FIELDS.find((field) => field.key === munition.key || normalizeSearchText(field.label) === normalizeSearchText(munition.label));
    return {
      ...munition,
      customId: fixed?.customId || groupedQuantityFieldId(munition),
      placeholder: fixed?.placeholder || 'Digite a quantidade',
      description: fixed?.description || 'Quantidade',
    };
  });
}

function groupedOrderSubject(session) {
  const currency = resolveCurrency(session.currency);
  const lines = groupedOrderLines(session)
    .map((item) => `${item.label} ${Number(item.quantity || 0).toLocaleString('pt-BR')} x ${formatOrderMoney(item.unitPriceCents || 0, currency)} = ${formatOrderMoney(item.valueCents || 0, currency)}`);
  return lines.join('; ');
}

function matchGroupedOrderItem(value, munitions = GROUPED_ORDER_ITEMS) {
  const normalized = normalizeSearchText(value);
  if (!normalized) return null;
  return munitions.find((item) => {
    const label = normalizeSearchText(item.label);
    const key = normalizeSearchText(item.key);
    return normalized.includes(label) || normalized.includes(key) || label.includes(normalized) || key.includes(normalized);
  }) || null;
}

function parseMunitionUnitPrices(value, munitions = GROUPED_ORDER_ITEMS) {
  const result = {};
  const segments = String(value || '')
    .split(/\r?\n|;/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const segment of segments) {
    const meta = matchGroupedOrderItem(segment, munitions);
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

function familyMunitionUnitPrices(family, munitions = GROUPED_ORDER_ITEMS) {
  const source = family?.munition_unit_prices || family?.munition_prices || {};
  return munitions.reduce((prices, item) => {
    prices[item.key] = Math.max(0, Number(source?.[item.key] || 0));
    return prices;
  }, {});
}

function formatFamilyPriceInput(family, munitions = GROUPED_ORDER_ITEMS) {
  const prices = familyMunitionUnitPrices(family, munitions);
  return munitions
    .map((item) => `${item.label}=${moneyFromCents(prices[item.key] || 0)}`)
    .join('; ');
}

function formatFamilyPricesShort(family, currency = 'BRL', munitions = GROUPED_ORDER_ITEMS) {
  const prices = familyMunitionUnitPrices(family, munitions);
  const configured = munitions
    .filter((item) => Number(prices[item.key] || 0) > 0)
    .map((item) => `${item.label}: ${formatOrderMoney(prices[item.key], currency)}`);
  return configured.length ? configured.join(' | ') : 'nao configurado';
}

function familyDefaultDiscountPercentage(family) {
  return clampPercentage(family?.default_discount_percentage ?? family?.default_discount_percent ?? 0) ?? 0;
}

function settingsDefaultDiscountPercentage(settings) {
  return clampPercentage(settings?.default_discount_percentage ?? settings?.order_default_discount_percentage ?? 0) ?? 0;
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

function applyFamilyPricesToGroupedItems(groupedItems, family, munitions = GROUPED_ORDER_ITEMS) {
  const prices = familyMunitionUnitPrices(family, munitions);
  const missing = [];
  for (const item of munitions) {
    const line = groupedItems[item.key];
    if (!line || !Number(line.quantity || 0)) continue;
    if (Number(line.unitPriceCents || 0) > 0) {
      line.valueCents = calculateLineTotalCents(line.quantity, line.unitPriceCents);
      continue;
    }
    const unitPrice = Number(prices[item.key] || 0);
    if (unitPrice > 0) {
      line.unitPriceCents = unitPrice;
      line.valueCents = calculateLineTotalCents(line.quantity, unitPrice);
    } else {
      missing.push(item.label);
    }
  }
  return missing;
}

function parseOrderTicketSubject(subject, munitions = GROUPED_ORDER_ITEMS) {
  const grouped = emptyGroupedItems(munitions);
  const segments = String(subject || '')
    .split(/\r?\n|;/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const segment of segments) {
    const normalized = normalizeSearchText(segment);
    const meta = munitions.find((item) => {
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
      munition_id: meta.id || null,
      quantity: parsed.quantity,
      unitPriceCents: parsed.unitPriceCents,
      valueCents: parsed.valueCents,
    };
  }

  return grouped;
}

function groupedModalPageItems(session, page = 0) {
  const start = Math.max(0, Number(page || 0)) * MODAL_FIELD_PAGE_SIZE;
  return orderTicketMunitionFields(session).slice(start, start + MODAL_FIELD_PAGE_SIZE);
}

function hasGroupedModalNextPage(session, page = 0) {
  return orderTicketMunitionFields(session).length > (Number(page || 0) + 1) * MODAL_FIELD_PAGE_SIZE;
}

function groupedModalPageFromId(customId, prefix) {
  const suffix = String(customId || '').replace(prefix, '').replace(/^[:_-]+/, '');
  const page = Number(suffix || 0);
  return Number.isFinite(page) && page >= 0 ? Math.floor(page) : 0;
}

function applyGroupedQuantityFields(session, fields, page = 0) {
  session.groupedItems = session.groupedItems || emptyGroupedItems(sessionMunitions(session));
  let totalQuantity = 0;
  const errors = [];

  for (const item of groupedModalPageItems(session, page)) {
    const current = session.groupedItems[item.key] || {};
    const parsed = parseOptionalQuantityInput(modalTextValue(fields, groupedQuantityFieldId(item)));
    if (!parsed.ok) errors.push(item.label);
    const quantity = parsed.value;
    session.groupedItems[item.key] = {
      key: item.key,
      label: item.label,
      emoji: item.emoji,
      munition_id: item.id || current.munition_id || null,
      quantity,
      unitPriceCents: quantity ? Number(current.unitPriceCents || 0) : 0,
      valueCents: quantity ? calculateLineTotalCents(quantity, current.unitPriceCents) : 0,
    };
  }
  totalQuantity = Object.values(session.groupedItems || {}).reduce((total, item) => total + Number(item.quantity || 0), 0);

  session.manualTotalValueCents = 0;
  if (session.discountChoice === 'nao') {
    session.couponId = '';
    session.couponCode = '';
    session.couponPercentage = 0;
    session.discountSource = 'none';
  }

  return { totalQuantity, errors };
}

function applyGroupedValueFields(session, fields, page = 0) {
  session.groupedItems = session.groupedItems || emptyGroupedItems(sessionMunitions(session));
  const errors = [];

  for (const item of groupedModalPageItems(session, page)) {
    const current = session.groupedItems[item.key] || {};
    const rawValue = modalTextValue(fields, groupedValueFieldId(item));
    const parsedValue = parseMoney(rawValue, 0);
    const quantity = Number(current.quantity || 0);

    if (parsedValue === null) {
      errors.push(`Valor Unitario ${item.label}`);
      continue;
    }
    if (!quantity && Number(parsedValue || 0) > 0) {
      errors.push(`Quantidade ${item.label}`);
      continue;
    }
    const unitPriceCents = cents(parsedValue || 0);

    session.groupedItems[item.key] = {
      key: item.key,
      label: item.label,
      emoji: item.emoji,
      munition_id: item.id || current.munition_id || null,
      quantity,
      unitPriceCents,
      valueCents: calculateLineTotalCents(quantity, unitPriceCents),
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

function channelSafeName(value) {
  const safe = String(value || 'encomenda')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70);
  return safe || 'encomenda';
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

function getOrderAdminRoleIds(guild) {
  const configured = [
    ...getMasterRoleIds(),
    ...getVortexRoleIds(['admin']),
  ].map(String);
  return [...new Set(configured)]
    .filter((roleId) => /^\d{15,25}$/.test(roleId))
    .filter((roleId) => guild?.roles?.cache?.has(roleId));
}

function buildOrderLogOverwrites(guild) {
  const adminRoleIds = getOrderAdminRoleIds(guild);
  const masterUserIds = getMasterUserIds();
  return [
    {
      id: guild.id,
      deny: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
      ],
    },
    {
      id: guild.client.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageChannels,
      ],
    },
    ...adminRoleIds.map((roleId) => ({
      id: roleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    })),
    ...masterUserIds.map((userId) => ({
      id: userId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageChannels,
      ],
    })),
  ];
}

async function ensureOrderLogChannel(client, guildId, settings = null) {
  const guild = client?.guilds?.cache?.get(guildId) || await client?.guilds?.fetch?.(guildId).catch(() => null);
  if (!guild) throw new Error('Servidor nao encontrado para criar logs de encomendas.');

  await guild.roles.fetch().catch(() => null);
  const category = await guild.channels.fetch(ORDER_LOG_CATEGORY_ID).catch(() => null);
  if (!category || category.type !== ChannelType.GuildCategory) {
    throw new Error(`Categoria obrigatoria de logs de encomendas <#${ORDER_LOG_CATEGORY_ID}> nao encontrada.`);
  }

  const channels = await guild.channels.fetch().catch(() => null);
  const configuredChannelId = settings?.order_log_channel_id || settings?.orderLogChannelId || '';
  const configuredChannel = configuredChannelId
    ? await guild.channels.fetch(configuredChannelId).catch(() => null)
    : null;
  let channel = configuredChannel?.type === ChannelType.GuildText
    ? configuredChannel
    : channels?.find((item) => (
      item?.type === ChannelType.GuildText
      && String(item.parentId || '') === ORDER_LOG_CATEGORY_ID
      && String(item.name || '').toLowerCase() === ORDER_LOG_CHANNEL_NAME
    ));

  const permissionOverwrites = buildOrderLogOverwrites(guild);
  if (!channel) {
    channel = await guild.channels.create({
      name: ORDER_LOG_CHANNEL_NAME,
      type: ChannelType.GuildText,
      parent: category.id,
      topic: 'Logs obrigatorios do Sistema de Encomendas Vortex.',
      permissionOverwrites,
      reason: 'Canal obrigatorio de logs de encomendas Vortex',
    });
  } else {
    await channel.permissionOverwrites.set(permissionOverwrites, 'Sincronizar logs obrigatorios de encomendas').catch(() => null);
    if (String(channel.parentId || '') !== ORDER_LOG_CATEGORY_ID) {
      await channel.setParent(category.id, { lockPermissions: false, reason: 'Mover logs de encomendas para categoria obrigatoria' }).catch(() => null);
    }
  }

  await getCollection('order_settings').updateOne(
    { guild_id: guildId },
    {
      $set: {
        order_log_channel_id: channel.id,
        order_log_category_id: ORDER_LOG_CATEGORY_ID,
        updated_at: new Date(),
      },
      $setOnInsert: {
        guild_id: guildId,
        created_at: new Date(),
      },
    },
    { upsert: true },
  );

  return channel;
}

function orderLogActionLabel(action) {
  return {
    order_created: 'Nova venda/encomenda',
    order_cancelled: 'Pedido nao entregue',
    status_delivered: 'Pedido entregue',
    status_transport: 'Pedido em transporte',
    status_separating: 'Pedido aprovado',
    favorite_saved: 'Modelo salvo',
    family_created: 'Familia cadastrada',
    family_updated: 'Familia atualizada',
    family_deleted: 'Familia removida',
    item_added: 'Item adicionado',
  }[action] || String(action || 'Log');
}

function formatLogMoney(value, currency = 'BRL') {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value || '0');
  return formatOrderMoney(cents(number), currency);
}

function formatOrderLogDetails(details = {}) {
  const lines = [];
  const currency = resolveCurrency(details.currency);
  if (details.totalValue !== undefined) lines.push(`Valor: **${formatLogMoney(details.totalValue, currency)}**`);
  if (details.subtotalValue !== undefined) lines.push(`Valor bruto: **${formatLogMoney(details.subtotalValue, currency)}**`);
  if (details.discountValue !== undefined) lines.push(`Desconto: **${formatLogMoney(details.discountValue, currency)}**`);
  if (details.items !== undefined) lines.push(`Itens: **${details.items}**`);
  if (details.item) lines.push(`Item: **${details.item}**`);
  if (details.quantity !== undefined) lines.push(`Quantidade: **${details.quantity}**`);
  if (details.status) lines.push(`Status: **${details.status}**`);
  if (details.reason) lines.push(`Motivo: **${String(details.reason).slice(0, 500)}**`);
  if (details.coupon) lines.push(`Cupom: **${details.coupon}**`);
  if (details.discountSource) lines.push(`Origem do desconto: **${details.discountSource}**`);
  return lines;
}

function buildOrderLogPayload(log) {
  const details = log.details && typeof log.details === 'object' ? log.details : {};
  const description = [
    log.order_number ? `Pedido: **#${log.order_number}**` : null,
    log.family_name ? `Familia: **${log.family_name}**` : null,
    log.actor_name ? `Responsavel: **${log.actor_name}**` : null,
    ...formatOrderLogDetails(details),
    `Data: <t:${Math.floor(new Date(log.created_at || Date.now()).getTime() / 1000)}:F>`,
  ].filter(Boolean).join('\n');

  return {
    embeds: [new EmbedBuilder()
      .setColor(log.action === 'order_cancelled' ? '#EF4444' : log.action === 'status_delivered' ? '#22C55E' : '#0EA5E9')
      .setTitle(`Logs de Encomendas | ${orderLogActionLabel(log.action)}`)
      .setDescription(description.slice(0, 4000))
      .setTimestamp(log.created_at || new Date())],
    allowedMentions: { parse: [] },
  };
}

async function sendOrderLogToDiscord(log, settings = null, context = null) {
  const client = context?.client || context?.client?.client || null;
  if (!client) return null;
  const channel = await ensureOrderLogChannel(client, String(log.guild_id || ''), settings);
  return channel.send(buildOrderLogPayload(log));
}

async function ensureMandatoryOrderLogging(interaction, settings = null) {
  if (!interaction?.client) return null;
  return ensureOrderLogChannel(interaction.client, getGuildId(interaction), settings);
}

async function nextOrderNumber(guildId) {
  const result = await getCollection('order_counters').findOneAndUpdate(
    { guild_id: guildId, key: 'orders' },
    { $inc: { seq: 1 }, $setOnInsert: { guild_id: guildId, key: 'orders', created_at: new Date() } },
    { upsert: true, returnDocument: 'after' },
  );
  return ORDER_NUMBER_OFFSET + Number(result?.seq || 1);
}

async function insertOrderLog(log, family = null, settings = null, context = null) {
  await getCollection('order_logs').insertOne(log);
  await sendOrderLogToDiscord(log, settings, context);
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

async function persistOrderItems(guildId, orderId, orderNumber, items, createdAt = new Date()) {
  if (!Array.isArray(items) || !items.length) return;
  await getCollection('order_items').insertMany(items.map((item) => ({
    _id: new mongoose.Types.ObjectId(),
    guild_id: guildId,
    order_id: String(orderId),
    order_number: orderNumber || null,
    munition_id: item.munition_id || null,
    inventory_item_id: item.inventory_item_id || null,
    nome: item.name,
    identificador: item.munition_identifier || null,
    categoria: item.category || 'custom',
    quantidade: Number(item.quantity || 0),
    valor_unitario: moneyFromCents(Number(item.unit_price_cents || 0)),
    valor_unitario_cents: Number(item.unit_price_cents || 0),
    subtotal: moneyFromCents(Number(item.total_value_cents || 0)),
    subtotal_cents: Number(item.total_value_cents || 0),
    created_at: createdAt,
  }))).catch(() => null);
}

function formatOrderApprovalItems(order) {
  const currency = resolveCurrency(order.currency);
  const hasManualValue = Number(order.manual_total_value_cents || 0) > 0;
  const lines = (order.items || []).map((line) => {
    if (hasManualValue) {
      return [
        String(line.name || 'Municao'),
        `Quantidade: ${Number(line.quantity || 0).toLocaleString('pt-BR')}`,
      ].join('\n');
    }
    const base = [
      `${line.emoji || '\u{1F52B}'} **${line.name}**`,
      `Quantidade: ${Number(line.quantity || 0).toLocaleString('pt-BR')}`,
    ];
    base.push(`Valor: ${formatOrderMoney(Number(line.total_value_cents || 0), currency)}`);
    return base.join('\n');
  }).join('\n\n');

  return lines;
}

function orderMunitionsPayloadFromItems(items = []) {
  return ORDER_TICKET_MUNITION_FIELDS.reduce((payload, field) => {
    const line = items.find((item) => String(item.munition_identifier || '') === field.key || String(item.name || '') === field.label);
    if (line && Number(line.quantity || 0) > 0) payload[field.key] = Number(line.quantity || 0);
    return payload;
  }, {});
}

function buildOrderApprovalPayload(order) {
  const currency = resolveCurrency(order.currency);
  const items = formatOrderApprovalItems(order);
  const hasManualValue = Number(order.manual_total_value_cents || 0) > 0;
  const subtotal = Number(order.subtotal_value_cents ?? order.total_value_cents ?? 0);
  const discount = Number(order.discount_value_cents ?? 0);
  const final = Number(order.final_value_cents ?? order.total_value_cents ?? Math.max(0, subtotal - discount));
  const discountLabel = order.coupon_code
    ? `${order.coupon_code} (${Number(order.coupon_percentage || 0)}%)`
    : Number(order.coupon_percentage || 0) > 0
      ? `Desconto da familia (${Number(order.coupon_percentage || 0)}%)`
      : 'Sem desconto';
  const description = hasManualValue
    ? [
      `Categoria: ${order.family_name}`,
      `Cupom: ${order.coupon_code || order.coupon_input || 'Sem cupom'}`,
      `Moeda: ${currency}`,
      '',
      'Munições:',
      '',
      items || 'Nenhuma munição informada',
      '',
      'Valor:',
      formatManualOrderMoney(Number(order.manual_total_value_cents || 0), currency),
      '',
      `**Status:** ${order.status === 'pending' ? '\u{1F7E1} Pendente' : statusLabel(order.status)}`,
    ].join('\n')
    : [
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
    ].filter(Boolean).join('\n');
  const embed = new EmbedBuilder()
    .setColor(Number.parseInt(String(order.family_color || '#0EA5E9').replace('#', ''), 16) || 0x0ea5e9)
    .setTitle(`${ORDER_PANEL_EMOJI} Nova Encomenda`)
    .setDescription(description)
    .setFooter({ text: 'Vortex | Sistema de Encomendas' })
    .setTimestamp(order.created_at);

  return {
    content: order.responsible_role_id ? `<@&${order.responsible_role_id}>` : undefined,
    embeds: [embed],
    components: [
      row(
        button(`order_edit_quantities_${String(order._id)}`, 'Editar Quantidades', ButtonStyle.Secondary, { disabled: ['delivered', 'cancelled'].includes(order.status) }),
        button(`order_delivered_${String(order._id)}`, 'Entregue', ButtonStyle.Success, { disabled: ['delivered', 'cancelled'].includes(order.status) }),
        button(`order_cancel_${String(order._id)}`, 'Nao Entregue', ButtonStyle.Danger, { disabled: ['cancelled', 'delivered'].includes(order.status) }),
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

function buildOrderWorkPayload(session) {
  const embed = new EmbedBuilder()
    .setColor('#0EA5E9')
    .setTitle('Fazer Encomenda')
    .setDescription([
      `Categoria: **${session.familyName || 'Selecionada'}**`,
      `Aplicar desconto: **${session.discountChoice === 'sim' ? 'Sim' : 'Nao'}**`,
      `Moeda: **${resolveCurrency(session.currency)}**`,
      '',
      'Clique em **Fazer Encomenda** para informar as municoes e o valor.',
    ].join('\n'))
    .setFooter({ text: 'Vortex | Sistema de Encomendas' })
    .setTimestamp();

  return buildPayload('orders', embed, [
    row(button(ORDER_FILL_MUNITIONS_BUTTON, 'Fazer Encomenda', ButtonStyle.Primary, { emoji: ORDER_PANEL_EMOJI })),
  ], false);
}

async function createOrderWorkChannel(interaction, session) {
  const guild = interaction.guild || await interaction.client.guilds.fetch(session.guildId).catch(() => null);
  if (!guild) throw new Error('Servidor nao encontrado para criar o canal da encomenda.');
  const category = await guild.channels.fetch(ORDER_WORK_CATEGORY_ID).catch(() => null);
  if (!category || category.type !== ChannelType.GuildCategory) {
    throw new Error(`Categoria de encomendas <#${ORDER_WORK_CATEGORY_ID}> nao encontrada.`);
  }

  const familyPart = channelSafeName(session.familyName || 'familia');
  const userPart = channelSafeName(interaction.user?.username || interaction.user?.id || 'usuario');
  const permissionOverwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel],
    },
    {
      id: interaction.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },
    {
      id: guild.members.me?.id || interaction.client.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageChannels,
      ],
    },
  ];
  if (session.familyResponsibleRoleId) {
    permissionOverwrites.push({
      id: session.familyResponsibleRoleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageChannels,
      ],
    });
  }

  const channel = await guild.channels.create({
    name: `encomenda-${familyPart}-${userPart}`.slice(0, 90),
    type: ChannelType.GuildText,
    parent: ORDER_WORK_CATEGORY_ID,
    topic: `Encomenda aberta por ${interaction.user?.tag || interaction.user?.username || interaction.user?.id || 'usuario'}.`,
    permissionOverwrites,
    reason: 'Canal de preenchimento de encomenda Vortex',
  });

  session.workChannelId = channel.id;
  await channel.send(buildOrderWorkPayload(session));
  return channel;
}

async function editApprovalMessage(interaction, order) {
  if (!order.approval_channel_id || !order.approval_message_id) return;
  const channel = await interaction.client.channels.fetch(order.approval_channel_id).catch(() => null);
  if (!channel?.isTextBased?.()) return;
  const message = await channel.messages.fetch(order.approval_message_id).catch(() => null);
  if (message?.editable) await message.edit(buildOrderApprovalPayload(order)).catch(() => null);
}

function scheduleFinalizedOrderChannelDelete(interaction, order) {
  const channel = interaction.channel;
  if (!channel?.delete || !order?.approval_channel_id) return;
  if (String(channel.id) !== String(order.approval_channel_id)) return;

  setTimeout(() => {
    channel.delete('Encomenda finalizada pelo Sistema Vortex.').catch(() => null);
  }, 15000);
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
      discountChoice: 'nao',
      familyDiscountPercentage: 0,
      subject: '',
      couponInput: '',
      groupedItems: emptyGroupedItems(),
      manualTotalValueCents: 0,
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
    const gross = calculateLineTotalCents(session.quantity, session.unitPriceCents);
    const discount = hasSessionDiscount(session) ? calculateDiscountCents(gross, session.couponPercentage) : 0;
    return Math.max(0, gross - discount);
  }
  return session.cart.reduce((total, item) => total + item.total_value_cents, 0);
}

function orderPreviewTotals(session) {
  const quantity = Math.max(0, Number(session.quantity || 0));
  const unit = Number(session.unitPriceCents || 0);
  const gross = calculateLineTotalCents(quantity, unit);
  const percent = Math.max(0, Math.min(100, Number(session.couponPercentage || 0)));
  const discount = hasSessionDiscount(session) ? calculateDiscountCents(gross, percent) : 0;
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

  const couponModeRadio = new RadioGroupBuilder()
    .setCustomId(ORDER_TICKET_COUPON_MODE_FIELD)
    .setRequired(true)
    .setOptions(
      { label: 'Sim', value: 'sim', description: 'Aplicar desconto da encomenda.' },
      { label: 'Nao', value: 'nao', description: 'Enviar sem desconto.', default: true },
    );

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
      .setLabel('Cupom?')
      .setRadioGroupComponent(couponModeRadio),
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
      return safeReply(interaction, {
        content: 'Nao consegui abrir o modal de encomenda. Tente clicar em Abrir Nova Encomenda novamente.',
        ephemeral: true,
      });
    });
}

async function buildOrderAdminPanelPayload(interaction = null) {
  const guildId = interaction ? getGuildId(interaction) : String(process.env.GUILD_ID || 'global');
  const [families, coupons, munitions, products, settings] = isMongoReady()
    ? await Promise.all([
      getCollection('order_families').countDocuments({ guild_id: guildId }),
      getCollection('order_coupons').countDocuments({ guild_id: guildId }),
      ensureDefaultMunitions(guildId).then((collection) => collection.countDocuments({ guild_id: guildId, ativo: true })),
      getCollection('order_inventory').countDocuments({ guild_id: guildId }),
      getSettings(guildId),
    ])
    : [0, 0, 0, 0, null];

  const embed = new EmbedBuilder()
    .setColor('#0EA5E9')
    .setAuthor({ name: 'VORTEX | Gerenciamento de Encomendas', iconURL: interaction?.client?.user?.displayAvatarURL?.() || undefined })
    .setTitle('Painel Administrativo')
    .setDescription([
      `Familias cadastradas: **${families}**`,
      `Cupons cadastrados: **${coupons}**`,
      `Municoes cadastradas: **${munitions}**`,
      `Produtos cadastrados: **${products}**`,
      `Desconto padrao: **${settingsDefaultDiscountPercentage(settings)}%**`,
      `Canal de registro: ${settings?.order_channel_id ? `<#${settings.order_channel_id}>` : '**nao configurado**'}`,
      '',
      'Use os botoes abaixo para configurar facs, ajustar municoes, desconto e consultar historico.',
    ].join('\n'))
    .setFooter({ text: 'Vortex | Sistema de Encomendas' })
    .setTimestamp();

  return buildPayload('orders', embed, [
    row(
      button('order_family_manage', 'Familias', ButtonStyle.Secondary),
      button('order_munition_manage', 'Municoes', ButtonStyle.Secondary),
      button('order_discount_manage', 'Desconto', ButtonStyle.Secondary),
      button('order_history', 'Historico', ButtonStyle.Secondary),
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
    [row(button('order_cancel_session', 'Cancelar', ButtonStyle.Secondary))]), true);
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

function buildGroupedQuantitiesModal(session, page = 0) {
  const groupedItems = session.groupedItems || {};
  const pageItems = groupedModalPageItems(session, page);
  const modal = new ModalBuilder()
    .setCustomId(`${GROUPED_QUANTITIES_MODAL_ID}:${page}`)
    .setTitle(page > 0 ? `Sistema de Municoes ${page + 1}` : 'Sistema de Municoes');

  modal.addLabelComponents(...pageItems.map((item) => {
    const current = groupedItems[item.key] || {};
    return new LabelBuilder()
      .setLabel(item.label)
      .setDescription(munitionPriceDescription(session, item, item.description || 'Quantidade'))
      .setTextInputComponent(new TextInputBuilder()
        .setCustomId(groupedQuantityFieldId(item))
        .setPlaceholder(item.placeholder)
        .setValue(current.quantity ? String(current.quantity).slice(0, 12) : '')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(12));
  }));

  return modal;
}

function buildGroupedValuesModal(session, page = 0) {
  const groupedItems = session.groupedItems || {};
  const currency = resolveCurrency(session.currency);
  const labelSuffix = currency === 'USD' ? '$' : 'R$';
  const pageItems = groupedModalPageItems(session, page);
  const modal = new ModalBuilder()
    .setCustomId(`${GROUPED_VALUES_MODAL_ID}:${page}`)
    .setTitle(page > 0 ? `Valores Unitarios ${page + 1}` : `Valores Unitarios ${currency}`);

  modal.addComponents(...pageItems.map((item) => {
    const current = groupedItems[item.key] || {};
    return row(new TextInputBuilder()
      .setCustomId(groupedValueFieldId(item))
      .setLabel(`Valor Unitario ${item.label}`.slice(0, 45))
      .setPlaceholder(`Ex: ${labelSuffix}15`)
      .setValue(current.unitPriceCents ? String(moneyFromCents(current.unitPriceCents)).slice(0, 18) : '')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(18));
  }));

  return modal;
}

function buildGroupedItemsModal(session) {
  return buildGroupedQuantitiesModal(session, 0);
}

function buildEditOrderQuantitiesModal(order) {
  const quantities = new Map((order.items || []).map((item) => [String(item.munition_identifier || ''), Number(item.quantity || 0)]));
  const modal = new ModalBuilder()
    .setCustomId(`${ORDER_EDIT_QUANTITIES_MODAL_ID}_${String(order._id)}`)
    .setTitle('Editar Quantidades');

  modal.addLabelComponents(...ORDER_TICKET_MUNITION_FIELDS.map((item) => new LabelBuilder()
    .setLabel(item.label)
    .setDescription('Quantidade')
    .setTextInputComponent(new TextInputBuilder()
      .setCustomId(groupedQuantityFieldId(item))
      .setPlaceholder(item.placeholder)
      .setValue(quantities.get(item.key) ? String(quantities.get(item.key)).slice(0, 12) : '')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(12))));

  return modal;
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
    [row(button('order_cancel_session', 'Cancelar', ButtonStyle.Secondary))]), true);
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
      .setDescription('Cadastre uma familia em Familias antes de abrir pedidos.'),
    [row(button('order_family_manage', 'Familias', ButtonStyle.Primary))]), true);
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
        .setLabel('Nome do lider da fac')
        .setValue(String(family?.leader_name || '').slice(0, 100))
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(100)),
    );
}

function familyValuesModalId(familyId, page = 0) {
  return `${FAMILY_VALUES_MODAL_ID}_${String(familyId)}:${Math.max(0, Number(page || 0))}`;
}

function parseFamilyValuesModalId(customId) {
  const value = String(customId || '').replace(`${FAMILY_VALUES_MODAL_ID}_`, '');
  const [familyId, pageRaw = '0'] = value.split(':');
  const page = Number(pageRaw || 0);
  return {
    familyId,
    page: Number.isFinite(page) && page >= 0 ? Math.floor(page) : 0,
  };
}

function familyValuesPageItems(munitions, page = 0) {
  const start = Math.max(0, Number(page || 0)) * MODAL_FIELD_PAGE_SIZE;
  return (munitions || []).slice(start, start + MODAL_FIELD_PAGE_SIZE);
}

function hasFamilyValuesNextPage(munitions, page = 0) {
  return (munitions || []).length > (Number(page || 0) + 1) * MODAL_FIELD_PAGE_SIZE;
}

function buildFamilyValuesModal(family, munitions, page = 0) {
  const prices = familyMunitionUnitPrices(family, munitions);
  const modal = new ModalBuilder()
    .setCustomId(familyValuesModalId(family?._id || family?.id || '', page))
    .setTitle(page > 0 ? `Valores Municoes ${page + 1}` : 'Editar Valores Municoes');

  modal.addComponents(...familyValuesPageItems(munitions, page).map((item) => row(new TextInputBuilder()
    .setCustomId(`${FAMILY_MUNITION_PRICES_FIELD}_${item.key}`)
    .setLabel(String(item.label || item.key).slice(0, 45))
    .setPlaceholder('Ex: 500')
    .setValue(prices[item.key] ? String(moneyFromCents(prices[item.key])).slice(0, 18) : '')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(18))));

  return modal;
}

function buildDefaultDiscountModal(settings = null) {
  const current = settingsDefaultDiscountPercentage(settings);
  return new ModalBuilder()
    .setCustomId(ORDER_DISCOUNT_MODAL_ID)
    .setTitle('Desconto das Encomendas')
    .addComponents(
      row(new TextInputBuilder()
        .setCustomId(ORDER_DISCOUNT_PERCENT_FIELD)
        .setLabel('Porcentagem de desconto')
        .setPlaceholder('Ex: 10')
        .setValue(current ? String(current).slice(0, 6) : '')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(6)),
    );
}

function buildMunitionModal(mode, munition = null) {
  const identifier = String(munition?.key || munition?.identificador || '');
  return new ModalBuilder()
    .setCustomId(mode === 'edit' ? `${ORDER_MUNITION_MODAL_ID}_edit_${String(munition?.id || '')}` : `${ORDER_MUNITION_MODAL_ID}_create`)
    .setTitle(mode === 'edit' ? 'Editar Municao' : 'Adicionar Municao')
    .addComponents(
      row(new TextInputBuilder()
        .setCustomId(ORDER_MUNITION_NAME_FIELD)
        .setLabel('Nome da Municao')
        .setPlaceholder('Ex: HK/MAG')
        .setValue(String(munition?.label || '').slice(0, 100))
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(100)),
      row(new TextInputBuilder()
        .setCustomId(ORDER_MUNITION_IDENTIFIER_FIELD)
        .setLabel('Identificador')
        .setPlaceholder('Ex: hk_mag')
        .setValue(identifier.slice(0, 80))
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(80)),
      row(new TextInputBuilder()
        .setCustomId(ORDER_MUNITION_ORDER_FIELD)
        .setLabel('Ordem de Exibicao')
        .setPlaceholder('Ex: 1')
        .setValue(String(munition?.order || 1).slice(0, 8))
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(8)),
      row(new TextInputBuilder()
        .setCustomId(ORDER_MUNITION_ACTIVE_FIELD)
        .setLabel('Ativo? sim/nao')
        .setPlaceholder('sim')
        .setValue(munition?.active === false ? 'nao' : 'sim')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(5)),
    );
}

function buildCancelModal(orderId) {
  return new ModalBuilder()
    .setCustomId(`modal_order_cancel_${orderId}`)
    .setTitle('Pedido Nao Entregue')
    .addComponents(
      row(new TextInputBuilder()
        .setCustomId('reason')
        .setLabel('Motivo')
        .setPlaceholder('Ex: Pagamento nao realizado, sem estoque ou pedido cancelado')
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
  }, family, await getSettings(session.guildId), interaction);
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
  await ensureMandatoryOrderLogging(interaction, settings);
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
      munition_id: line.munition_id || line.id || null,
      munition_identifier: line.key || null,
      name: line.label,
      emoji: line.emoji,
      category: 'munitions',
      package_quantity: 1,
      quantity: Number(line.quantity || 0),
      unit_price_cents: Number(line.unitPriceCents || 0),
      total_value_cents: Number(line.valueCents || 0),
    })),
    currency,
    categoria: family.name,
    cupom: coupon?.code || session.couponInput || '',
    moeda: currency,
    desconto_encomenda: session.discountChoice || 'nao',
    municoes: orderMunitionsPayloadFromItems(lines.map((line) => ({
      munition_identifier: line.key || null,
      name: line.label,
      quantity: Number(line.quantity || 0),
    }))),
    valor_encomenda: moneyFromCents(Number(totals.final || 0)),
    valor_encomenda_cents: Number(totals.final || 0),
    coupon_input: session.couponInput || null,
    manual_total_value_cents: 0,
    manual_total_value: 0,
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
    approval_channel_id: session.workChannelId || family.order_channel_id || settings?.order_channel_id || null,
    approval_message_id: null,
    responsible_role_id: family.responsible_role_id || null,
    created_by_id: actor.id,
    created_by_name: actor.name,
    source: 'discord',
    created_at: now,
    updated_at: now,
  };

  await getCollection('orders').insertOne(order);
  await persistOrderItems(session.guildId, orderId, order.order_number, order.items, now);
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
  }, family, settings, interaction);

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
  [row(button('order_start', 'Nova Encomenda', ButtonStyle.Primary, { emoji: '\u{2795}' }))]);
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
    const subtotal = calculateLineTotalCents(quantity, unitPriceCents);
    const couponPercentage = coupon
      ? Math.max(0, Math.min(100, Number(coupon.percentage || 0)))
      : session.discountSource === 'family'
        ? familyDefaultDiscountPercentage(family)
        : 0;
    const discount = calculateDiscountCents(subtotal, couponPercentage);
    const final = Math.max(0, subtotal - discount);
    const actor = getActor(interaction);
    const now = new Date();
    const settings = await getSettings(session.guildId);
    await ensureMandatoryOrderLogging(interaction, settings);
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
    await persistOrderItems(session.guildId, orderId, order.order_number, order.items, now);
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
    }, family, settings, interaction);

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
    [row(button('order_start', 'Nova Encomenda', ButtonStyle.Primary, { emoji: ORDER_PANEL_EMOJI }))]), true);
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
  await ensureMandatoryOrderLogging(interaction, settings);
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
  await persistOrderItems(session.guildId, orderId, order.order_number, order.items, now);
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
    details: { source: 'discord', currency: order.currency || 'BRL', items: order.items.length, totalValue: moneyFromCents(order.total_value_cents) },
    created_at: now,
  }, family, settings, interaction);

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
    }, family, settings, interaction);
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
  [row(button('order_start', 'Novo Pedido', ButtonStyle.Primary))]), true);
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
    button('order_family_values', 'Editar Valores', ButtonStyle.Primary, { disabled: !selected }),
    button('order_family_remove', 'Remover Familia', ButtonStyle.Danger, { disabled: !selected }),
  ));
  components.push(row(
    button('order_admin_home', 'Voltar', ButtonStyle.Secondary),
    button('order_munition_manage', 'Municoes', ButtonStyle.Secondary),
    button('order_history', 'Historico', ButtonStyle.Secondary),
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
  }, family, await getSettings(getGuildId(interaction)), interaction);
  familySelections.delete(sessionKey(interaction));
  return showFamilyManager(interaction);
}

async function showMunitionManager(interaction) {
  if (!hasOrderManagerPermission(interaction.member)) {
    return safeReply(interaction, { content: 'Voce nao tem permissao para gerenciar municoes.', ephemeral: true });
  }

  const guildId = getGuildId(interaction);
  const munitions = await listMunitions(guildId, false);
  const selectedId = munitionSelections.get(sessionKey(interaction)) || String(munitions[0]?.id || '');
  const selected = munitions.find((munition) => String(munition.id) === selectedId) || munitions[0] || null;
  if (selected) munitionSelections.set(sessionKey(interaction), String(selected.id));

  const select = munitions.length
    ? new StringSelectMenuBuilder()
      .setCustomId('order_select_munition_manage')
      .setPlaceholder('Selecionar municao')
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(munitions.slice(0, 25).map((munition) => ({
        label: String(munition.label || 'Municao').slice(0, 100),
        value: String(munition.id),
        description: `${munition.active ? 'Ativa' : 'Inativa'} | ${munition.key} | ordem ${munition.order}`.slice(0, 100),
        default: selected && String(munition.id) === String(selected.id),
      })))
    : null;

  const embed = new EmbedBuilder()
    .setColor('#0EA5E9')
    .setTitle('Gerenciar Municoes')
    .setDescription(selected ? [
      `Selecionada: **${selected.label}**`,
      `Identificador: **${selected.key}**`,
      `Ordem de exibicao: **${selected.order}**`,
      `Status: **Ativa**`,
      '',
      'Toda municao ativa aparece automaticamente no formulario de nova encomenda.',
    ].join('\n') : 'Nenhuma municao cadastrada ainda.');

  const components = [];
  if (select) components.push(row(select));
  components.push(row(
    button('order_munition_create', 'Adicionar Municao', ButtonStyle.Success, { emoji: '\u{2795}' }),
    button('order_munition_edit', 'Editar Municao', ButtonStyle.Primary, { disabled: !selected }),
    button('order_munition_remove', 'Remover Municao', ButtonStyle.Danger, { disabled: !selected }),
  ));
  components.push(row(
    button('order_admin_home', 'Voltar', ButtonStyle.Secondary),
    button('order_family_manage', 'Familias', ButtonStyle.Secondary),
  ));

  return respondPanel(interaction, buildPayload('orders', embed, components), true);
}

async function selectedMunitionForManager(interaction) {
  const selectedId = munitionSelections.get(sessionKey(interaction));
  const id = objectId(selectedId);
  if (!id) return null;
  const doc = await getCollection('munitions').findOne({ _id: id, guild_id: getGuildId(interaction) });
  return normalizeMunitionDoc(doc);
}

async function removeSelectedMunition(interaction) {
  const selected = await selectedMunitionForManager(interaction);
  if (!selected) return showMunitionManager(interaction);
  const guildId = getGuildId(interaction);
  const now = new Date();
  await getCollection('munitions').updateOne(
    { _id: objectId(selected.id), guild_id: guildId },
    { $set: { ativo: false, updated_at: now } },
  );
  await getCollection('order_families').updateMany(
    { guild_id: guildId },
    {
      $unset: {
        [`munition_unit_prices.${selected.key}`]: '',
        [`munition_prices.${selected.key}`]: '',
      },
      $set: { updated_at: now },
    },
  );
  removeMunitionFromActiveSessions(guildId, selected);
  munitionSelections.delete(sessionKey(interaction));
  await insertOrderLog({
    guild_id: guildId,
    action: 'munition_deleted',
    actor_id: getActor(interaction).id,
    actor_name: getActor(interaction).name,
    details: { source: 'discord', munition: selected.label, identificador: selected.key },
    created_at: now,
  }, null, await getSettings(guildId), interaction);
  return showMunitionManager(interaction);
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

async function showOrderHistoryFamilySelect(interaction) {
  const guildId = getGuildId(interaction);
  const families = await listFamilies(guildId, true);
  if (!families.length) {
    return safeReply(interaction, { content: 'Nenhuma fac/familia cadastrada para consultar historico.', ephemeral: true });
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId(ORDER_HISTORY_FAMILY_SELECT)
    .setPlaceholder('Selecione a fac para gerar o relatorio')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(families.slice(0, 25).map((family) => ({
      label: String(family.name || 'Familia').slice(0, 100),
      value: String(family._id),
      description: `${family.active ? 'Ativa' : 'Inativa'} | ${family.members?.length || 0} membro(s)`.slice(0, 100),
    })));

  const embed = new EmbedBuilder()
    .setColor('#0EA5E9')
    .setTitle('Historico de Encomendas')
    .setDescription('Selecione uma fac/familia para gerar o relatorio em painel.');

  return respondPanel(interaction, buildPayload('orders', embed, [
    row(select),
    row(button('order_admin_home', 'Voltar', ButtonStyle.Secondary)),
  ]), true);
}

async function showFamilyOrdersReport(interaction, familyId) {
  const guildId = getGuildId(interaction);
  const id = objectId(familyId);
  const family = id ? await getCollection('order_families').findOne({ _id: id, guild_id: guildId }) : null;
  if (!family) return safeReply(interaction, { content: 'Fac/familia nao encontrada.', ephemeral: true });

  const orders = await getCollection('orders')
    .find({ guild_id: guildId, family_id: String(family._id) })
    .sort({ created_at: -1 })
    .limit(100)
    .toArray();

  const totals = orders.reduce((acc, order) => {
    const currency = resolveCurrency(order.currency);
    const final = Number(order.final_value_cents ?? order.total_value_cents ?? 0);
    acc.count += 1;
    acc.status[order.status || 'pending'] = (acc.status[order.status || 'pending'] || 0) + 1;
    if (currency === 'USD') acc.usd += final;
    else acc.brl += final;
    return acc;
  }, { count: 0, brl: 0, usd: 0, status: {} });

  const lines = orders.map((order) => {
    const currency = resolveCurrency(order.currency);
    const final = Number(order.final_value_cents ?? order.total_value_cents ?? 0);
    const items = (order.items || [])
      .map((item) => `${Number(item.quantity || 0).toLocaleString('pt-BR')}x ${item.name}`)
      .join(', ') || 'Sem itens';
    return [
      `**#${order.order_number || 'N/A'}** | ${statusLabel(order.status)} | ${formatOrderMoney(final, currency)}`,
      `${items}`.slice(0, 220),
      `Criada em ${new Date(order.created_at || Date.now()).toLocaleString('pt-BR')}`,
    ].join('\n');
  });

  const header = [
    `Fac: **${family.icon || ORDER_PANEL_EMOJI} ${family.name}**`,
    `Total de encomendas: **${totals.count}**`,
    `Pendentes: **${totals.status.pending || 0}** | Entregues: **${totals.status.delivered || 0}** | Nao entregues: **${totals.status.cancelled || 0}**`,
    `Valor BRL: **${formatOrderMoney(totals.brl, 'BRL')}**`,
    `Valor USD: **${formatOrderMoney(totals.usd, 'USD')}**`,
    '',
    '**Encomendas**',
  ].join('\n');

  let description = header;
  let shown = 0;
  for (const line of lines) {
    const next = `${description}\n\n${line}`;
    if (next.length > 3900) break;
    description = next;
    shown += 1;
  }
  if (!orders.length) description += '\n`Nenhuma encomenda registrada para esta fac.`';
  if (orders.length > shown) description += `\n\nMostrando ${shown} de ${orders.length} encomendas mais recentes.`;

  const embed = new EmbedBuilder()
    .setColor(family.color || '#0EA5E9')
    .setTitle('Relatorio de Encomendas da Fac')
    .setDescription(description.slice(0, 4000))
    .setFooter({ text: 'Vortex | Sistema de Encomendas' })
    .setTimestamp();

  return respondPanel(interaction, buildPayload('orders', embed, [
    row(
      button('order_history', 'Selecionar outra fac', ButtonStyle.Secondary),
      button('order_admin_home', 'Voltar', ButtonStyle.Secondary),
    ),
  ]), true);
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

  const settings = await getSettings(guildId);
  await ensureMandatoryOrderLogging(interaction, settings);

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
    details: {
      status: statusLabel(status),
      reason: reason || null,
      currency: result.currency || 'BRL',
      totalValue: moneyFromCents(result.final_value_cents ?? result.total_value_cents ?? 0),
    },
    created_at: now,
  }, family, settings, interaction);

  return { ok: true, order: result };
}

async function updateOrderQuantitiesFromModal(interaction, orderId) {
  const id = objectId(orderId);
  if (!id) return safeEdit(interaction, { content: 'Pedido invalido.' });

  const guildId = getGuildId(interaction);
  const orders = getCollection('orders');
  const order = await orders.findOne({ _id: id, guild_id: guildId });
  if (!order) return safeEdit(interaction, { content: 'Pedido nao encontrado.' });
  if (['delivered', 'cancelled'].includes(order.status)) {
    return safeEdit(interaction, { content: 'Pedido finalizado nao pode ser editado.' });
  }

  const familyId = objectId(order.family_id);
  const family = familyId ? await getCollection('order_families').findOne({ _id: familyId, guild_id: guildId }) : null;
  if (!family) return safeEdit(interaction, { content: 'Familia da encomenda nao encontrada.' });

  const munitions = await listMunitions(guildId);
  const prices = familyMunitionUnitPrices(family, ORDER_TICKET_MUNITION_FIELDS);
  const errors = [];
  let totalQuantity = 0;
  const items = [];

  for (const field of ORDER_TICKET_MUNITION_FIELDS) {
    const parsed = parseOptionalQuantityInput(modalTextValue(interaction.fields, groupedQuantityFieldId(field)));
    if (!parsed.ok) {
      errors.push(field.label);
      continue;
    }
    if (!parsed.value) continue;
    const unitPriceCents = Number(prices[field.key] || 0);
    if (!unitPriceCents) {
      errors.push(`${field.label} sem valor cadastrado`);
      continue;
    }
    const munition = munitions.find((item) => item.key === field.key);
    totalQuantity += parsed.value;
    items.push({
      inventory_item_id: null,
      munition_id: munition?.id || null,
      munition_identifier: field.key,
      name: field.label,
      emoji: munition?.emoji || '\u{1F52B}',
      category: 'munitions',
      package_quantity: 1,
      quantity: parsed.value,
      unit_price_cents: unitPriceCents,
      total_value_cents: calculateLineTotalCents(parsed.value, unitPriceCents),
    });
  }

  if (errors.length) {
    return safeEdit(interaction, { content: `Revise estes campos: ${errors.join(', ')}. Use apenas numeros e cadastre os valores da familia.` });
  }
  if (!totalQuantity || !items.length) {
    return safeEdit(interaction, { content: 'Informe pelo menos uma quantidade maior que zero.' });
  }

  const subtotal = items.reduce((total, item) => total + Number(item.total_value_cents || 0), 0);
  const percentage = ['coupon', 'family'].includes(String(order.discount_source || '')) ? Number(order.coupon_percentage || 0) : 0;
  const discount = calculateDiscountCents(subtotal, percentage);
  const final = Math.max(0, subtotal - discount);
  const now = new Date();
  const currency = resolveCurrency(order.currency);
  const subject = items
    .map((item) => `${item.name} ${Number(item.quantity || 0).toLocaleString('pt-BR')} x ${formatOrderMoney(item.unit_price_cents || 0, currency)} = ${formatOrderMoney(item.total_value_cents || 0, currency)}`)
    .join('; ');

  const update = {
    items,
    subject,
    municoes: orderMunitionsPayloadFromItems(items),
    valor_encomenda: moneyFromCents(final),
    valor_encomenda_cents: final,
    subtotal_value_cents: subtotal,
    discount_value_cents: discount,
    final_value_cents: final,
    total_value_cents: final,
    updated_at: now,
  };

  const result = await orders.findOneAndUpdate(
    { _id: id, guild_id: guildId },
    { $set: update },
    { returnDocument: 'after' },
  );
  if (!result) return safeEdit(interaction, { content: 'Pedido nao encontrado.' });

  await getCollection('order_items').deleteMany({ guild_id: guildId, order_id: String(id) }).catch(() => null);
  await persistOrderItems(guildId, id, result.order_number, items, now);
  await editApprovalMessage(interaction, result);
  await insertOrderLog({
    guild_id: guildId,
    order_id: String(id),
    order_number: result.order_number,
    family_id: result.family_id,
    family_name: result.family_name,
    action: 'order_updated',
    actor_id: getActor(interaction).id,
    actor_name: getActor(interaction).name,
    details: {
      source: 'discord',
      items: items.length,
      currency,
      totalValue: moneyFromCents(final),
    },
    created_at: now,
  }, family, await getSettings(guildId), interaction);

  return safeEdit(interaction, { content: `Quantidades da encomenda #${result.order_number} atualizadas.` });
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
      discountChoice: 'nao',
      familyDiscountPercentage: 0,
      familyMunitionUnitPrices: {},
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

  if (interaction.customId === 'order_admin_home') {
    if (!hasOrderManagerPermission(interaction.member)) return safeReply(interaction, { content: 'Sem permissao.', ephemeral: true });
    return respondPanel(interaction, await buildOrderAdminPanelPayload(interaction), true);
  }
  if (interaction.customId === 'order_family_manage') return showFamilyManager(interaction);
  if (interaction.customId === 'order_munition_manage') return showMunitionManager(interaction);
  if (interaction.customId === 'order_discount_manage') {
    if (!hasOrderManagerPermission(interaction.member)) return safeReply(interaction, { content: 'Sem permissao.', ephemeral: true });
    return safeShowModal(interaction, buildDefaultDiscountModal(await getSettings(getGuildId(interaction))));
  }
  if (interaction.customId === 'order_history') return showOrderHistoryFamilySelect(interaction);
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
  if (interaction.customId === ORDER_FILL_MUNITIONS_BUTTON) {
    const session = getSession(interaction);
    if (!session.familyId || String(session.workChannelId || '') !== String(interaction.channelId || interaction.channel?.id || '')) {
      return safeReply(interaction, { content: 'Essa encomenda nao esta vinculada a este canal. Abra uma nova encomenda pelo painel.', ephemeral: true });
    }
    return safeShowModal(interaction, buildGroupedQuantitiesModal(session, 0));
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
  if (interaction.customId === 'order_family_values') {
    if (!hasOrderManagerPermission(interaction.member)) return safeReply(interaction, { content: 'Sem permissao.', ephemeral: true });
    const family = await selectedFamilyForManager(interaction);
    if (!family) return showFamilyManager(interaction);
    const munitions = await listMunitions(getGuildId(interaction), false);
    if (!munitions.length) return safeReply(interaction, { content: 'Cadastre pelo menos uma municao ativa antes de editar valores.', ephemeral: true });
    return safeShowModal(interaction, buildFamilyValuesModal(family, munitions, 0));
  }
  if (interaction.customId === 'order_family_remove') {
    if (!hasOrderManagerPermission(interaction.member)) return safeReply(interaction, { content: 'Sem permissao.', ephemeral: true });
    return removeSelectedFamily(interaction);
  }
  if (interaction.customId === 'order_family_view') return showFamilyMembers(interaction);
  if (interaction.customId === 'order_family_history') return showFamilyHistory(interaction);

  if (interaction.customId === 'order_munition_create') {
    if (!hasOrderManagerPermission(interaction.member)) return safeReply(interaction, { content: 'Sem permissao.', ephemeral: true });
    return safeShowModal(interaction, buildMunitionModal('create'));
  }
  if (interaction.customId === 'order_munition_edit') {
    if (!hasOrderManagerPermission(interaction.member)) return safeReply(interaction, { content: 'Sem permissao.', ephemeral: true });
    const munition = await selectedMunitionForManager(interaction);
    if (!munition) return showMunitionManager(interaction);
    return safeShowModal(interaction, buildMunitionModal('edit', munition));
  }
  if (interaction.customId === 'order_munition_remove') {
    if (!hasOrderManagerPermission(interaction.member)) return safeReply(interaction, { content: 'Sem permissao.', ephemeral: true });
    return removeSelectedMunition(interaction);
  }

  if (/^order_(approve|cancel|transport|delivered|edit_quantities)_/.test(interaction.customId) && !hasOrderManagerPermission(interaction.member)) {
    return safeReply(interaction, { content: 'Voce nao tem permissao para alterar o status de encomendas.', ephemeral: true });
  }

  const editQuantitiesId = parseOrderId(interaction.customId, 'order_edit_quantities_');
  if (editQuantitiesId) {
    const id = objectId(editQuantitiesId);
    const order = id ? await getCollection('orders').findOne({ _id: id, guild_id: getGuildId(interaction) }) : null;
    if (!order) return safeReply(interaction, { content: 'Pedido nao encontrado.', ephemeral: true });
    if (['delivered', 'cancelled'].includes(order.status)) {
      return safeReply(interaction, { content: 'Pedido finalizado nao pode ser editado.', ephemeral: true });
    }
    return safeShowModal(interaction, buildEditOrderQuantitiesModal(order));
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
    if (result.ok) scheduleFinalizedOrderChannelDelete(interaction, result.order);
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
  session.familyMunitionUnitPrices = familyMunitionUnitPrices(family, sessionMunitions(session));
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

  if (interaction.customId === ORDER_HISTORY_FAMILY_SELECT) {
    return showFamilyOrdersReport(interaction, String(interaction.values[0] || ''));
  }

  if (interaction.customId === 'order_select_munition_manage') {
    munitionSelections.set(sessionKey(interaction), String(interaction.values[0] || ''));
    return showMunitionManager(interaction);
  }

  return safeReply(interaction, { content: 'Selecao de encomenda invalida.', ephemeral: true });
}

async function resolveOrderTicketSetup(interaction, {
  familyInput,
  couponInput,
  currency,
  discountChoice = 'sim',
}) {
  if (!hasOrderUserPermission(interaction.member)) {
    return { ok: false, message: 'Voce nao tem permissao para fazer encomendas.' };
  }

  const guildId = getGuildId(interaction);
  const [family, munitions] = await Promise.all([
    resolveOrderTicketFamily(guildId, familyInput),
    listMunitions(guildId),
  ]);
  if (!family) return { ok: false, message: 'Categoria/familia de encomenda nao encontrada.' };
  if (!munitions.length) return { ok: false, message: 'Cadastre pelo menos uma municao ativa no Gerenciar Municoes antes de abrir encomendas.' };

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
  session.discountChoice = String(discountChoice || 'sim') === 'sim' ? 'sim' : 'nao';
  session.couponInput = String(couponInput || '').trim();
  session.munitions = munitions;
  session.groupedItems = emptyGroupedItems(munitions);
  session.familyMunitionUnitPrices = familyMunitionUnitPrices(family, munitions);
  session.manualTotalValueCents = 0;

  if (session.discountChoice === 'sim' && session.couponInput) {
    const coupon = await findCouponByCode(session.guildId, session.familyId, session.couponInput);
    if (!coupon) {
      return { ok: false, message: `Cupom \`${session.couponInput.slice(0, 60)}\` nao encontrado ou nao liberado para esta familia.` };
    }
    session.couponMode = 'yes';
    session.couponId = String(coupon._id);
    session.couponCode = coupon.code || coupon.name || session.couponInput;
    session.couponPercentage = Number(coupon.percentage || 0);
    session.discountSource = 'coupon';
  } else if (session.discountChoice === 'sim') {
    applyFamilyDefaultDiscount(session, family);
  } else {
    session.couponMode = 'no';
    session.couponId = '';
    session.couponCode = '';
    session.couponPercentage = 0;
    session.discountSource = 'none';
  }

  return { ok: true, session, family };
}

async function applyOrderTicketDiscountChoice(session, family) {
  if (session.discountChoice !== 'sim') {
    session.couponId = '';
    session.couponCode = '';
    session.couponPercentage = 0;
    session.discountSource = 'none';
    return { ok: true };
  }

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
    return { ok: true };
  }

  applyFamilyDefaultDiscount(session, family);
  return { ok: true };
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

  const munitions = sessionMunitions(session);
  const groupedItems = parseOrderTicketSubject(subject, munitions);
  const missingPrices = applyFamilyPricesToGroupedItems(groupedItems, family, munitions);
  const parsedLines = groupedOrderLines({ groupedItems });
  if (!parsedLines.length) {
    return safeEdit(interaction, {
      content: [
        'Informe pelo menos um produto no assunto e cadastre o valor unitario da muni na familia.',
        'Modelo: `HK/MAG 5000 | 15; TEC/FIVE 3000 | 10; MTAR/MP7 2000 | 25`',
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
    await safeDeferReply(interaction, { ephemeral: true });
    const setup = await resolveOrderTicketSetup(interaction, {
      familyInput: String(interaction.fields.getStringSelectValues(ORDER_TICKET_FAMILY_FIELD)?.[0] || ''),
      couponInput: '',
      currency: interaction.fields.getRadioGroup(ORDER_TICKET_CURRENCY_FIELD, true),
      discountChoice: interaction.fields.getRadioGroup(ORDER_TICKET_COUPON_MODE_FIELD, true),
    });
    if (!setup.ok) return safeEdit(interaction, { content: setup.message });

    const channel = await createOrderWorkChannel(interaction, setup.session).catch((error) => ({ error }));
    if (channel?.error) {
      return safeEdit(interaction, { content: `Nao consegui criar o canal da encomenda. Verifique as permissoes do bot e a categoria configurada. Detalhe: ${String(channel.error.message || channel.error).slice(0, 200)}` });
    }
    return safeEdit(interaction, { content: `Canal da encomenda criado: <#${channel.id}>. Use o botao **Fazer Encomenda** nesse canal para preencher as municoes.` });
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
      total_value_cents: calculateLineTotalCents(quantity, item.unit_price_cents),
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
    const munitions = sessionMunitions(session);
    session.groupedItems = session.groupedItems || emptyGroupedItems(munitions);
    for (const item of munitions) {
      const parsed = parseGroupedProductInput(interaction.fields.getTextInputValue(item.key));
      session.groupedItems[item.key] = {
        key: item.key,
        label: item.label,
        emoji: item.emoji,
        munition_id: item.id || null,
        quantity: parsed.quantity,
        unitPriceCents: parsed.unitPriceCents,
        valueCents: parsed.valueCents,
      };
    }
    if (session.familyId) {
      const familyId = objectId(session.familyId);
      const family = familyId ? await getCollection('order_families').findOne({ _id: familyId, guild_id: session.guildId, active: true }) : null;
      if (family) applyFamilyPricesToGroupedItems(session.groupedItems, family, sessionMunitions(session));
    }
    if (!groupedOrderLines(session).length) {
      return safeEdit(interaction, { content: 'Preencha pelo menos um produto com quantidade e valor maior que zero, ou cadastre o valor unitario da muni na familia.' });
    }
    session.subject = groupedOrderSubject(session);
    return showGroupedConfirmation(interaction);
  }

  if (String(interaction.customId || '').startsWith(GROUPED_QUANTITIES_MODAL_ID)) {
    const session = getSession(interaction);
    const page = groupedModalPageFromId(interaction.customId, GROUPED_QUANTITIES_MODAL_ID);
    const { totalQuantity, errors } = applyGroupedQuantityFields(session, interaction.fields, page);
    if (errors.length) {
      return safeReply(interaction, { content: `Revise estes campos: ${errors.join(', ')}. Use apenas numeros nas quantidades.`, ephemeral: true });
    }
    if (hasGroupedModalNextPage(session, page)) {
      return safeShowModal(interaction, buildGroupedQuantitiesModal(session, page + 1));
    }
    if (!totalQuantity) {
      return safeReply(interaction, { content: 'Preencha pelo menos uma quantidade maior que zero.', ephemeral: true });
    }
    await safeDeferReply(interaction, { ephemeral: true });
    const familyId = objectId(session.familyId);
    const family = familyId ? await getCollection('order_families').findOne({ _id: familyId, guild_id: session.guildId, active: true }) : null;
    if (!family) return safeEdit(interaction, { content: 'Familia ativa nao encontrada.' });
    const discount = await applyOrderTicketDiscountChoice(session, family);
    if (!discount.ok) return safeEdit(interaction, { content: discount.message });
    const missingPrices = applyFamilyPricesToGroupedItems(session.groupedItems, family, sessionMunitions(session));
    if (missingPrices.length) {
      return safeEdit(interaction, { content: `Cadastre o valor unitario de ${missingPrices.join(', ')} nessa familia para o sistema calcular automaticamente.` });
    }
    if (!groupedOrderLines(session).length) {
      return safeEdit(interaction, { content: 'Preencha pelo menos uma municao com quantidade maior que zero.' });
    }
    session.subject = groupedOrderSubject(session);
    return finalizeGroupedOrder(interaction, true);
  }

  if (String(interaction.customId || '').startsWith(GROUPED_VALUES_MODAL_ID)) {
    const session = getSession(interaction);
    const page = groupedModalPageFromId(interaction.customId, GROUPED_VALUES_MODAL_ID);
    const fieldErrors = applyGroupedValueFields(session, interaction.fields, page);
    if (fieldErrors.length) {
      return safeReply(interaction, { content: `Revise estes campos: ${fieldErrors.join(', ')}.`, ephemeral: true });
    }

    if (hasGroupedModalNextPage(session, page)) {
      return safeShowModal(interaction, buildGroupedValuesModal(session, page + 1));
    }

    await safeDeferReply(interaction, { ephemeral: true });

    let missingPrices = [];
    if (session.familyId) {
      const familyId = objectId(session.familyId);
      const family = familyId ? await getCollection('order_families').findOne({ _id: familyId, guild_id: session.guildId, active: true }) : null;
      if (family) missingPrices = applyFamilyPricesToGroupedItems(session.groupedItems, family, sessionMunitions(session));
    }
    if (missingPrices.length) {
      return safeEdit(interaction, { content: `Informe o Valor Unitario de ${missingPrices.join(', ')} ou cadastre o valor unitario na familia.` });
    }
    if (!groupedOrderLines(session).length) {
      return safeEdit(interaction, { content: 'Preencha pelo menos um produto com quantidade e valor maior que zero.' });
    }
    session.subject = groupedOrderSubject(session);
    return showGroupedConfirmation(interaction);
  }

  if (String(interaction.customId || '').startsWith(`${ORDER_EDIT_QUANTITIES_MODAL_ID}_`)) {
    await safeDeferReply(interaction, { ephemeral: true });
    const orderId = String(interaction.customId || '').replace(`${ORDER_EDIT_QUANTITIES_MODAL_ID}_`, '');
    return updateOrderQuantitiesFromModal(interaction, orderId);
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
      total_value_cents: calculateLineTotalCents(quantity, unitPriceCents),
    });
    return safeEdit(interaction, { content: `${quantity.toLocaleString('pt-BR')}x ${name} adicionado ao carrinho.` });
  }

  if (interaction.customId === `${ORDER_MUNITION_MODAL_ID}_create` || interaction.customId.startsWith(`${ORDER_MUNITION_MODAL_ID}_edit_`)) {
    if (!hasOrderManagerPermission(interaction.member)) return safeReply(interaction, { content: 'Sem permissao.', ephemeral: true });
    await safeDeferReply(interaction, { ephemeral: true });
    const guildId = getGuildId(interaction);
    const now = new Date();
    const name = modalTextValue(interaction.fields, ORDER_MUNITION_NAME_FIELD).slice(0, 100);
    const identifierInput = modalTextValue(interaction.fields, ORDER_MUNITION_IDENTIFIER_FIELD);
    const identifier = createIdentifier(identifierInput || name);
    const order = parsePositiveInt(modalTextValue(interaction.fields, ORDER_MUNITION_ORDER_FIELD)) || 1;
    const activeText = normalizeSearchText(modalTextValue(interaction.fields, ORDER_MUNITION_ACTIVE_FIELD) || 'sim');
    const active = !['nao', 'no', 'false', '0', 'inativa', 'inativo'].includes(activeText);
    if (!name || name.length < 2) return safeEdit(interaction, { content: 'Informe o nome da municao.' });

    const editId = interaction.customId.startsWith(`${ORDER_MUNITION_MODAL_ID}_edit_`)
      ? objectId(interaction.customId.replace(`${ORDER_MUNITION_MODAL_ID}_edit_`, ''))
      : null;

    if (editId) {
      const result = await getCollection('munitions').findOneAndUpdate(
        { _id: editId, guild_id: guildId },
        {
          $set: {
            nome: name,
            identificador: identifier,
            ativo: active,
            ordem: order,
            updated_at: now,
          },
        },
        { returnDocument: 'after' },
      );
      if (!result) return safeEdit(interaction, { content: 'Municao nao encontrada.' });
      munitionSelections.set(sessionKey(interaction), String(result._id));
      await insertOrderLog({
        guild_id: guildId,
        action: 'munition_updated',
        actor_id: getActor(interaction).id,
        actor_name: getActor(interaction).name,
        details: { source: 'discord', munition: name, identificador: identifier, ordem: order, ativo: active },
        created_at: now,
      }, null, await getSettings(guildId), interaction);
      return safeEdit(interaction, { content: `Municao ${name} atualizada.` });
    }

    const doc = {
      _id: new mongoose.Types.ObjectId(),
      guild_id: guildId,
      nome: name,
      identificador: identifier,
      ativo: active,
      ordem: order,
      created_at: now,
      updated_at: now,
    };
    await getCollection('munitions').insertOne(doc);
    munitionSelections.set(sessionKey(interaction), String(doc._id));
    await insertOrderLog({
      guild_id: guildId,
      action: 'munition_created',
      actor_id: getActor(interaction).id,
      actor_name: getActor(interaction).name,
      details: { source: 'discord', munition: name, identificador: identifier, ordem: order, ativo: active },
      created_at: now,
    }, null, await getSettings(guildId), interaction);
    return safeEdit(interaction, { content: `Municao ${name} cadastrada.` });
  }

  if (String(interaction.customId || '').startsWith(`${FAMILY_VALUES_MODAL_ID}_`)) {
    if (!hasOrderManagerPermission(interaction.member)) return safeReply(interaction, { content: 'Sem permissao.', ephemeral: true });
    const { familyId, page } = parseFamilyValuesModalId(interaction.customId);
    const id = objectId(familyId);
    const guildId = getGuildId(interaction);
    const family = id ? await getCollection('order_families').findOne({ _id: id, guild_id: guildId }) : null;
    if (!family) return safeReply(interaction, { content: 'Familia nao encontrada.', ephemeral: true });

    const munitions = await listMunitions(guildId, false);
    const pageItems = familyValuesPageItems(munitions, page);
    const currentPrices = familyMunitionUnitPrices(family, munitions);
    const nextPrices = { ...currentPrices };
    const errors = [];

    for (const item of pageItems) {
      const rawValue = modalTextValue(interaction.fields, `${FAMILY_MUNITION_PRICES_FIELD}_${item.key}`);
      const parsed = parseMoney(rawValue, 0);
      if (parsed === null) {
        errors.push(item.label);
        continue;
      }
      nextPrices[item.key] = cents(parsed || 0);
    }

    if (errors.length) {
      return safeReply(interaction, { content: `Valores invalidos: ${errors.join(', ')}. Use apenas numeros.`, ephemeral: true });
    }

    await getCollection('order_families').updateOne(
      { _id: family._id, guild_id: guildId },
      { $set: { munition_unit_prices: nextPrices, updated_at: new Date() } },
    );

    if (hasFamilyValuesNextPage(munitions, page)) {
      const updatedFamily = await getCollection('order_families').findOne({ _id: family._id, guild_id: guildId });
      return safeShowModal(interaction, buildFamilyValuesModal(updatedFamily, munitions, page + 1));
    }

    familySelections.set(sessionKey(interaction), String(family._id));
    return safeReply(interaction, { content: `Valores das municoes de ${family.name} atualizados.`, ephemeral: true });
  }

  if (interaction.customId === ORDER_DISCOUNT_MODAL_ID) {
    if (!hasOrderManagerPermission(interaction.member)) return safeReply(interaction, { content: 'Sem permissao.', ephemeral: true });
    await safeDeferReply(interaction, { ephemeral: true });
    const guildId = getGuildId(interaction);
    const rawPercentage = modalTextValue(interaction.fields, ORDER_DISCOUNT_PERCENT_FIELD);
    const percentage = parsePercentage(rawPercentage, null);
    if (percentage === null) {
      return safeEdit(interaction, { content: 'Desconto invalido. Use apenas numeros de 0 a 100.' });
    }

    const now = new Date();
    await getCollection('order_settings').updateOne(
      { guild_id: guildId },
      {
        $set: {
          guild_id: guildId,
          default_discount_percentage: percentage,
          order_default_discount_percentage: percentage,
          updated_at: now,
        },
        $setOnInsert: { created_at: now },
      },
      { upsert: true },
    );
    await getCollection('order_families').updateMany(
      { guild_id: guildId },
      { $set: { default_discount_percentage: percentage, updated_at: now } },
    );
    await insertOrderLog({
      guild_id: guildId,
      action: 'default_discount_updated',
      actor_id: getActor(interaction).id,
      actor_name: getActor(interaction).name,
      details: { source: 'discord', percentage },
      created_at: now,
    }, null, await getSettings(guildId), interaction);

    return safeEdit(interaction, { content: `Desconto das encomendas atualizado para ${percentage}%.` });
  }

  if (interaction.customId === 'modal_order_family_create' || interaction.customId.startsWith('modal_order_family_edit_')) {
    if (!hasOrderManagerPermission(interaction.member)) return safeReply(interaction, { content: 'Sem permissao.', ephemeral: true });
    await safeDeferReply(interaction, { ephemeral: true });
    const guildId = getGuildId(interaction);
    const actor = getActor(interaction);
    const now = new Date();
    const settings = await getSettings(guildId);
    const name = interaction.fields.getTextInputValue('name').trim().slice(0, 80);
    const leaderText = interaction.fields.getTextInputValue('leader').trim();
    const leaderId = '';
    const leaderName = leaderText;
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
        details: { source: 'discord', fields: ['name', 'leaderName'] },
        created_at: now,
      }, result, await getSettings(guildId), interaction);
      return safeEdit(interaction, { content: `Familia ${result.name} atualizada.` });
    }

    const doc = {
      _id: new mongoose.Types.ObjectId(),
      guild_id: guildId,
      name,
      slug: createSlug(name),
      leader_id: leaderId || null,
      leader_name: leaderName || null,
      color: '#0EA5E9',
      icon: ORDER_PANEL_EMOJI,
      log_webhook_url: null,
      members: [],
      munition_unit_prices: {},
      default_discount_percentage: settingsDefaultDiscountPercentage(settings),
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
      details: { source: 'discord', fields: ['name', 'leaderName'] },
      created_at: now,
    }, doc, await getSettings(guildId), interaction);
    return safeEdit(interaction, { content: `Familia ${doc.name} criada.` });
  }

  const cancelId = parseOrderId(interaction.customId, 'modal_order_cancel_');
  if (cancelId) {
    if (!hasOrderManagerPermission(interaction.member)) return safeReply(interaction, { content: 'Sem permissao.', ephemeral: true });
    await safeDeferReply(interaction, { ephemeral: true });
    const reason = interaction.fields.getTextInputValue('reason').trim();
    const result = await updateOrderStatus(interaction, cancelId, 'cancelled', reason);
    if (result.ok) scheduleFinalizedOrderChannelDelete(interaction, result.order);
    return safeEdit(interaction, { content: result.ok ? `Pedido #${result.order.order_number} marcado como nao entregue.` : result.message });
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
