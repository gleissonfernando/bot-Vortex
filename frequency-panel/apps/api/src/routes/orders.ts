import { ObjectId, type Filter } from 'mongodb';
import { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { collection, serializeDoc } from '../db.js';
import { env } from '../env.js';
import { publishDashboardEvent } from '../events.js';

const DISCORD_API = 'https://discord.com/api/v10';
const CHANNEL_TYPE_TEXT = 0;
const CHANNEL_TYPE_CATEGORY = 4;
const ORDER_NUMBER_OFFSET = 3846;

const orderStatuses = ['pending', 'separating', 'transport', 'delivered', 'cancelled'] as const;
const itemCategories = ['munitions', 'weapons', 'general', 'drugs', 'custom'] as const;

type OrderStatus = typeof orderStatuses[number];
type ItemCategory = typeof itemCategories[number];

type OrderSettingsDoc = {
  _id?: ObjectId;
  guild_id: string;
  order_category_id?: string | null;
  order_channel_id?: string | null;
  default_logs_webhook_url?: string | null;
  created_at: Date;
  updated_at: Date;
  updated_by_id?: string | null;
  updated_by_name?: string | null;
};

type OrderFamilyDoc = {
  _id?: ObjectId;
  guild_id: string;
  name: string;
  slug: string;
  leader_id?: string | null;
  leader_name?: string | null;
  color: string;
  icon: string;
  log_webhook_url?: string | null;
  members: Array<{ discord_id: string; name?: string | null }>;
  active: boolean;
  created_by_id?: string | null;
  created_by_name?: string | null;
  created_at: Date;
  updated_at: Date;
};

type InventoryItemDoc = {
  _id?: ObjectId;
  guild_id: string;
  name: string;
  slug: string;
  category: ItemCategory;
  quantity_available: number;
  unit_price_cents: number;
  active: boolean;
  created_at: Date;
  updated_at: Date;
};

type OrderLineItem = {
  inventory_item_id?: string | null;
  name: string;
  category: ItemCategory;
  quantity: number;
  unit_price_cents: number;
  total_value_cents: number;
};

type OrderDoc = {
  _id?: ObjectId;
  order_number: number;
  guild_id: string;
  family_id: string;
  family_name: string;
  family_slug: string;
  family_color: string;
  family_icon: string;
  responsible_id?: string | null;
  responsible_name?: string | null;
  items: OrderLineItem[];
  total_value_cents: number;
  status: OrderStatus;
  stock_applied: boolean;
  stock_restored: boolean;
  approval_channel_id?: string | null;
  approval_message_id?: string | null;
  created_by_id?: string | null;
  created_by_name?: string | null;
  decided_by_id?: string | null;
  decided_by_name?: string | null;
  cancellation_reason?: string | null;
  delivered_by_id?: string | null;
  delivered_by_name?: string | null;
  received_by_id?: string | null;
  received_by_name?: string | null;
  source: 'web' | 'discord';
  created_at: Date;
  updated_at: Date;
  closed_at?: Date | null;
};

type OrderLogDoc = {
  _id?: ObjectId;
  guild_id: string;
  order_id?: string | null;
  order_number?: number | null;
  family_id?: string | null;
  family_name?: string | null;
  action: string;
  actor_id?: string | null;
  actor_name?: string | null;
  details?: Record<string, unknown>;
  created_at: Date;
};

type FavoriteOrderDoc = {
  _id?: ObjectId;
  guild_id: string;
  family_id: string;
  family_name: string;
  name: string;
  items: OrderLineItem[];
  created_by_id?: string | null;
  created_by_name?: string | null;
  created_at: Date;
  updated_at: Date;
};

const discordId = z.string().trim().regex(/^\d{5,32}$/, 'ID do Discord invalido.');
const objectIdSchema = z.string().trim().refine((value) => ObjectId.isValid(value), 'ID invalido.');
const optionalDiscordId = z.string().trim().regex(/^\d{5,32}$/, 'ID do Discord invalido.').optional().or(z.literal(''));
const urlSchema = z.string().trim().url('Webhook invalido.').optional().or(z.literal(''));
const colorSchema = z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Cor precisa estar no formato #RRGGBB.');

const settingsSchema = z.object({
  guildId: discordId.optional(),
  orderCategoryId: discordId.optional().or(z.literal('')),
  orderChannelId: discordId.optional().or(z.literal('')),
  defaultLogsWebhookUrl: urlSchema
});

const familySchema = z.object({
  guildId: discordId.optional(),
  name: z.string().trim().min(2, 'Informe o nome da familia.').max(80),
  leaderId: optionalDiscordId,
  leaderName: z.string().trim().max(80).optional().or(z.literal('')),
  color: colorSchema.default('#0EA5E9'),
  icon: z.string().trim().max(32).default('📦'),
  logWebhookUrl: urlSchema,
  active: z.boolean().default(true),
  members: z.array(z.object({
    discordId: discordId,
    name: z.string().trim().max(80).optional().or(z.literal(''))
  })).default([])
});

const inventorySchema = z.object({
  guildId: discordId.optional(),
  name: z.string().trim().min(2, 'Informe o nome do item.').max(100),
  category: z.enum(itemCategories).default('general'),
  quantityAvailable: z.coerce.number().int().min(0).max(100_000_000),
  unitPrice: z.coerce.number().min(0).max(1_000_000_000),
  active: z.boolean().default(true)
});

const orderLineSchema = z.object({
  inventoryItemId: objectIdSchema.optional().or(z.literal('')),
  name: z.string().trim().max(100).optional().or(z.literal('')),
  category: z.enum(itemCategories).default('custom'),
  quantity: z.coerce.number().int().positive('Quantidade precisa ser maior que zero.').max(100_000_000),
  unitPrice: z.coerce.number().min(0).max(1_000_000_000).optional()
});

const createOrderSchema = z.object({
  guildId: discordId.optional(),
  familyId: objectIdSchema,
  responsibleId: optionalDiscordId,
  responsibleName: z.string().trim().max(80).optional().or(z.literal('')),
  items: z.array(orderLineSchema).min(1, 'Adicione pelo menos um item ao carrinho.').max(40),
  saveAsFavorite: z.boolean().default(false),
  favoriteName: z.string().trim().max(80).optional().or(z.literal(''))
});

const updateStatusSchema = z.object({
  status: z.enum(orderStatuses),
  reason: z.string().trim().max(600).optional().or(z.literal('')),
  receivedById: optionalDiscordId,
  receivedByName: z.string().trim().max(80).optional().or(z.literal(''))
});

const favoriteSchema = z.object({
  guildId: discordId.optional(),
  familyId: objectIdSchema,
  name: z.string().trim().min(2, 'Informe um nome para o modelo.').max(80),
  items: z.array(orderLineSchema).min(1).max(40)
});

function asyncRoute(handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    void handler(req, res, next).catch(next);
  };
}

