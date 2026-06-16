import { ObjectId } from 'mongodb';
import { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { collection, serializeDoc } from '../db.js';
import { env } from '../env.js';

const DISCORD_API = 'https://discord.com/api/v10';
const CHANNEL_TYPE_TEXT = 0;
const CHANNEL_TYPE_CATEGORY = 4;
const PERMISSION_VIEW_CHANNEL = 1n << 10n;
const PERMISSION_SEND_MESSAGES = 1n << 11n;
const PERMISSION_MANAGE_CHANNELS = 1n << 4n;
const PERMISSION_MANAGE_MESSAGES = 1n << 13n;

type OrderSettingsDoc = {
  _id?: ObjectId;
  guild_id: string;
  order_category_id: string | null;
  created_at: Date;
  updated_at: Date;
  updated_by_id?: string | null;
  updated_by_name?: string | null;
};

type OrderDoc = {
  _id?: ObjectId;
  guild_id: string;
  family_name: string;
  family_slug: string;
  ammo_name: string;
  quantity: number;
  unit_price_cents: number;
  original_value_cents: number;
  discount_percent: number;
  discount_value_cents: number;
  final_value_cents: number;
  status: 'pending' | 'delivered' | 'rejected';
  order_category_id: string;
  order_channel_id: string;
  order_message_id: string | null;
  created_by_id?: string | null;
  created_by_name?: string | null;
  decided_by_id?: string | null;
  decided_by_name?: string | null;
  rejection_reason?: string | null;
  closed_at?: Date | null;
  created_at: Date;
  updated_at: Date;
};

const discordId = z.string().trim().regex(/^\d{5,32}$/, 'ID do Discord invalido.');

const settingsSchema = z.object({
  guildId: discordId.optional(),
  orderCategoryId: discordId
});

const createOrderSchema = z.object({
  guildId: discordId.optional(),
  familyName: z.string().trim().min(2, 'Informe a familia.').max(80),
  ammoName: z.string().trim().min(2, 'Informe a municao.').max(80),
  quantity: z.coerce.number().int().positive('Quantidade precisa ser maior que zero.').max(1_000_000),
  unitPrice: z.coerce.number().nonnegative('Valor unitario invalido.').max(1_000_000),
  discountPercent: z.coerce.number().min(0).max(100).default(0)
});

function asyncRoute(handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    void handler(req, res, next).catch(next);
  };
}