function defaultGuildId(req: Request) {
  return String(req.query.guildId || req.body?.guildId || env.discordGuildId || process.env.GUILD_ID || 'global');
}

function objectIdParam(req: Request, name = 'id') {
  const value = req.params[name];
  return new ObjectId(Array.isArray(value) ? value[0] : value);
}

function getActor(req: Request) {
  return {
    id: req.user?.discordId || req.user?.id || null,
    name: req.user?.name || req.user?.email || null
  };
}

function getDiscordToken() {
  return env.discordBotToken || process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN || '';
}

async function discordRequest(path: string, init: RequestInit = {}) {
  const token = getDiscordToken();
  if (!token) throw new Error('DISCORD_TOKEN/DISCORD_BOT_TOKEN ausente.');

  const response = await fetch(`${DISCORD_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {})
    }
  });

  if (!response.ok) {
    const details = await response.text().catch(() => '');
    throw new Error(`Discord HTTP ${response.status}${details ? `: ${details.slice(0, 180)}` : ''}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

async function fetchDiscordChannels(guildId: string) {
  const channels = await discordRequest(`/guilds/${guildId}/channels`);
  const rows = Array.isArray(channels) ? channels : [];
  return {
    categories: rows
      .filter((channel: any) => Number(channel.type) === CHANNEL_TYPE_CATEGORY)
      .sort((a: any, b: any) => Number(a.position || 0) - Number(b.position || 0))
      .map((channel: any) => ({
        id: String(channel.id),
        name: String(channel.name || 'categoria'),
        position: Number(channel.position || 0)
      })),
    textChannels: rows
      .filter((channel: any) => Number(channel.type) === CHANNEL_TYPE_TEXT)
      .sort((a: any, b: any) => Number(a.position || 0) - Number(b.position || 0))
      .map((channel: any) => ({
        id: String(channel.id),
        name: String(channel.name || 'canal'),
        parentId: channel.parent_id ? String(channel.parent_id) : null,
        position: Number(channel.position || 0)
      }))
  };
}

function createSlug(value: string) {
  const slug = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70);
  return slug || `item-${Date.now()}`;
}

function cents(value: number) {
  return Math.max(0, Math.round(Number(value || 0) * 100));
}

function moneyFromCents(value: number) {
  return Math.round(Number(value || 0)) / 100;
}

function formatMoney(valueCents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(moneyFromCents(valueCents));
}

function statusLabel(status: OrderStatus) {
  const labels: Record<OrderStatus, string> = {
    pending: 'Pendente',
    separating: 'Em Separacao',
    transport: 'Em Transporte',
    delivered: 'Entregue',
    cancelled: 'Cancelado'
  };
  return labels[status] || status;
}

function categoryLabel(category: ItemCategory) {
  const labels: Record<ItemCategory, string> = {
    munitions: 'Municoes',
    weapons: 'Armas',
    general: 'Itens Gerais',
    drugs: 'Drogas',
    custom: 'Personalizado'
  };
  return labels[category] || category;
}

function normalizeSettings(doc: OrderSettingsDoc | null, channels?: Awaited<ReturnType<typeof fetchDiscordChannels>> | null) {
  const category = channels?.categories.find((item) => item.id === doc?.order_category_id) || null;
  const orderChannel = channels?.textChannels.find((item) => item.id === doc?.order_channel_id) || null;
  return {
    guildId: doc?.guild_id || '',
    orderCategoryId: doc?.order_category_id || '',
    orderCategoryName: category?.name || null,
    orderChannelId: doc?.order_channel_id || '',
    orderChannelName: orderChannel?.name || null,
    defaultLogsWebhookUrl: doc?.default_logs_webhook_url || '',
    updatedAt: doc?.updated_at || null,
    updatedById: doc?.updated_by_id || null,
    updatedByName: doc?.updated_by_name || null
  };
}

function normalizeFamily(doc: OrderFamilyDoc) {
  const row = serializeDoc(doc) as any;
  return {
    id: String(doc._id),
    guildId: doc.guild_id,
    name: doc.name,
    slug: doc.slug,
    leaderId: doc.leader_id || '',
    leaderName: doc.leader_name || '',
    color: doc.color,
    icon: doc.icon,
    logWebhookUrl: doc.log_webhook_url || '',
    members: doc.members || [],
    active: doc.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizeInventoryItem(doc: InventoryItemDoc) {
  const row = serializeDoc(doc) as any;
  return {
    id: String(doc._id),
    guildId: doc.guild_id,
    name: doc.name,
    slug: doc.slug,
    category: doc.category,
    categoryLabel: categoryLabel(doc.category),
    quantityAvailable: doc.quantity_available,
    unitPrice: moneyFromCents(doc.unit_price_cents),
    active: doc.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizeOrder(doc: OrderDoc) {
  const row = serializeDoc(doc) as any;
  return {
    id: String(doc._id),
    orderNumber: doc.order_number,
    guildId: doc.guild_id,
    familyId: doc.family_id,
    familyName: doc.family_name,
    familySlug: doc.family_slug,
    familyColor: doc.family_color,
    familyIcon: doc.family_icon,
    responsibleId: doc.responsible_id || '',
    responsibleName: doc.responsible_name || '',
    items: doc.items.map((item) => ({
      inventoryItemId: item.inventory_item_id || '',
      name: item.name,
      category: item.category,
      categoryLabel: categoryLabel(item.category),
      quantity: item.quantity,
      unitPrice: moneyFromCents(item.unit_price_cents),
      totalValue: moneyFromCents(item.total_value_cents)
    })),
    totalValue: moneyFromCents(doc.total_value_cents),
    status: doc.status,
    statusLabel: statusLabel(doc.status),
    stockApplied: doc.stock_applied,
    stockRestored: doc.stock_restored,
    approvalChannelId: doc.approval_channel_id || '',
    approvalMessageId: doc.approval_message_id || '',
    createdById: doc.created_by_id || '',
    createdByName: doc.created_by_name || '',
    decidedById: doc.decided_by_id || '',
    decidedByName: doc.decided_by_name || '',
    cancellationReason: doc.cancellation_reason || '',
    deliveredById: doc.delivered_by_id || '',
    deliveredByName: doc.delivered_by_name || '',
    receivedById: doc.received_by_id || '',
    receivedByName: doc.received_by_name || '',
    source: doc.source,
    closedAt: row.closed_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizeLog(doc: OrderLogDoc) {
  const row = serializeDoc(doc) as any;
  return {
    id: String(doc._id),
    guildId: doc.guild_id,
    orderId: doc.order_id || '',
    orderNumber: doc.order_number || null,
    familyId: doc.family_id || '',
    familyName: doc.family_name || '',
    action: doc.action,
    actorId: doc.actor_id || '',
    actorName: doc.actor_name || '',
    details: doc.details || {},
    createdAt: row.created_at
  };
}

function normalizeFavorite(doc: FavoriteOrderDoc) {
  const row = serializeDoc(doc) as any;
  return {
    id: String(doc._id),
    guildId: doc.guild_id,
    familyId: doc.family_id,
    familyName: doc.family_name,
    name: doc.name,
    items: doc.items.map((item) => ({
      inventoryItemId: item.inventory_item_id || '',
      name: item.name,
      category: item.category,
      categoryLabel: categoryLabel(item.category),
      quantity: item.quantity,
      unitPrice: moneyFromCents(item.unit_price_cents),
      totalValue: moneyFromCents(item.total_value_cents)
    })),
    createdById: doc.created_by_id || '',
    createdByName: doc.created_by_name || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function nextOrderNumber(guildId: string) {
  const counters = await collection('order_counters');
  const result = await counters.findOneAndUpdate(
    { guild_id: guildId, key: 'orders' },
    { $inc: { seq: 1 }, $setOnInsert: { guild_id: guildId, key: 'orders', created_at: new Date() } },
    { upsert: true, returnDocument: 'after' }
  );
  return ORDER_NUMBER_OFFSET + Number((result as any)?.seq || 1);
}

async function buildOrderItems(guildId: string, requested: z.infer<typeof orderLineSchema>[]) {
  const inventory = await collection<InventoryItemDoc>('order_inventory');
  const ids = requested
    .map((item) => item.inventoryItemId)
    .filter((value): value is string => Boolean(value && ObjectId.isValid(value)));
  const stockItems = ids.length
    ? await inventory.find({ guild_id: guildId, _id: { $in: ids.map((id) => new ObjectId(id)) } }).toArray()
    : [];
  const stockById = new Map(stockItems.map((item) => [String(item._id), item]));

  const items: OrderLineItem[] = [];
  for (const input of requested) {
    const stockItem = input.inventoryItemId ? stockById.get(input.inventoryItemId) : null;
    if (input.inventoryItemId && !stockItem) {
      throw new Error('Um item selecionado nao existe mais no estoque.');
    }
    if (stockItem && !stockItem.active) {
      throw new Error(`${stockItem.name} esta desativado no estoque.`);
    }
    if (stockItem && stockItem.quantity_available < input.quantity) {
      throw new Error(`${stockItem.name} nao possui estoque suficiente. Disponivel: ${stockItem.quantity_available}.`);
    }

    const name = stockItem?.name || String(input.name || 'Item personalizado').trim();
    if (!name || name.length < 2) throw new Error('Informe o nome do item personalizado.');
    const category = stockItem?.category || input.category || 'custom';
    const unitPriceCents = stockItem ? stockItem.unit_price_cents : cents(Number(input.unitPrice || 0));
    items.push({
      inventory_item_id: stockItem?._id ? String(stockItem._id) : null,
      name,
      category,
      quantity: input.quantity,
      unit_price_cents: unitPriceCents,
      total_value_cents: unitPriceCents * input.quantity
    });
  }

  return items;
}

async function applyStockDelta(guildId: string, items: OrderLineItem[], direction: -1 | 1) {
  const operations = items
    .filter((item) => item.inventory_item_id && ObjectId.isValid(item.inventory_item_id))
    .map((item) => ({
      updateOne: {
        filter: { _id: new ObjectId(item.inventory_item_id as string), guild_id: guildId },
        update: { $inc: { quantity_available: direction * item.quantity }, $set: { updated_at: new Date() } }
      }
    }));
  if (!operations.length) return;
  await (await collection<InventoryItemDoc>('order_inventory')).bulkWrite(operations);
}

function buildDiscordOrderPayload(order: OrderDoc) {
  const items = order.items.map((item) => `${item.quantity.toLocaleString('pt-BR')}x ${item.name}`).join('\n');
  return {
    embeds: [
      {
        color: Number.parseInt(order.family_color.replace('#', ''), 16) || 0x0ea5e9,
        title: `📦 Nova Encomenda #${order.order_number}`,
        description: [
          `**Familia:** ${order.family_icon || '📦'} ${order.family_name}`,
          `**Solicitante:** ${order.responsible_name || order.created_by_name || 'N/A'}`,
          '',
          '**Itens:**',
          items || 'Nenhum item',
          '',
          `**Valor Total:** ${formatMoney(order.total_value_cents)}`,
          `**Status:** ${statusLabel(order.status)}`,
          `**Data:** ${new Date(order.created_at).toLocaleDateString('pt-BR')}`
        ].join('\n'),
        footer: { text: 'Vortex | Sistema de Encomendas V2' },
        timestamp: new Date(order.created_at).toISOString()
      }
    ],
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 3,
            custom_id: `order_approve_${String(order._id)}`,
            label: 'Aprovar',
            disabled: order.status !== 'pending'
          },
          {
            type: 2,
            style: 4,
            custom_id: `order_cancel_${String(order._id)}`,
            label: 'Recusar',
            disabled: ['cancelled', 'delivered'].includes(order.status)
          },
          {
            type: 2,
            style: 1,
            custom_id: `order_transport_${String(order._id)}`,
            label: 'Em Transporte',
            disabled: !['separating', 'pending'].includes(order.status)
          },
          {
            type: 2,
            style: 3,
            custom_id: `order_delivered_${String(order._id)}`,
            label: 'Entregue',
            disabled: order.status === 'delivered' || order.status === 'cancelled'
          }
        ]
      }
    ],
    allowed_mentions: { parse: [] }
  };
}

async function sendApprovalMessage(channelId: string, order: OrderDoc) {
  if (!channelId) return '';
  const response = await discordRequest(`/channels/${channelId}/messages`, {
    method: 'POST',
    body: JSON.stringify(buildDiscordOrderPayload(order))
  });
  return String(response?.id || '');
}

async function editApprovalMessage(order: OrderDoc) {
  if (!order.approval_channel_id || !order.approval_message_id) return;
  await discordRequest(`/channels/${order.approval_channel_id}/messages/${order.approval_message_id}`, {
    method: 'PATCH',
    body: JSON.stringify(buildDiscordOrderPayload(order))
  }).catch(() => null);
}

async function sendWebhookLog(webhookUrl: string | null | undefined, log: OrderLogDoc) {
  if (!webhookUrl) return;
  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      embeds: [
        {
          color: 0x0ea5e9,
          title: `Logs de Encomenda${log.order_number ? ` #${log.order_number}` : ''}`,
          description: [
            log.family_name ? `**Familia:** ${log.family_name}` : null,
            `**Acao:** ${log.action}`,
            log.actor_name ? `**Por:** ${log.actor_name}` : null,
            log.details ? `**Detalhes:** \`${JSON.stringify(log.details).slice(0, 900)}\`` : null
          ].filter(Boolean).join('\n'),
          timestamp: log.created_at.toISOString()
        }
      ],
      allowed_mentions: { parse: [] }
    })
  }).catch(() => null);
}

async function insertOrderLog(log: OrderLogDoc, family?: OrderFamilyDoc | null, settings?: OrderSettingsDoc | null) {
  await (await collection<OrderLogDoc>('order_logs')).insertOne(log);
  await sendWebhookLog(family?.log_webhook_url || settings?.default_logs_webhook_url, log);
  publishDashboardEvent({ type: 'orders.updated', payload: { guildId: log.guild_id, action: log.action } });
}

function buildOrderFilter(req: Request, guildId: string): Filter<OrderDoc> {
  const filter: Filter<OrderDoc> = { guild_id: guildId };
  const status = String(req.query.status || '').trim();
  const familyId = String(req.query.familyId || '').trim();
  const responsible = String(req.query.responsible || '').trim();
  const item = String(req.query.item || '').trim().toLowerCase();
  const dateFrom = String(req.query.dateFrom || '').trim();
  const dateTo = String(req.query.dateTo || '').trim();

  if (orderStatuses.includes(status as OrderStatus)) filter.status = status as OrderStatus;
  if (familyId && ObjectId.isValid(familyId)) filter.family_id = familyId;
  if (responsible) {
    filter.$or = [
      { responsible_name: { $regex: responsible, $options: 'i' } },
      { responsible_id: responsible }
    ] as any;
  }
  if (item) filter['items.name' as keyof OrderDoc] = { $regex: item, $options: 'i' } as any;
  if (dateFrom || dateTo) {
    filter.created_at = {} as any;
    if (dateFrom) (filter.created_at as any).$gte = new Date(`${dateFrom}T00:00:00.000Z`);
    if (dateTo) (filter.created_at as any).$lte = new Date(`${dateTo}T23:59:59.999Z`);
  }

  return filter;
}

async function orderStats(guildId: string) {
  const [orders, families] = await Promise.all([
    collection<OrderDoc>('orders'),
    collection<OrderFamilyDoc>('order_families')
  ]);

  const [totalOrders, pending, delivered, totalFamilies, totals, ranking] = await Promise.all([
    orders.countDocuments({ guild_id: guildId }),
    orders.countDocuments({ guild_id: guildId, status: 'pending' }),
    orders.countDocuments({ guild_id: guildId, status: 'delivered' }),
    families.countDocuments({ guild_id: guildId, active: true }),
    orders.aggregate<{ _id: null; value: number }>([
      { $match: { guild_id: guildId, status: { $ne: 'cancelled' } } },
      { $group: { _id: null, value: { $sum: '$total_value_cents' } } }
    ]).toArray(),
    orders.aggregate<{ _id: string; familyName: string; total: number; value: number }>([
      { $match: { guild_id: guildId } },
      { $group: { _id: '$family_id', familyName: { $first: '$family_name' }, total: { $sum: 1 }, value: { $sum: '$total_value_cents' } } },
      { $sort: { value: -1, total: -1 } },
      { $limit: 10 }
    ]).toArray()
  ]);

  return {
    totalFamilies,
    totalOrders,
    pending,
    delivered,
    movedValue: moneyFromCents(totals[0]?.value || 0),
    ranking: ranking.map((item) => ({
      familyId: item._id,
      familyName: item.familyName,
      total: item.total,
      value: moneyFromCents(item.value)
    }))
  };
}

function csvCell(value: unknown) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function orderExportRows(orders: OrderDoc[]) {
  return orders.map((order) => ({
    id: `#${order.order_number}`,
    familia: order.family_name,
    responsavel: order.responsible_name || order.created_by_name || '',
    status: statusLabel(order.status),
    itens: order.items.map((item) => `${item.quantity}x ${item.name}`).join('; '),
    valor: moneyFromCents(order.total_value_cents),
    criado_em: order.created_at.toISOString()
  }));
}

function buildCsv(orders: OrderDoc[], delimiter = ',') {
  const rows = orderExportRows(orders);
  const headers = ['id', 'familia', 'responsavel', 'status', 'itens', 'valor', 'criado_em'];
  return [
    headers.map(csvCell).join(delimiter),
    ...rows.map((row) => headers.map((header) => csvCell((row as any)[header])).join(delimiter))
  ].join('\n');
}

function buildSimplePdf(lines: string[]) {
  const safeLines = lines.map((line) => line.replace(/[()\\]/g, '\\$&').slice(0, 110));
  const stream = [
    'BT',
    '/F1 10 Tf',
    '40 800 Td',
    ...safeLines.flatMap((line, index) => [
      index === 0 ? '' : '0 -14 Td',
      `(${line}) Tj`
    ]).filter(Boolean),
    'ET'
  ].join('\n');
  const objects = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj',
    '4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
    `5 0 obj << /Length ${Buffer.byteLength(stream)} >> stream\n${stream}\nendstream endobj`
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${object}\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, 'utf8');
}

export const ordersRouter = Router();

ordersRouter.get('/discord-options', asyncRoute(async (req, res) => {
  const guildId = defaultGuildId(req);
  try {
    return res.json({ ok: true, guildId, ...(await fetchDiscordChannels(guildId)), error: null });
  } catch (error) {
    return res.json({
      ok: true,
      guildId,
      categories: [],
      textChannels: [],
      error: error instanceof Error ? error.message : 'Falha ao carregar canais do Discord.'
    });
  }
}));

ordersRouter.get('/settings', asyncRoute(async (req, res) => {
  const guildId = defaultGuildId(req);
  const doc = await (await collection<OrderSettingsDoc>('order_settings')).findOne({ guild_id: guildId });
  const channels = await fetchDiscordChannels(guildId).catch(() => null);
  return res.json({ ok: true, settings: normalizeSettings(doc, channels) });
}));

ordersRouter.put('/settings', asyncRoute(async (req, res) => {
  const input = settingsSchema.parse(req.body);
  const guildId = input.guildId || defaultGuildId(req);
  const channels = await fetchDiscordChannels(guildId).catch(() => null);

  if (input.orderCategoryId && !channels?.categories.some((channel) => channel.id === input.orderCategoryId)) {
    return res.status(400).json({ ok: false, error: 'Selecione uma categoria valida do servidor.' });
  }
  if (input.orderChannelId && !channels?.textChannels.some((channel) => channel.id === input.orderChannelId)) {
    return res.status(400).json({ ok: false, error: 'Selecione um canal de encomendas valido.' });
  }

  const actor = getActor(req);
  const now = new Date();
  const result = await (await collection<OrderSettingsDoc>('order_settings')).findOneAndUpdate(
    { guild_id: guildId },
    {
      $set: {
        order_category_id: input.orderCategoryId || null,
        order_channel_id: input.orderChannelId || null,
        default_logs_webhook_url: input.defaultLogsWebhookUrl || null,
        updated_at: now,
        updated_by_id: actor.id,
        updated_by_name: actor.name
      },
      $setOnInsert: {
        guild_id: guildId,
        created_at: now
      }
    },
    { upsert: true, returnDocument: 'after' }
  );

  publishDashboardEvent({ type: 'orders.updated', payload: { guildId, action: 'settings' } });
  return res.json({ ok: true, settings: normalizeSettings(result, channels) });
}));