function defaultGuildId(req: Request) {
  return String(req.query.guildId || req.body?.guildId || env.discordGuildId || process.env.GUILD_ID || 'global');
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

async function fetchDiscordCategories(guildId: string) {
  const channels = await discordRequest(`/guilds/${guildId}/channels`);
  return (Array.isArray(channels) ? channels : [])
    .filter((channel: any) => Number(channel.type) === CHANNEL_TYPE_CATEGORY)
    .sort((a: any, b: any) => Number(a.position || 0) - Number(b.position || 0))
    .map((channel: any) => ({
      id: String(channel.id),
      name: String(channel.name || 'categoria'),
      position: Number(channel.position || 0)
    }));
}

async function findDiscordCategory(guildId: string, categoryId: string) {
  const categories = await fetchDiscordCategories(guildId);
  return categories.find((category) => category.id === categoryId) || null;
}

let botUserCache: { token: string; id: string } | null = null;

async function getBotUserId() {
  const token = getDiscordToken();
  if (botUserCache?.token === token) return botUserCache.id;
  const user = await discordRequest('/users/@me');
  const id = String(user?.id || '');
  if (!id) throw new Error('Nao foi possivel identificar o bot no Discord.');
  botUserCache = { token, id };
  return id;
}

function createSlug(value: string) {
  const slug = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70);
  return slug || `familia-${Date.now()}`;
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

function normalizeSettings(doc: OrderSettingsDoc | null, category?: { id: string; name: string } | null) {
  return {
    guildId: doc?.guild_id || '',
    orderCategoryId: doc?.order_category_id || '',
    orderCategoryName: category?.name || null,
    updatedAt: doc?.updated_at || null,
    updatedById: doc?.updated_by_id || null,
    updatedByName: doc?.updated_by_name || null
  };
}

function normalizeOrder(doc: OrderDoc) {
  const row = serializeDoc(doc) as any;
  return {
    id: String(doc._id),
    guildId: doc.guild_id,
    familyName: doc.family_name,
    familySlug: doc.family_slug,
    ammoName: doc.ammo_name,
    quantity: doc.quantity,
    unitPrice: moneyFromCents(doc.unit_price_cents),
    originalValue: moneyFromCents(doc.original_value_cents),
    discountPercent: doc.discount_percent,
    discountValue: moneyFromCents(doc.discount_value_cents),
    finalValue: moneyFromCents(doc.final_value_cents),
    status: doc.status,
    orderCategoryId: doc.order_category_id,
    orderChannelId: doc.order_channel_id,
    orderMessageId: doc.order_message_id,
    createdById: doc.created_by_id || null,
    createdByName: doc.created_by_name || null,
    decidedById: doc.decided_by_id || null,
    decidedByName: doc.decided_by_name || null,
    rejectionReason: doc.rejection_reason || null,
    closedAt: row.closed_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function createDiscordOrderChannel(input: {
  guildId: string;
  categoryId: string;
  familyName: string;
  familySlug: string;
  orderId: string;
}) {
  const botUserId = await getBotUserId();
  const botAllow = (
    PERMISSION_VIEW_CHANNEL
    | PERMISSION_SEND_MESSAGES
    | PERMISSION_MANAGE_CHANNELS
    | PERMISSION_MANAGE_MESSAGES
  ).toString();

  const channel = await discordRequest(`/guilds/${input.guildId}/channels`, {
    method: 'POST',
    body: JSON.stringify({
      name: `pedido-${input.familySlug}`.slice(0, 100),
      type: CHANNEL_TYPE_TEXT,
      parent_id: input.categoryId,
      permission_overwrites: [
        {
          id: input.guildId,
          type: 0,
          deny: PERMISSION_SEND_MESSAGES.toString()
        },
        {
          id: botUserId,
          type: 1,
          allow: botAllow
        }
      ],
      reason: `Encomenda ${input.orderId} - ${input.familyName}`
    })
  });

  return {
    id: String(channel?.id || ''),
    name: String(channel?.name || `pedido-${input.familySlug}`)
  };
}

async function sendOrderPanel(channelId: string, order: OrderDoc) {
  const response = await discordRequest(`/channels/${channelId}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      embeds: [
        {
          color: 0x0ea5e9,
          title: 'Painel de Controle da Encomenda',
          description: [
            `Familia: **${order.family_name}**`,
            `Municao: **${order.ammo_name}**`,
            `Quantidade: **${order.quantity.toLocaleString('pt-BR')}**`,
            `Valor original: **${formatMoney(order.original_value_cents)}**`,
            `Desconto: **${order.discount_percent}%**`,
            `Valor final: **${formatMoney(order.final_value_cents)}**`,
            '',
            'Status atual: **Aguardando**'
          ].join('\n'),
          footer: { text: 'Vortex | Encomendas' },
          timestamp: new Date().toISOString()
        }
      ],
      components: [
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 2,
              custom_id: `order_waiting_${String(order._id)}`,
              label: 'Aguardando',
              disabled: true
            },
            {
              type: 2,
              style: 3,
              custom_id: `order_delivered_${String(order._id)}`,
              label: 'Entregue'
            },
            {
              type: 2,
              style: 4,
              custom_id: `order_rejected_${String(order._id)}`,
              label: 'Nao Entregue'
            }
          ]
        }
      ],
      allowed_mentions: { parse: [] }
    })
  });

  return String(response?.id || '');
}

async function orderStats(guildId: string) {
  const orders = await collection<OrderDoc>('orders');
  const [total, pending, delivered, rejected] = await Promise.all([
    orders.countDocuments({ guild_id: guildId }),
    orders.countDocuments({ guild_id: guildId, status: 'pending' }),
    orders.countDocuments({ guild_id: guildId, status: 'delivered' }),
    orders.countDocuments({ guild_id: guildId, status: 'rejected' })
  ]);
  return { total, pending, delivered, rejected };
}

export const ordersRouter = Router();

ordersRouter.get('/discord-options', asyncRoute(async (req, res) => {
  const guildId = defaultGuildId(req);
  try {
    return res.json({ ok: true, guildId, categories: await fetchDiscordCategories(guildId), error: null });
  } catch (error) {
    return res.json({
      ok: true,
      guildId,
      categories: [],
      error: error instanceof Error ? error.message : 'Falha ao carregar categorias do Discord.'
    });
  }
}));

ordersRouter.get('/settings', asyncRoute(async (req, res) => {
  const guildId = defaultGuildId(req);
  const settings = await collection<OrderSettingsDoc>('order_settings');
  const doc = await settings.findOne({ guild_id: guildId });
  let category = null;
  if (doc?.order_category_id) {
    category = await findDiscordCategory(guildId, doc.order_category_id).catch(() => null);
  }
  return res.json({ ok: true, settings: normalizeSettings(doc, category) });
}));

ordersRouter.put('/settings', asyncRoute(async (req, res) => {
  const input = settingsSchema.parse(req.body);
  const guildId = input.guildId || defaultGuildId(req);
  const category = await findDiscordCategory(guildId, input.orderCategoryId).catch((error) => {
    throw new Error(error instanceof Error ? error.message : 'Falha ao validar categoria no Discord.');
  });
  if (!category) {
    return res.status(400).json({ ok: false, error: 'Selecione uma categoria valida do servidor.' });
  }

  const now = new Date();
  const settings = await collection<OrderSettingsDoc>('order_settings');
  const result = await settings.findOneAndUpdate(
    { guild_id: guildId },
    {
      $set: {
        order_category_id: input.orderCategoryId,
        updated_at: now,
        updated_by_id: req.user?.discordId || req.user?.id || null,
        updated_by_name: req.user?.name || null
      },
      $setOnInsert: {
        guild_id: guildId,
        created_at: now
      }
    },
    { upsert: true, returnDocument: 'after' }
  );

  return res.json({ ok: true, settings: normalizeSettings(result, category) });
}));

ordersRouter.get('/', asyncRoute(async (req, res) => {
  const guildId = defaultGuildId(req);
  const rows = await (await collection<OrderDoc>('orders'))
    .find({ guild_id: guildId })
    .sort({ created_at: -1 })
    .limit(100)
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
  const settings = await (await collection<OrderSettingsDoc>('order_settings')).findOne({ guild_id: guildId });
  if (!settings?.order_category_id) {
    return res.status(409).json({
      ok: false,
      error: 'Configure a categoria das encomendas antes de criar pedidos.'
    });
  }

  const category = await findDiscordCategory(guildId, settings.order_category_id).catch(() => null);
  if (!category) {
    return res.status(400).json({
      ok: false,
      error: 'A categoria configurada nao existe mais no servidor. Escolha outra categoria.'
    });
  }

  const orderId = new ObjectId();
  const familySlug = createSlug(input.familyName);
  const unitPriceCents = cents(input.unitPrice);
  const originalValueCents = unitPriceCents * input.quantity;
  const discountValueCents = Math.round(originalValueCents * (input.discountPercent / 100));
  const finalValueCents = Math.max(0, originalValueCents - discountValueCents);
  const channel = await createDiscordOrderChannel({
    guildId,
    categoryId: category.id,
    familyName: input.familyName,
    familySlug,
    orderId: String(orderId)
  });

  if (!channel.id) {
    return res.status(502).json({ ok: false, error: 'Discord nao retornou o canal criado.' });
  }

  const now = new Date();
  const doc: OrderDoc = {
    _id: orderId,
    guild_id: guildId,
    family_name: input.familyName,
    family_slug: familySlug,
    ammo_name: input.ammoName,
    quantity: input.quantity,
    unit_price_cents: unitPriceCents,
    original_value_cents: originalValueCents,
    discount_percent: input.discountPercent,
    discount_value_cents: discountValueCents,
    final_value_cents: finalValueCents,
    status: 'pending',
    order_category_id: category.id,
    order_channel_id: channel.id,
    order_message_id: null,
    created_by_id: req.user?.discordId || req.user?.id || null,
    created_by_name: req.user?.name || null,
    created_at: now,
    updated_at: now
  };

  doc.order_message_id = await sendOrderPanel(channel.id, doc).catch((error) => {
    console.warn('[frequency-api] Falha ao enviar painel da encomenda:', error);
    return null;
  });

  await (await collection<OrderDoc>('orders')).insertOne(doc);
  await (await collection('order_logs')).insertOne({
    guild_id: guildId,
    order_id: String(orderId),
    action: 'created',
    actor_id: req.user?.discordId || req.user?.id || null,
    actor_name: req.user?.name || null,
    channel_id: channel.id,
    category_id: category.id,
    created_at: now
  });

  return res.status(201).json({ ok: true, order: normalizeOrder(doc), channel });
}));