ordersRouter.get('/families', asyncRoute(async (req, res) => {
  const guildId = defaultGuildId(req);
  const includeInactive = String(req.query.includeInactive || '') === 'true';
  const filter: Filter<OrderFamilyDoc> = { guild_id: guildId };
  if (!includeInactive) filter.active = true;
  const rows = await (await collection<OrderFamilyDoc>('order_families'))
    .find(filter)
    .sort({ active: -1, name: 1 })
    .toArray();
  return res.json({ ok: true, guildId, families: rows.map(normalizeFamily) });
}));

ordersRouter.post('/families', asyncRoute(async (req, res) => {
  const input = familySchema.parse(req.body);
  const guildId = input.guildId || defaultGuildId(req);
  const actor = getActor(req);
  const now = new Date();
  const doc: OrderFamilyDoc = {
    _id: new ObjectId(),
    guild_id: guildId,
    name: input.name,
    slug: createSlug(input.name),
    leader_id: input.leaderId || null,
    leader_name: input.leaderName || null,
    color: input.color,
    icon: input.icon || '📦',
    log_webhook_url: input.logWebhookUrl || null,
    members: input.members.map((member) => ({ discord_id: member.discordId, name: member.name || null })),
    active: input.active,
    created_by_id: actor.id,
    created_by_name: actor.name,
    created_at: now,
    updated_at: now
  };

  await (await collection<OrderFamilyDoc>('order_families')).insertOne(doc);
  await insertOrderLog({
    guild_id: guildId,
    family_id: String(doc._id),
    family_name: doc.name,
    action: 'family_created',
    actor_id: actor.id,
    actor_name: actor.name,
    details: { leaderId: doc.leader_id, active: doc.active },
    created_at: now
  }, doc);

  return res.status(201).json({ ok: true, family: normalizeFamily(doc) });
}));

ordersRouter.put('/families/:id', asyncRoute(async (req, res) => {
  const input = familySchema.partial({ name: true }).parse(req.body);
  const guildId = input.guildId || defaultGuildId(req);
  const id = objectIdParam(req);
  const actor = getActor(req);
  const now = new Date();
  const update: Partial<OrderFamilyDoc> = {
    updated_at: now
  };
  if (input.name) {
    update.name = input.name;
    update.slug = createSlug(input.name);
  }
  if (input.leaderId !== undefined) update.leader_id = input.leaderId || null;
  if (input.leaderName !== undefined) update.leader_name = input.leaderName || null;
  if (input.color !== undefined) update.color = input.color;
  if (input.icon !== undefined) update.icon = input.icon || '📦';
  if (input.logWebhookUrl !== undefined) update.log_webhook_url = input.logWebhookUrl || null;
  if (input.active !== undefined) update.active = input.active;
  if (input.members !== undefined) update.members = input.members.map((member) => ({ discord_id: member.discordId, name: member.name || null }));

  const result = await (await collection<OrderFamilyDoc>('order_families')).findOneAndUpdate(
    { _id: id, guild_id: guildId },
    { $set: update },
    { returnDocument: 'after' }
  );
  if (!result) return res.status(404).json({ ok: false, error: 'Familia nao encontrada.' });

  await insertOrderLog({
    guild_id: guildId,
    family_id: String(result._id),
    family_name: result.name,
    action: 'family_updated',
    actor_id: actor.id,
    actor_name: actor.name,
    details: update as Record<string, unknown>,
    created_at: now
  }, result);

  return res.json({ ok: true, family: normalizeFamily(result) });
}));

ordersRouter.delete('/families/:id', asyncRoute(async (req, res) => {
  const guildId = defaultGuildId(req);
  const id = objectIdParam(req);
  const actor = getActor(req);
  const family = await (await collection<OrderFamilyDoc>('order_families')).findOne({ _id: id, guild_id: guildId });
  if (!family) return res.status(404).json({ ok: false, error: 'Familia nao encontrada.' });
  await (await collection<OrderFamilyDoc>('order_families')).deleteOne({ _id: id, guild_id: guildId });
  await insertOrderLog({
    guild_id: guildId,
    family_id: String(family._id),
    family_name: family.name,
    action: 'family_deleted',
    actor_id: actor.id,
    actor_name: actor.name,
    created_at: new Date()
  }, family);
  return res.json({ ok: true });
}));

ordersRouter.get('/inventory', asyncRoute(async (req, res) => {
  const guildId = defaultGuildId(req);
  const includeInactive = String(req.query.includeInactive || '') === 'true';
  const filter: Filter<InventoryItemDoc> = { guild_id: guildId };
  if (!includeInactive) filter.active = true;
  const rows = await (await collection<InventoryItemDoc>('order_inventory'))
    .find(filter)
    .sort({ category: 1, name: 1 })
    .toArray();
  return res.json({ ok: true, guildId, inventory: rows.map(normalizeInventoryItem) });
}));

ordersRouter.post('/inventory', asyncRoute(async (req, res) => {
  const input = inventorySchema.parse(req.body);
  const guildId = input.guildId || defaultGuildId(req);
  const now = new Date();
  const doc: InventoryItemDoc = {
    _id: new ObjectId(),
    guild_id: guildId,
    name: input.name,
    slug: createSlug(input.name),
    category: input.category,
    quantity_available: input.quantityAvailable,
    unit_price_cents: cents(input.unitPrice),
    active: input.active,
    created_at: now,
    updated_at: now
  };
  await (await collection<InventoryItemDoc>('order_inventory')).insertOne(doc);
  const actor = getActor(req);
  await insertOrderLog({
    guild_id: guildId,
    action: 'inventory_created',
    actor_id: actor.id,
    actor_name: actor.name,
    details: { item: doc.name, quantity: doc.quantity_available },
    created_at: now
  });
  return res.status(201).json({ ok: true, item: normalizeInventoryItem(doc) });
}));

ordersRouter.put('/inventory/:id', asyncRoute(async (req, res) => {
  const input = inventorySchema.partial({ name: true }).parse(req.body);
  const guildId = input.guildId || defaultGuildId(req);
  const id = objectIdParam(req);
  const update: Partial<InventoryItemDoc> = { updated_at: new Date() };
  if (input.name) {
    update.name = input.name;
    update.slug = createSlug(input.name);
  }
  if (input.category !== undefined) update.category = input.category;
  if (input.quantityAvailable !== undefined) update.quantity_available = input.quantityAvailable;
  if (input.unitPrice !== undefined) update.unit_price_cents = cents(input.unitPrice);
  if (input.active !== undefined) update.active = input.active;

  const result = await (await collection<InventoryItemDoc>('order_inventory')).findOneAndUpdate(
    { _id: id, guild_id: guildId },
    { $set: update },
    { returnDocument: 'after' }
  );
  if (!result) return res.status(404).json({ ok: false, error: 'Item de estoque nao encontrado.' });

  const actor = getActor(req);
  await insertOrderLog({
    guild_id: guildId,
    action: 'inventory_updated',
    actor_id: actor.id,
    actor_name: actor.name,
    details: { item: result.name },
    created_at: new Date()
  });
  return res.json({ ok: true, item: normalizeInventoryItem(result) });
}));

ordersRouter.delete('/inventory/:id', asyncRoute(async (req, res) => {
  const guildId = defaultGuildId(req);
  const id = objectIdParam(req);
  const result = await (await collection<InventoryItemDoc>('order_inventory')).findOneAndUpdate(
    { _id: id, guild_id: guildId },
    { $set: { active: false, updated_at: new Date() } },
    { returnDocument: 'after' }
  );
  if (!result) return res.status(404).json({ ok: false, error: 'Item de estoque nao encontrado.' });
  publishDashboardEvent({ type: 'orders.updated', payload: { guildId, action: 'inventory_deleted' } });
  return res.json({ ok: true, item: normalizeInventoryItem(result) });
}));

ordersRouter.get('/favorites', asyncRoute(async (req, res) => {
  const guildId = defaultGuildId(req);
  const familyId = String(req.query.familyId || '').trim();
  const filter: Filter<FavoriteOrderDoc> = { guild_id: guildId };
  if (familyId && ObjectId.isValid(familyId)) filter.family_id = familyId;
  const rows = await (await collection<FavoriteOrderDoc>('order_favorites'))
    .find(filter)
    .sort({ updated_at: -1 })
    .toArray();
  return res.json({ ok: true, guildId, favorites: rows.map(normalizeFavorite) });
}));

ordersRouter.post('/favorites', asyncRoute(async (req, res) => {
  const input = favoriteSchema.parse(req.body);
  const guildId = input.guildId || defaultGuildId(req);
  const family = await (await collection<OrderFamilyDoc>('order_families')).findOne({ _id: new ObjectId(input.familyId), guild_id: guildId });
  if (!family) return res.status(404).json({ ok: false, error: 'Familia nao encontrada.' });
  const actor = getActor(req);
  const now = new Date();
  const items = await buildOrderItems(guildId, input.items);
  const doc: FavoriteOrderDoc = {
    _id: new ObjectId(),
    guild_id: guildId,
    family_id: String(family._id),
    family_name: family.name,
    name: input.name,
    items,
    created_by_id: actor.id,
    created_by_name: actor.name,
    created_at: now,
    updated_at: now
  };
  await (await collection<FavoriteOrderDoc>('order_favorites')).insertOne(doc);
  await insertOrderLog({
    guild_id: guildId,
    family_id: String(family._id),
    family_name: family.name,
    action: 'favorite_saved',
    actor_id: actor.id,
    actor_name: actor.name,
    details: { name: doc.name, items: items.length },
    created_at: now
  }, family);
  return res.status(201).json({ ok: true, favorite: normalizeFavorite(doc) });
}));

ordersRouter.delete('/favorites/:id', asyncRoute(async (req, res) => {
  const guildId = defaultGuildId(req);
  const id = objectIdParam(req);
  await (await collection<FavoriteOrderDoc>('order_favorites')).deleteOne({ _id: id, guild_id: guildId });
  publishDashboardEvent({ type: 'orders.updated', payload: { guildId, action: 'favorite_deleted' } });
  return res.json({ ok: true });
}));

ordersRouter.get('/logs', asyncRoute(async (req, res) => {
  const guildId = defaultGuildId(req);
  const filter: Filter<OrderLogDoc> = { guild_id: guildId };
  const familyId = String(req.query.familyId || '').trim();
  const orderId = String(req.query.orderId || '').trim();
  if (familyId && ObjectId.isValid(familyId)) filter.family_id = familyId;
  if (orderId && ObjectId.isValid(orderId)) filter.order_id = orderId;
  const rows = await (await collection<OrderLogDoc>('order_logs'))
    .find(filter)
    .sort({ created_at: -1 })
    .limit(Math.min(Number(req.query.limit) || 200, 1000))
    .toArray();
  return res.json({ ok: true, guildId, logs: rows.map(normalizeLog) });
}));

ordersRouter.get('/export', asyncRoute(async (req, res) => {
  const guildId = defaultGuildId(req);
  const format = String(req.query.format || 'csv').toLowerCase();
  const rows = await (await collection<OrderDoc>('orders'))
    .find(buildOrderFilter(req, guildId))
    .sort({ created_at: -1 })
    .limit(5000)
    .toArray();

  if (format === 'pdf') {
    const lines = [
      'Relatorio de Encomendas Vortex',
      `Gerado em ${new Date().toLocaleString('pt-BR')}`,
      '',
      ...orderExportRows(rows).slice(0, 45).map((row) => `${row.id} | ${row.familia} | ${row.status} | R$ ${row.valor}`)
    ];
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="encomendas.pdf"');
    return res.send(buildSimplePdf(lines));
  }

  const delimiter = format === 'excel' ? '\t' : ',';
  res.setHeader('Content-Type', format === 'excel' ? 'application/vnd.ms-excel; charset=utf-8' : 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="encomendas.${format === 'excel' ? 'xls' : 'csv'}"`);
  return res.send(buildCsv(rows, delimiter));
}));

ordersRouter.get('/', asyncRoute(async (req, res) => {
  const guildId = defaultGuildId(req);
  const rows = await (await collection<OrderDoc>('orders'))
    .find(buildOrderFilter(req, guildId))
    .sort({ created_at: -1 })
    .limit(Math.min(Number(req.query.limit) || 150, 1000))
    .toArray();

  return res.json({
    ok: true,
    guildId,
    orders: rows.map(normalizeOrder),
    stats: await orderStats(guildId)
  });
}));

ordersRouter.post('/', asyncRoute(async (req, res) => {
  const input = createOrderSchema.parse(req.body);
  const guildId = input.guildId || defaultGuildId(req);
  const [families, settingsCollection] = await Promise.all([
    collection<OrderFamilyDoc>('order_families'),
    collection<OrderSettingsDoc>('order_settings')
  ]);
  const family = await families.findOne({ _id: new ObjectId(input.familyId), guild_id: guildId });
  if (!family || !family.active) return res.status(404).json({ ok: false, error: 'Familia ativa nao encontrada.' });

  const items = await buildOrderItems(guildId, input.items);
  const settings = await settingsCollection.findOne({ guild_id: guildId });
  const actor = getActor(req);
  const now = new Date();
  const orderId = new ObjectId();
  const doc: OrderDoc = {
    _id: orderId,
    order_number: await nextOrderNumber(guildId),
    guild_id: guildId,
    family_id: String(family._id),
    family_name: family.name,
    family_slug: family.slug,
    family_color: family.color,
    family_icon: family.icon,
    responsible_id: input.responsibleId || actor.id,
    responsible_name: input.responsibleName || actor.name,
    items,
    total_value_cents: items.reduce((total, item) => total + item.total_value_cents, 0),
    status: 'pending',
    stock_applied: true,
    stock_restored: false,
    approval_channel_id: settings?.order_channel_id || null,
    approval_message_id: null,
    created_by_id: actor.id,
    created_by_name: actor.name,
    source: 'web',
    created_at: now,
    updated_at: now
  };

  await applyStockDelta(guildId, items, -1);
  if (doc.approval_channel_id) {
    doc.approval_message_id = await sendApprovalMessage(doc.approval_channel_id, doc).catch(() => '');
  }
  await (await collection<OrderDoc>('orders')).insertOne(doc);

  await insertOrderLog({
    guild_id: guildId,
    order_id: String(orderId),
    order_number: doc.order_number,
    family_id: doc.family_id,
    family_name: doc.family_name,
    action: 'order_created',
    actor_id: actor.id,
    actor_name: actor.name,
    details: { items: items.length, totalValue: moneyFromCents(doc.total_value_cents) },
    created_at: now
  }, family, settings);

  for (const item of items) {
    await insertOrderLog({
      guild_id: guildId,
      order_id: String(orderId),
      order_number: doc.order_number,
      family_id: doc.family_id,
      family_name: doc.family_name,
      action: 'item_added',
      actor_id: actor.id,
      actor_name: actor.name,
      details: { item: item.name, quantity: item.quantity },
      created_at: now
    }, family, settings);
  }

  if (input.saveAsFavorite) {
    const favoriteName = input.favoriteName || `Modelo ${family.name}`;
    await (await collection<FavoriteOrderDoc>('order_favorites')).insertOne({
      _id: new ObjectId(),
      guild_id: guildId,
      family_id: String(family._id),
      family_name: family.name,
      name: favoriteName,
      items,
      created_by_id: actor.id,
      created_by_name: actor.name,
      created_at: now,
      updated_at: now
    });
  }

  return res.status(201).json({ ok: true, order: normalizeOrder(doc) });
}));

ordersRouter.patch('/:id/status', asyncRoute(async (req, res) => {
  const input = updateStatusSchema.parse(req.body);
  const guildId = defaultGuildId(req);
  const id = objectIdParam(req);
  const orders = await collection<OrderDoc>('orders');
  const order = await orders.findOne({ _id: id, guild_id: guildId });
  if (!order) return res.status(404).json({ ok: false, error: 'Pedido nao encontrado.' });

  const actor = getActor(req);
  const now = new Date();
  const update: Partial<OrderDoc> = {
    status: input.status,
    updated_at: now,
    decided_by_id: actor.id,
    decided_by_name: actor.name
  };
  if (input.status === 'cancelled') {
    update.cancellation_reason = input.reason || 'Cancelado pelo painel.';
    update.closed_at = now;
    if (order.stock_applied && !order.stock_restored) {
      await applyStockDelta(guildId, order.items, 1);
      update.stock_restored = true;
    }
  }
  if (input.status === 'delivered') {
    update.closed_at = now;
    update.delivered_by_id = actor.id;
    update.delivered_by_name = actor.name;
    update.received_by_id = input.receivedById || order.responsible_id || null;
    update.received_by_name = input.receivedByName || order.responsible_name || null;
  }

  const result = await orders.findOneAndUpdate(
    { _id: id, guild_id: guildId },
    { $set: update },
    { returnDocument: 'after' }
  );
  if (!result) return res.status(404).json({ ok: false, error: 'Pedido nao encontrado.' });

  const [family, settings] = await Promise.all([
    (await collection<OrderFamilyDoc>('order_families')).findOne({ _id: new ObjectId(result.family_id), guild_id: guildId }),
    (await collection<OrderSettingsDoc>('order_settings')).findOne({ guild_id: guildId })
  ]);
  await editApprovalMessage(result);
  await insertOrderLog({
    guild_id: guildId,
    order_id: String(result._id),
    order_number: result.order_number,
    family_id: result.family_id,
    family_name: result.family_name,
    action: input.status === 'cancelled' ? 'order_cancelled' : `status_${input.status}`,
    actor_id: actor.id,
    actor_name: actor.name,
    details: {
      status: statusLabel(input.status),
      reason: input.reason || null,
      receivedBy: update.received_by_name || null
    },
    created_at: now
  }, family, settings);

  return res.json({ ok: true, order: normalizeOrder(result) });
}));
