import { ObjectId } from 'mongodb';
import { Router } from 'express';
import { z } from 'zod';
import { collection, serializeDoc } from '../db.js';
import { env } from '../env.js';
import { publishDashboardEvent } from '../events.js';
const DISCORD_API = 'https://discord.com/api/v10';
const CHANNEL_TYPE_TEXT = 0;
const CHANNEL_TYPE_CATEGORY = 4;
const ORDER_NUMBER_OFFSET = 3846;
const orderStatuses = ['pending', 'separating', 'transport', 'delivered', 'cancelled'];
const itemCategories = ['munitions', 'weapons', 'general', 'drugs', 'custom'];
const currencies = ['BRL', 'USD'];
const defaultMunitions = [
    { nome: 'HK/MAG', identificador: 'hk_mag', ordem: 1 },
    { nome: 'TEC/FIVE', identificador: 'tec_five', ordem: 2 },
    { nome: 'MTAR/MP7', identificador: 'mtar_mp7', ordem: 3 },
    { nome: 'AK103', identificador: 'ak103', ordem: 4 },
    { nome: 'THOMPSON', identificador: 'thompson', ordem: 5 },
    { nome: 'G36', identificador: 'g36', ordem: 6 },
    { nome: 'FAL', identificador: 'fal', ordem: 7 },
    { nome: 'MUNICAO SNIPER', identificador: 'municao_sniper', ordem: 8 }
];
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
    leaderName: z.string().trim().max(80).default(''),
    orderChannelId: optionalDiscordId,
    responsibleRoleId: optionalDiscordId,
    color: colorSchema.default('#0EA5E9'),
    icon: z.string().trim().max(32).default('📦'),
    registeredAt: z.coerce.date().optional(),
    internalNotes: z.string().trim().max(1000).default('Sem observacoes.'),
    logWebhookUrl: urlSchema,
    munitionPrices: z.object({
        hk_mag: z.coerce.number().min(0).max(1_000_000_000).optional(),
        tec_five: z.coerce.number().min(0).max(1_000_000_000).optional(),
        mtar_mp7: z.coerce.number().min(0).max(1_000_000_000).optional()
    }).default({}),
    defaultDiscountPercentage: z.coerce.number().min(0).max(100).default(0),
    active: z.boolean().default(true),
    members: z.array(z.object({
        discordId: discordId,
        name: z.string().trim().max(80).optional().or(z.literal(''))
    })).default([])
});
const inventorySchema = z.object({
    guildId: discordId.optional(),
    name: z.string().trim().min(2, 'Informe o nome do item.').max(100),
    category: z.enum(itemCategories).default('munitions'),
    quantityAvailable: z.coerce.number().int().min(0).max(100_000_000).default(100_000_000),
    packageQuantity: z.coerce.number().int().positive('Quantidade por pacote precisa ser maior que zero.').max(100_000_000).default(1),
    unitPrice: z.coerce.number().min(0).max(1_000_000_000).optional(),
    priceBrl: z.coerce.number().min(0).max(1_000_000_000),
    priceUsd: z.coerce.number().min(0).max(1_000_000_000),
    active: z.boolean().default(true)
});
const munitionIdentifierSchema = z.string()
    .trim()
    .min(2, 'Informe o identificador.')
    .max(80)
    .regex(/^[a-z0-9_]+$/, 'Use apenas letras minusculas, numeros e underscore.');
const munitionSchema = z.object({
    guildId: discordId.optional(),
    nome: z.string().trim().min(2, 'Informe o nome da municao.').max(100).optional(),
    name: z.string().trim().min(2, 'Informe o nome da municao.').max(100).optional(),
    identificador: munitionIdentifierSchema.optional(),
    identifier: munitionIdentifierSchema.optional(),
    ordem: z.coerce.number().int().min(1).max(1000).optional(),
    order: z.coerce.number().int().min(1).max(1000).optional(),
    ativo: z.boolean().optional(),
    active: z.boolean().optional()
}).refine((value) => Boolean(value.nome || value.name), 'Informe o nome da municao.');
const munitionUpdateSchema = z.object({
    guildId: discordId.optional(),
    nome: z.string().trim().min(2, 'Informe o nome da municao.').max(100).optional(),
    name: z.string().trim().min(2, 'Informe o nome da municao.').max(100).optional(),
    identificador: munitionIdentifierSchema.optional(),
    identifier: munitionIdentifierSchema.optional(),
    ordem: z.coerce.number().int().min(1).max(1000).optional(),
    order: z.coerce.number().int().min(1).max(1000).optional(),
    ativo: z.boolean().optional(),
    active: z.boolean().optional()
});
const orderLineSchema = z.object({
    inventoryItemId: objectIdSchema.optional().or(z.literal('')),
    munitionId: objectIdSchema.optional().or(z.literal('')),
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
    currency: z.enum(currencies).default('BRL'),
    couponId: objectIdSchema.optional().or(z.literal('')),
    items: z.array(orderLineSchema).min(1, 'Adicione pelo menos um item ao carrinho.').max(40),
    saveAsFavorite: z.boolean().default(false),
    favoriteName: z.string().trim().max(80).optional().or(z.literal(''))
});
const couponSchema = z.object({
    guildId: discordId.optional(),
    name: z.string().trim().min(2, 'Informe o nome do cupom.').max(60),
    percentage: z.coerce.number().min(0).max(100),
    active: z.boolean().default(true),
    familyIds: z.array(objectIdSchema).default([]),
    expiresAt: z.coerce.date().optional().nullable(),
    usageLimit: z.coerce.number().int().positive().max(100_000_000).optional().nullable()
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
function asyncRoute(handler) {
    return (req, res, next) => {
        void handler(req, res, next).catch(next);
    };
}
function defaultGuildId(req) {
    return String(req.query.guildId || req.body?.guildId || env.discordGuildId || process.env.GUILD_ID || 'global');
}
function objectIdParam(req, name = 'id') {
    const value = req.params[name];
    return new ObjectId(Array.isArray(value) ? value[0] : value);
}
function getActor(req) {
    return {
        id: req.user?.discordId || req.user?.id || null,
        name: req.user?.name || req.user?.email || null
    };
}
function getDiscordToken() {
    return env.discordBotToken || process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN || '';
}
async function discordRequest(path, init = {}) {
    const token = getDiscordToken();
    if (!token)
        throw new Error('DISCORD_TOKEN/DISCORD_BOT_TOKEN ausente.');
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
    if (response.status === 204)
        return null;
    return response.json();
}
async function fetchDiscordChannels(guildId) {
    const [channels, roles] = await Promise.all([
        discordRequest(`/guilds/${guildId}/channels`),
        discordRequest(`/guilds/${guildId}/roles`)
    ]);
    const rows = Array.isArray(channels) ? channels : [];
    const roleRows = Array.isArray(roles) ? roles : [];
    return {
        categories: rows
            .filter((channel) => Number(channel.type) === CHANNEL_TYPE_CATEGORY)
            .sort((a, b) => Number(a.position || 0) - Number(b.position || 0))
            .map((channel) => ({
            id: String(channel.id),
            name: String(channel.name || 'categoria'),
            position: Number(channel.position || 0)
        })),
        textChannels: rows
            .filter((channel) => Number(channel.type) === CHANNEL_TYPE_TEXT)
            .sort((a, b) => Number(a.position || 0) - Number(b.position || 0))
            .map((channel) => ({
            id: String(channel.id),
            name: String(channel.name || 'canal'),
            parentId: channel.parent_id ? String(channel.parent_id) : null,
            position: Number(channel.position || 0)
        })),
        roles: roleRows
            .filter((role) => role && String(role.name || '') !== '@everyone')
            .sort((a, b) => Number(b.position || 0) - Number(a.position || 0))
            .map((role) => ({
            id: String(role.id),
            name: String(role.name || 'cargo'),
            position: Number(role.position || 0),
            color: Number(role.color || 0)
        }))
    };
}
function createSlug(value) {
    const slug = value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 70);
    return slug || `item-${Date.now()}`;
}
function createIdentifier(value) {
    const identifier = value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 80);
    return identifier || `munition_${Date.now()}`;
}
function cents(value) {
    return Math.max(0, Math.round(Number(value || 0) * 100));
}
function moneyFromCents(value) {
    return Math.round(Number(value || 0)) / 100;
}
function familyMunitionPricesToCents(prices) {
    const source = prices || {};
    return {
        hk_mag: cents(Number(source.hk_mag || 0)),
        tec_five: cents(Number(source.tec_five || 0)),
        mtar_mp7: cents(Number(source.mtar_mp7 || 0))
    };
}
function familyMunitionPricesFromCents(prices) {
    const source = prices || {};
    return {
        hk_mag: moneyFromCents(Number(source.hk_mag || 0)),
        tec_five: moneyFromCents(Number(source.tec_five || 0)),
        mtar_mp7: moneyFromCents(Number(source.mtar_mp7 || 0))
    };
}
function formatMoney(valueCents) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(moneyFromCents(valueCents));
}
function formatOrderMoney(valueCents, currency = 'BRL') {
    return new Intl.NumberFormat(currency === 'USD' ? 'en-US' : 'pt-BR', {
        style: 'currency',
        currency
    }).format(moneyFromCents(valueCents));
}
function currencyLabel(currency = 'BRL') {
    return currency === 'USD' ? 'Dolar (USD)' : 'Real (BRL)';
}
function resolveCurrency(value) {
    return value === 'USD' ? 'USD' : 'BRL';
}
function inventoryPrice(doc, currency) {
    const fallback = Number(doc.unit_price_cents || 0);
    return currency === 'USD'
        ? Number(doc.price_usd_cents ?? fallback)
        : Number(doc.price_brl_cents ?? fallback);
}
function statusLabel(status) {
    const labels = {
        pending: 'Pendente',
        separating: 'Em Separacao',
        transport: 'Em Transporte',
        delivered: 'Entregue',
        cancelled: 'Cancelado'
    };
    return labels[status] || status;
}
function categoryLabel(category) {
    const labels = {
        munitions: 'Municoes',
        weapons: 'Armas',
        general: 'Itens Gerais',
        drugs: 'Drogas',
        custom: 'Personalizado'
    };
    return labels[category] || category;
}
async function ensureDefaultMunitions(guildId) {
    const munitions = await collection('munitions');
    const existing = await munitions.countDocuments({ guild_id: guildId });
    if (!existing) {
        const now = new Date();
        await munitions.insertMany(defaultMunitions.map((item) => ({
            _id: new ObjectId(),
            guild_id: guildId,
            nome: item.nome,
            identificador: item.identificador,
            ativo: true,
            ordem: item.ordem,
            created_at: now,
            updated_at: now
        }))).catch(async () => {
            // Another process can seed first during startup; reading again is enough.
        });
    }
    return munitions;
}
function normalizeMunition(doc) {
    const row = serializeDoc(doc);
    return {
        id: String(doc._id),
        guildId: doc.guild_id,
        nome: doc.nome,
        name: doc.nome,
        identificador: doc.identificador,
        identifier: doc.identificador,
        ativo: doc.ativo,
        active: doc.ativo,
        ordem: Number(doc.ordem || 1),
        order: Number(doc.ordem || 1),
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}
function normalizeSettings(doc, channels) {
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
function normalizeFamily(doc) {
    const row = serializeDoc(doc);
    return {
        id: String(doc._id),
        guildId: doc.guild_id,
        name: doc.name,
        slug: doc.slug,
        leaderId: doc.leader_id || '',
        leaderName: doc.leader_name || '',
        orderChannelId: doc.order_channel_id || '',
        responsibleRoleId: doc.responsible_role_id || '',
        color: doc.color,
        icon: doc.icon,
        registeredAt: row.registered_at || row.created_at,
        internalNotes: doc.internal_notes || '',
        logWebhookUrl: doc.log_webhook_url || '',
        munitionPrices: familyMunitionPricesFromCents(doc.munition_unit_prices),
        defaultDiscountPercentage: Number(doc.default_discount_percentage || 0),
        members: doc.members || [],
        active: doc.active,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}
function normalizeInventoryItem(doc) {
    const row = serializeDoc(doc);
    const priceBrlCents = Number(doc.price_brl_cents ?? doc.unit_price_cents ?? 0);
    const priceUsdCents = Number(doc.price_usd_cents ?? doc.unit_price_cents ?? 0);
    return {
        id: String(doc._id),
        guildId: doc.guild_id,
        name: doc.name,
        slug: doc.slug,
        category: doc.category,
        categoryLabel: categoryLabel(doc.category),
        quantityAvailable: doc.quantity_available,
        packageQuantity: Number(doc.package_quantity || 1),
        unitPrice: moneyFromCents(priceBrlCents),
        priceBrl: moneyFromCents(priceBrlCents),
        priceUsd: moneyFromCents(priceUsdCents),
        active: doc.active,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}
function normalizeCoupon(doc) {
    const row = serializeDoc(doc);
    return {
        id: String(doc._id),
        guildId: doc.guild_id,
        name: doc.name,
        code: doc.code,
        percentage: Number(doc.percentage || 0),
        active: doc.active,
        familyIds: Array.isArray(doc.family_ids) ? doc.family_ids : [],
        expiresAt: row.expires_at || null,
        usageLimit: doc.usage_limit ?? null,
        usedCount: Number(doc.used_count || 0),
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}
function normalizeOrder(doc) {
    const row = serializeDoc(doc);
    const currency = resolveCurrency(doc.currency);
    const subtotal = Number(doc.subtotal_value_cents ?? doc.total_value_cents ?? 0);
    const discount = Number(doc.discount_value_cents ?? 0);
    const final = Number(doc.final_value_cents ?? doc.total_value_cents ?? Math.max(0, subtotal - discount));
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
            munitionId: item.munition_id || '',
            munitionIdentifier: item.munition_identifier || '',
            name: item.name,
            category: item.category,
            categoryLabel: categoryLabel(item.category),
            packageQuantity: Number(item.package_quantity || 1),
            quantity: item.quantity,
            unitPrice: moneyFromCents(item.unit_price_cents),
            unitPriceBrl: moneyFromCents(Number(item.unit_price_brl_cents ?? item.unit_price_cents ?? 0)),
            unitPriceUsd: moneyFromCents(Number(item.unit_price_usd_cents ?? item.unit_price_cents ?? 0)),
            totalValue: moneyFromCents(item.total_value_cents)
        })),
        currency,
        currencyLabel: currencyLabel(currency),
        subtotalValue: moneyFromCents(subtotal),
        discountValue: moneyFromCents(discount),
        finalValue: moneyFromCents(final),
        couponId: doc.coupon_id || '',
        couponCode: doc.coupon_code || '',
        couponPercentage: Number(doc.coupon_percentage || 0),
        totalValue: moneyFromCents(final),
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
function normalizeLog(doc) {
    const row = serializeDoc(doc);
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
function normalizeFavorite(doc) {
    const row = serializeDoc(doc);
    return {
        id: String(doc._id),
        guildId: doc.guild_id,
        familyId: doc.family_id,
        familyName: doc.family_name,
        name: doc.name,
        items: doc.items.map((item) => ({
            inventoryItemId: item.inventory_item_id || '',
            munitionId: item.munition_id || '',
            munitionIdentifier: item.munition_identifier || '',
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
async function nextOrderNumber(guildId) {
    const counters = await collection('order_counters');
    const result = await counters.findOneAndUpdate({ guild_id: guildId, key: 'orders' }, { $inc: { seq: 1 }, $setOnInsert: { guild_id: guildId, key: 'orders', created_at: new Date() } }, { upsert: true, returnDocument: 'after' });
    return ORDER_NUMBER_OFFSET + Number(result?.seq || 1);
}
async function buildOrderItems(guildId, requested, currency = 'BRL') {
    const [inventory, munitions] = await Promise.all([
        collection('order_inventory'),
        ensureDefaultMunitions(guildId)
    ]);
    const ids = requested
        .map((item) => item.inventoryItemId)
        .filter((value) => Boolean(value && ObjectId.isValid(value)));
    const munitionIds = requested
        .map((item) => item.munitionId)
        .filter((value) => Boolean(value && ObjectId.isValid(value)));
    const stockItems = ids.length
        ? await inventory.find({ guild_id: guildId, _id: { $in: ids.map((id) => new ObjectId(id)) } }).toArray()
        : [];
    const munitionRows = munitionIds.length
        ? await munitions.find({ guild_id: guildId, _id: { $in: munitionIds.map((id) => new ObjectId(id)) } }).toArray()
        : [];
    const stockById = new Map(stockItems.map((item) => [String(item._id), item]));
    const munitionById = new Map(munitionRows.map((item) => [String(item._id), item]));
    const items = [];
    for (const input of requested) {
        const stockItem = input.inventoryItemId ? stockById.get(input.inventoryItemId) : null;
        const munition = input.munitionId ? munitionById.get(input.munitionId) : null;
        if (input.inventoryItemId && !stockItem) {
            throw new Error('Um item selecionado nao existe mais no estoque.');
        }
        if (input.munitionId && !munition) {
            throw new Error('Uma municao selecionada nao existe mais no cadastro.');
        }
        if (stockItem && !stockItem.active) {
            throw new Error(`${stockItem.name} esta desativado no estoque.`);
        }
        if (munition && !munition.ativo) {
            throw new Error(`${munition.nome} esta desativada no cadastro de municoes.`);
        }
        const name = stockItem?.name || munition?.nome || String(input.name || 'Item personalizado').trim();
        if (!name || name.length < 2)
            throw new Error('Informe o nome do item personalizado.');
        const category = stockItem?.category || (munition ? 'munitions' : input.category || 'custom');
        const unitPriceCents = stockItem ? inventoryPrice(stockItem, currency) : cents(Number(input.unitPrice || 0));
        items.push({
            inventory_item_id: stockItem?._id ? String(stockItem._id) : null,
            munition_id: munition?._id ? String(munition._id) : null,
            munition_identifier: munition?.identificador || null,
            name,
            category,
            package_quantity: Number(stockItem?.package_quantity || 1),
            quantity: input.quantity,
            unit_price_cents: unitPriceCents,
            unit_price_brl_cents: stockItem ? inventoryPrice(stockItem, 'BRL') : unitPriceCents,
            unit_price_usd_cents: stockItem ? inventoryPrice(stockItem, 'USD') : unitPriceCents,
            total_value_cents: unitPriceCents * input.quantity
        });
    }
    return items;
}
async function applyStockDelta(guildId, items, direction) {
    const operations = items
        .filter((item) => item.inventory_item_id && ObjectId.isValid(item.inventory_item_id))
        .map((item) => ({
        updateOne: {
            filter: { _id: new ObjectId(item.inventory_item_id), guild_id: guildId },
            update: { $inc: { quantity_available: direction * item.quantity }, $set: { updated_at: new Date() } }
        }
    }));
    if (!operations.length)
        return;
    await (await collection('order_inventory')).bulkWrite(operations);
}
async function persistOrderItems(guildId, orderId, orderNumber, items, createdAt = new Date()) {
    if (!items.length)
        return;
    const docs = items.map((item) => ({
        _id: new ObjectId(),
        guild_id: guildId,
        order_id: String(orderId),
        order_number: orderNumber,
        munition_id: item.munition_id || null,
        inventory_item_id: item.inventory_item_id || null,
        nome: item.name,
        identificador: item.munition_identifier || null,
        categoria: item.category,
        quantidade: Number(item.quantity || 0),
        valor_unitario: moneyFromCents(Number(item.unit_price_cents || 0)),
        valor_unitario_cents: Number(item.unit_price_cents || 0),
        subtotal: moneyFromCents(Number(item.total_value_cents || 0)),
        subtotal_cents: Number(item.total_value_cents || 0),
        created_at: createdAt
    }));
    await (await collection('order_items')).insertMany(docs);
}
async function findApplicableCoupon(guildId, couponId, familyId) {
    if (!couponId || !ObjectId.isValid(couponId))
        return null;
    const coupon = await (await collection('order_coupons')).findOne({
        _id: new ObjectId(couponId),
        guild_id: guildId
    });
    if (!coupon || !coupon.active)
        throw new Error('Cupom inativo ou nao encontrado.');
    if (coupon.expires_at && new Date(coupon.expires_at).getTime() < Date.now()) {
        throw new Error('Cupom expirado.');
    }
    if (coupon.usage_limit && Number(coupon.used_count || 0) >= Number(coupon.usage_limit)) {
        throw new Error('Cupom atingiu o limite de usos.');
    }
    const familyIds = Array.isArray(coupon.family_ids) ? coupon.family_ids.map(String) : [];
    if (familyIds.length && !familyIds.includes(String(familyId))) {
        throw new Error('Cupom nao liberado para esta familia.');
    }
    return coupon;
}
function calculateOrderTotals(items, coupon) {
    const subtotal = items.reduce((total, item) => total + item.total_value_cents, 0);
    const percentage = coupon ? Math.max(0, Math.min(100, Number(coupon.percentage || 0))) : 0;
    const discount = Math.round(subtotal * (percentage / 100));
    return {
        subtotal,
        discount,
        final: Math.max(0, subtotal - discount),
        percentage
    };
}
function buildDiscordOrderPayload(order) {
    const currency = resolveCurrency(order.currency);
    const items = order.items.map((item) => `${item.quantity.toLocaleString('pt-BR')}x ${item.name}`).join('\n');
    const subtotal = Number(order.subtotal_value_cents ?? order.total_value_cents ?? 0);
    const discount = Number(order.discount_value_cents ?? 0);
    const final = Number(order.final_value_cents ?? order.total_value_cents ?? Math.max(0, subtotal - discount));
    return {
        embeds: [
            {
                color: Number.parseInt(order.family_color.replace('#', ''), 16) || 0x0ea5e9,
                title: `📦 Nova Encomenda #${order.order_number}`,
                description: [
                    `**Familia:** ${order.family_icon || '📦'} ${order.family_name}`,
                    `**Solicitante:** ${order.responsible_name || order.created_by_name || 'N/A'}`,
                    `**Moeda:** ${currencyLabel(currency)}`,
                    '',
                    '**Itens:**',
                    items || 'Nenhum item',
                    '',
                    `**Valor Bruto:** ${formatOrderMoney(subtotal, currency)}`,
                    `**Cupom:** ${order.coupon_code ? `${order.coupon_code} (${Number(order.coupon_percentage || 0)}%)` : 'Sem desconto'}`,
                    `**Desconto:** ${formatOrderMoney(discount, currency)}`,
                    `**Valor Final:** ${formatOrderMoney(final, currency)}`,
                    `**Status:** ${statusLabel(order.status)}`,
                    `**Data:** ${new Date(order.created_at).toLocaleDateString('pt-BR')}`
                ].join('\n'),
                footer: { text: 'Vortex | Sistema de Encomendas' },
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
async function sendApprovalMessage(channelId, order) {
    if (!channelId)
        return '';
    const response = await discordRequest(`/channels/${channelId}/messages`, {
        method: 'POST',
        body: JSON.stringify(buildDiscordOrderPayload(order))
    });
    return String(response?.id || '');
}
async function editApprovalMessage(order) {
    if (!order.approval_channel_id || !order.approval_message_id)
        return;
    await discordRequest(`/channels/${order.approval_channel_id}/messages/${order.approval_message_id}`, {
        method: 'PATCH',
        body: JSON.stringify(buildDiscordOrderPayload(order))
    }).catch(() => null);
}
async function sendWebhookLog(webhookUrl, log) {
    if (!webhookUrl)
        return;
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
async function insertOrderLog(log, family, settings) {
    await (await collection('order_logs')).insertOne(log);
    await sendWebhookLog(family?.log_webhook_url || settings?.default_logs_webhook_url, log);
    publishDashboardEvent({ type: 'orders.updated', payload: { guildId: log.guild_id, action: log.action } });
}
function buildOrderFilter(req, guildId) {
    const filter = { guild_id: guildId };
    const dynamicFilter = filter;
    const status = String(req.query.status || '').trim();
    const familyId = String(req.query.familyId || '').trim();
    const responsible = String(req.query.responsible || '').trim();
    const item = String(req.query.item || '').trim().toLowerCase();
    const dateFrom = String(req.query.dateFrom || '').trim();
    const dateTo = String(req.query.dateTo || '').trim();
    if (orderStatuses.includes(status))
        filter.status = status;
    if (familyId && ObjectId.isValid(familyId))
        filter.family_id = familyId;
    if (responsible) {
        dynamicFilter.$or = [
            { responsible_name: { $regex: responsible, $options: 'i' } },
            { responsible_id: responsible }
        ];
    }
    if (item)
        dynamicFilter['items.name'] = { $regex: item, $options: 'i' };
    if (dateFrom || dateTo) {
        dynamicFilter.created_at = {};
        if (dateFrom)
            dynamicFilter.created_at.$gte = new Date(`${dateFrom}T00:00:00.000Z`);
        if (dateTo)
            dynamicFilter.created_at.$lte = new Date(`${dateTo}T23:59:59.999Z`);
    }
    return filter;
}
async function orderStats(guildId) {
    const [orders, families] = await Promise.all([
        collection('orders'),
        collection('order_families')
    ]);
    const totalsPromise = orders.aggregate([
        { $match: { guild_id: guildId, status: { $ne: 'cancelled' } } },
        { $group: { _id: null, value: { $sum: { $ifNull: ['$final_value_cents', '$total_value_cents'] } } } }
    ]).toArray();
    const currencyTotalsPromise = orders.aggregate([
        { $match: { guild_id: guildId, status: { $ne: 'cancelled' } } },
        { $group: { _id: '$currency', value: { $sum: { $ifNull: ['$final_value_cents', '$total_value_cents'] } } } }
    ]).toArray();
    const rankingPromise = orders.aggregate([
        { $match: { guild_id: guildId } },
        { $group: { _id: '$family_id', familyName: { $first: '$family_name' }, total: { $sum: 1 }, value: { $sum: { $ifNull: ['$final_value_cents', '$total_value_cents'] } } } },
        { $sort: { value: -1, total: -1 } },
        { $limit: 10 }
    ]).toArray();
    const topCouponsPromise = orders.aggregate([
        { $match: { guild_id: guildId, coupon_code: { $nin: [null, ''] } } },
        { $group: { _id: '$coupon_code', code: { $first: '$coupon_code' }, total: { $sum: 1 }, value: { $sum: { $ifNull: ['$discount_value_cents', 0] } } } },
        { $sort: { total: -1, value: -1 } },
        { $limit: 5 }
    ]).toArray();
    const [totalOrders, pending, delivered, totalFamilies] = await Promise.all([
        orders.countDocuments({ guild_id: guildId }),
        orders.countDocuments({ guild_id: guildId, status: 'pending' }),
        orders.countDocuments({ guild_id: guildId, status: 'delivered' }),
        families.countDocuments({ guild_id: guildId, active: true })
    ]);
    const [totals, currencyTotals, ranking, topCoupons] = await Promise.all([totalsPromise, currencyTotalsPromise, rankingPromise, topCouponsPromise]);
    const totalByCurrency = new Map(currencyTotals.map((item) => [resolveCurrency(item._id), Number(item.value || 0)]));
    return {
        totalFamilies,
        totalOrders,
        pending,
        delivered,
        movedValue: moneyFromCents(totals[0]?.value || 0),
        movedValueBrl: moneyFromCents(totalByCurrency.get('BRL') || 0),
        movedValueUsd: moneyFromCents(totalByCurrency.get('USD') || 0),
        topCoupons: topCoupons.map((item) => ({
            code: item.code,
            total: item.total,
            discountValue: moneyFromCents(item.value)
        })),
        ranking: ranking.map((item) => ({
            familyId: item._id,
            familyName: item.familyName,
            total: item.total,
            value: moneyFromCents(item.value)
        }))
    };
}
function csvCell(value) {
    const text = String(value ?? '');
    return `"${text.replace(/"/g, '""')}"`;
}
function orderExportRows(orders) {
    return orders.map((order) => ({
        id: `#${order.order_number}`,
        familia: order.family_name,
        responsavel: order.responsible_name || order.created_by_name || '',
        status: statusLabel(order.status),
        itens: order.items.map((item) => `${item.quantity}x ${item.name}`).join('; '),
        moeda: resolveCurrency(order.currency),
        valor_bruto: moneyFromCents(Number(order.subtotal_value_cents ?? order.total_value_cents ?? 0)),
        cupom: order.coupon_code || '',
        desconto: moneyFromCents(Number(order.discount_value_cents ?? 0)),
        valor: moneyFromCents(Number(order.final_value_cents ?? order.total_value_cents ?? 0)),
        criado_em: order.created_at.toISOString()
    }));
}
function buildCsv(orders, delimiter = ',') {
    const rows = orderExportRows(orders);
    const headers = ['id', 'familia', 'responsavel', 'status', 'itens', 'moeda', 'valor_bruto', 'cupom', 'desconto', 'valor', 'criado_em'];
    return [
        headers.map(csvCell).join(delimiter),
        ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(delimiter))
    ].join('\n');
}
function buildSimplePdf(lines) {
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
    }
    catch (error) {
        return res.json({
            ok: true,
            guildId,
            categories: [],
            textChannels: [],
            roles: [],
            error: error instanceof Error ? error.message : 'Falha ao carregar canais do Discord.'
        });
    }
}));
ordersRouter.get('/settings', asyncRoute(async (req, res) => {
    const guildId = defaultGuildId(req);
    const doc = await (await collection('order_settings')).findOne({ guild_id: guildId });
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
    const result = await (await collection('order_settings')).findOneAndUpdate({ guild_id: guildId }, {
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
    }, { upsert: true, returnDocument: 'after' });
    publishDashboardEvent({ type: 'orders.updated', payload: { guildId, action: 'settings' } });
    return res.json({ ok: true, settings: normalizeSettings(result, channels) });
}));
ordersRouter.get('/families', asyncRoute(async (req, res) => {
    const guildId = defaultGuildId(req);
    const includeInactive = String(req.query.includeInactive || '') === 'true';
    const filter = { guild_id: guildId };
    if (!includeInactive)
        filter.active = true;
    const rows = await (await collection('order_families'))
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
    const doc = {
        _id: new ObjectId(),
        guild_id: guildId,
        name: input.name,
        slug: createSlug(input.name),
        leader_id: input.leaderId || null,
        leader_name: input.leaderName || null,
        order_channel_id: input.orderChannelId || null,
        responsible_role_id: input.responsibleRoleId || null,
        color: input.color,
        icon: input.icon || '📦',
        registered_at: input.registeredAt || now,
        internal_notes: input.internalNotes || 'Sem observacoes.',
        log_webhook_url: input.logWebhookUrl || null,
        munition_unit_prices: familyMunitionPricesToCents(input.munitionPrices),
        default_discount_percentage: Number(input.defaultDiscountPercentage || 0),
        members: input.members.map((member) => ({ discord_id: member.discordId, name: member.name || null })),
        active: input.active,
        created_by_id: actor.id,
        created_by_name: actor.name,
        created_at: now,
        updated_at: now
    };
    await (await collection('order_families')).insertOne(doc);
    await insertOrderLog({
        guild_id: guildId,
        family_id: String(doc._id),
        family_name: doc.name,
        action: 'family_created',
        actor_id: actor.id,
        actor_name: actor.name,
        details: { leaderId: doc.leader_id, active: doc.active, registeredAt: doc.registered_at },
        created_at: now
    }, doc);
    return res.status(201).json({ ok: true, family: normalizeFamily(doc) });
}));
ordersRouter.put('/families/:id', asyncRoute(async (req, res) => {
    const input = familySchema.partial().parse(req.body);
    const guildId = input.guildId || defaultGuildId(req);
    const id = objectIdParam(req);
    const actor = getActor(req);
    const now = new Date();
    const update = {
        updated_at: now
    };
    if (input.name) {
        update.name = input.name;
        update.slug = createSlug(input.name);
    }
    if (input.leaderId !== undefined)
        update.leader_id = input.leaderId || null;
    if (input.leaderName !== undefined)
        update.leader_name = input.leaderName || null;
    if (input.orderChannelId !== undefined)
        update.order_channel_id = input.orderChannelId || null;
    if (input.responsibleRoleId !== undefined)
        update.responsible_role_id = input.responsibleRoleId || null;
    if (input.color !== undefined)
        update.color = input.color;
    if (input.icon !== undefined)
        update.icon = input.icon || '📦';
    if (input.registeredAt !== undefined)
        update.registered_at = input.registeredAt || now;
    if (input.internalNotes !== undefined)
        update.internal_notes = input.internalNotes || '';
    if (input.logWebhookUrl !== undefined)
        update.log_webhook_url = input.logWebhookUrl || null;
    if (input.munitionPrices !== undefined)
        update.munition_unit_prices = familyMunitionPricesToCents(input.munitionPrices);
    if (input.defaultDiscountPercentage !== undefined)
        update.default_discount_percentage = Number(input.defaultDiscountPercentage || 0);
    if (input.active !== undefined)
        update.active = input.active;
    if (input.members !== undefined)
        update.members = input.members.map((member) => ({ discord_id: member.discordId, name: member.name || null }));
    const result = await (await collection('order_families')).findOneAndUpdate({ _id: id, guild_id: guildId }, { $set: update }, { returnDocument: 'after' });
    if (!result)
        return res.status(404).json({ ok: false, error: 'Familia nao encontrada.' });
    await insertOrderLog({
        guild_id: guildId,
        family_id: String(result._id),
        family_name: result.name,
        action: 'family_updated',
        actor_id: actor.id,
        actor_name: actor.name,
        details: update,
        created_at: now
    }, result);
    return res.json({ ok: true, family: normalizeFamily(result) });
}));
ordersRouter.delete('/families/:id', asyncRoute(async (req, res) => {
    const guildId = defaultGuildId(req);
    const id = objectIdParam(req);
    const actor = getActor(req);
    const family = await (await collection('order_families')).findOne({ _id: id, guild_id: guildId });
    if (!family)
        return res.status(404).json({ ok: false, error: 'Familia nao encontrada.' });
    await (await collection('order_families')).deleteOne({ _id: id, guild_id: guildId });
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
ordersRouter.get('/munitions', asyncRoute(async (req, res) => {
    const guildId = defaultGuildId(req);
    const includeInactive = String(req.query.includeInactive || '') === 'true';
    const munitions = await ensureDefaultMunitions(guildId);
    const filter = { guild_id: guildId };
    if (!includeInactive)
        filter.ativo = true;
    const rows = await munitions
        .find(filter)
        .sort({ ativo: -1, ordem: 1, nome: 1 })
        .toArray();
    return res.json({ ok: true, guildId, munitions: rows.map(normalizeMunition) });
}));
ordersRouter.post('/munitions', asyncRoute(async (req, res) => {
    const input = munitionSchema.parse(req.body);
    const guildId = input.guildId || defaultGuildId(req);
    const now = new Date();
    const nome = String(input.nome || input.name || '').trim();
    const identificador = String(input.identificador || input.identifier || createIdentifier(nome)).trim();
    const doc = {
        _id: new ObjectId(),
        guild_id: guildId,
        nome,
        identificador,
        ativo: input.ativo ?? input.active ?? true,
        ordem: Number(input.ordem ?? input.order ?? 1),
        created_at: now,
        updated_at: now
    };
    await (await collection('munitions')).insertOne(doc);
    const actor = getActor(req);
    await insertOrderLog({
        guild_id: guildId,
        action: 'munition_created',
        actor_id: actor.id,
        actor_name: actor.name,
        details: { munition: doc.nome, identificador: doc.identificador, ordem: doc.ordem },
        created_at: now
    });
    publishDashboardEvent({ type: 'orders.updated', payload: { guildId, action: 'munition_created' } });
    return res.status(201).json({ ok: true, munition: normalizeMunition(doc) });
}));
ordersRouter.put('/munitions/:id', asyncRoute(async (req, res) => {
    const input = munitionUpdateSchema.parse(req.body);
    const guildId = input.guildId || defaultGuildId(req);
    const id = objectIdParam(req);
    const update = { updated_at: new Date() };
    const nome = String(input.nome || input.name || '').trim();
    if (nome)
        update.nome = nome;
    const identificador = String(input.identificador || input.identifier || '').trim();
    if (identificador)
        update.identificador = identificador;
    if (input.ordem !== undefined || input.order !== undefined)
        update.ordem = Number(input.ordem ?? input.order);
    if (input.ativo !== undefined || input.active !== undefined)
        update.ativo = input.ativo ?? input.active ?? true;
    const result = await (await collection('munitions')).findOneAndUpdate({ _id: id, guild_id: guildId }, { $set: update }, { returnDocument: 'after' });
    if (!result)
        return res.status(404).json({ ok: false, error: 'Municao nao encontrada.' });
    const actor = getActor(req);
    await insertOrderLog({
        guild_id: guildId,
        action: 'munition_updated',
        actor_id: actor.id,
        actor_name: actor.name,
        details: { munition: result.nome, identificador: result.identificador, ordem: result.ordem, ativo: result.ativo },
        created_at: new Date()
    });
    publishDashboardEvent({ type: 'orders.updated', payload: { guildId, action: 'munition_updated' } });
    return res.json({ ok: true, munition: normalizeMunition(result) });
}));
ordersRouter.delete('/munitions/:id', asyncRoute(async (req, res) => {
    const guildId = defaultGuildId(req);
    const id = objectIdParam(req);
    const result = await (await collection('munitions')).findOneAndUpdate({ _id: id, guild_id: guildId }, { $set: { ativo: false, updated_at: new Date() } }, { returnDocument: 'after' });
    if (!result)
        return res.status(404).json({ ok: false, error: 'Municao nao encontrada.' });
    publishDashboardEvent({ type: 'orders.updated', payload: { guildId, action: 'munition_deleted' } });
    return res.json({ ok: true, munition: normalizeMunition(result) });
}));
ordersRouter.get('/inventory', asyncRoute(async (req, res) => {
    const guildId = defaultGuildId(req);
    const includeInactive = String(req.query.includeInactive || '') === 'true';
    const filter = { guild_id: guildId };
    if (!includeInactive)
        filter.active = true;
    const rows = await (await collection('order_inventory'))
        .find(filter)
        .sort({ category: 1, name: 1 })
        .toArray();
    return res.json({ ok: true, guildId, inventory: rows.map(normalizeInventoryItem) });
}));
ordersRouter.post('/inventory', asyncRoute(async (req, res) => {
    const input = inventorySchema.parse(req.body);
    const guildId = input.guildId || defaultGuildId(req);
    const now = new Date();
    const doc = {
        _id: new ObjectId(),
        guild_id: guildId,
        name: input.name,
        slug: createSlug(input.name),
        category: input.category,
        quantity_available: input.quantityAvailable,
        package_quantity: input.packageQuantity,
        unit_price_cents: cents(input.priceBrl ?? input.unitPrice ?? 0),
        price_brl_cents: cents(input.priceBrl ?? input.unitPrice ?? 0),
        price_usd_cents: cents(input.priceUsd ?? input.unitPrice ?? 0),
        active: input.active,
        created_at: now,
        updated_at: now
    };
    await (await collection('order_inventory')).insertOne(doc);
    const actor = getActor(req);
    await insertOrderLog({
        guild_id: guildId,
        action: 'inventory_created',
        actor_id: actor.id,
        actor_name: actor.name,
        details: { item: doc.name, packageQuantity: doc.package_quantity, priceBrl: input.priceBrl, priceUsd: input.priceUsd },
        created_at: now
    });
    return res.status(201).json({ ok: true, item: normalizeInventoryItem(doc) });
}));
ordersRouter.put('/inventory/:id', asyncRoute(async (req, res) => {
    const input = inventorySchema.partial().parse(req.body);
    const guildId = input.guildId || defaultGuildId(req);
    const id = objectIdParam(req);
    const update = { updated_at: new Date() };
    if (input.name) {
        update.name = input.name;
        update.slug = createSlug(input.name);
    }
    if (input.category !== undefined)
        update.category = input.category;
    if (input.quantityAvailable !== undefined)
        update.quantity_available = input.quantityAvailable;
    if (input.packageQuantity !== undefined)
        update.package_quantity = input.packageQuantity;
    if (input.priceBrl !== undefined) {
        update.price_brl_cents = cents(input.priceBrl);
        update.unit_price_cents = cents(input.priceBrl);
    }
    else if (input.unitPrice !== undefined) {
        update.price_brl_cents = cents(input.unitPrice);
        update.unit_price_cents = cents(input.unitPrice);
    }
    if (input.priceUsd !== undefined)
        update.price_usd_cents = cents(input.priceUsd);
    if (input.active !== undefined)
        update.active = input.active;
    const result = await (await collection('order_inventory')).findOneAndUpdate({ _id: id, guild_id: guildId }, { $set: update }, { returnDocument: 'after' });
    if (!result)
        return res.status(404).json({ ok: false, error: 'Item de estoque nao encontrado.' });
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
    const result = await (await collection('order_inventory')).findOneAndUpdate({ _id: id, guild_id: guildId }, { $set: { active: false, updated_at: new Date() } }, { returnDocument: 'after' });
    if (!result)
        return res.status(404).json({ ok: false, error: 'Item de estoque nao encontrado.' });
    publishDashboardEvent({ type: 'orders.updated', payload: { guildId, action: 'inventory_deleted' } });
    return res.json({ ok: true, item: normalizeInventoryItem(result) });
}));
ordersRouter.get('/coupons', asyncRoute(async (req, res) => {
    const guildId = defaultGuildId(req);
    const includeInactive = String(req.query.includeInactive || '') === 'true';
    const filter = { guild_id: guildId };
    if (!includeInactive)
        filter.active = true;
    const rows = await (await collection('order_coupons'))
        .find(filter)
        .sort({ active: -1, name: 1 })
        .toArray();
    return res.json({ ok: true, guildId, coupons: rows.map(normalizeCoupon) });
}));
ordersRouter.post('/coupons', asyncRoute(async (req, res) => {
    const input = couponSchema.parse(req.body);
    const guildId = input.guildId || defaultGuildId(req);
    const actor = getActor(req);
    const now = new Date();
    const doc = {
        _id: new ObjectId(),
        guild_id: guildId,
        code: createSlug(input.name).toUpperCase(),
        name: input.name.trim().toUpperCase(),
        percentage: input.percentage,
        active: input.active,
        family_ids: input.familyIds || [],
        expires_at: input.expiresAt || null,
        usage_limit: input.usageLimit || null,
        used_count: 0,
        created_by_id: actor.id,
        created_by_name: actor.name,
        created_at: now,
        updated_at: now
    };
    await (await collection('order_coupons')).insertOne(doc);
    await insertOrderLog({
        guild_id: guildId,
        action: 'coupon_created',
        actor_id: actor.id,
        actor_name: actor.name,
        details: { coupon: doc.code, percentage: doc.percentage, families: doc.family_ids.length, usageLimit: doc.usage_limit || null },
        created_at: now
    });
    return res.status(201).json({ ok: true, coupon: normalizeCoupon(doc) });
}));
ordersRouter.put('/coupons/:id', asyncRoute(async (req, res) => {
    const input = couponSchema.partial().parse(req.body);
    const guildId = input.guildId || defaultGuildId(req);
    const id = objectIdParam(req);
    const update = { updated_at: new Date() };
    if (input.name !== undefined) {
        update.name = input.name.trim().toUpperCase();
        update.code = createSlug(input.name).toUpperCase();
    }
    if (input.percentage !== undefined)
        update.percentage = input.percentage;
    if (input.active !== undefined)
        update.active = input.active;
    if (input.familyIds !== undefined)
        update.family_ids = input.familyIds || [];
    if (input.expiresAt !== undefined)
        update.expires_at = input.expiresAt || null;
    if (input.usageLimit !== undefined)
        update.usage_limit = input.usageLimit || null;
    const result = await (await collection('order_coupons')).findOneAndUpdate({ _id: id, guild_id: guildId }, { $set: update }, { returnDocument: 'after' });
    if (!result)
        return res.status(404).json({ ok: false, error: 'Cupom nao encontrado.' });
    const actor = getActor(req);
    await insertOrderLog({
        guild_id: guildId,
        action: 'coupon_updated',
        actor_id: actor.id,
        actor_name: actor.name,
        details: { coupon: result.code, percentage: result.percentage, active: result.active, usageLimit: result.usage_limit || null },
        created_at: new Date()
    });
    return res.json({ ok: true, coupon: normalizeCoupon(result) });
}));
ordersRouter.delete('/coupons/:id', asyncRoute(async (req, res) => {
    const guildId = defaultGuildId(req);
    const id = objectIdParam(req);
    const result = await (await collection('order_coupons')).findOneAndUpdate({ _id: id, guild_id: guildId }, { $set: { active: false, updated_at: new Date() } }, { returnDocument: 'after' });
    if (!result)
        return res.status(404).json({ ok: false, error: 'Cupom nao encontrado.' });
    publishDashboardEvent({ type: 'orders.updated', payload: { guildId, action: 'coupon_deleted' } });
    return res.json({ ok: true, coupon: normalizeCoupon(result) });
}));
ordersRouter.get('/favorites', asyncRoute(async (req, res) => {
    const guildId = defaultGuildId(req);
    const familyId = String(req.query.familyId || '').trim();
    const filter = { guild_id: guildId };
    if (familyId && ObjectId.isValid(familyId))
        filter.family_id = familyId;
    const rows = await (await collection('order_favorites'))
        .find(filter)
        .sort({ updated_at: -1 })
        .toArray();
    return res.json({ ok: true, guildId, favorites: rows.map(normalizeFavorite) });
}));
ordersRouter.post('/favorites', asyncRoute(async (req, res) => {
    const input = favoriteSchema.parse(req.body);
    const guildId = input.guildId || defaultGuildId(req);
    const family = await (await collection('order_families')).findOne({ _id: new ObjectId(input.familyId), guild_id: guildId });
    if (!family)
        return res.status(404).json({ ok: false, error: 'Familia nao encontrada.' });
    const actor = getActor(req);
    const now = new Date();
    const items = await buildOrderItems(guildId, input.items);
    const doc = {
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
    await (await collection('order_favorites')).insertOne(doc);
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
    await (await collection('order_favorites')).deleteOne({ _id: id, guild_id: guildId });
    publishDashboardEvent({ type: 'orders.updated', payload: { guildId, action: 'favorite_deleted' } });
    return res.json({ ok: true });
}));
ordersRouter.get('/logs', asyncRoute(async (req, res) => {
    const guildId = defaultGuildId(req);
    const filter = { guild_id: guildId };
    const familyId = String(req.query.familyId || '').trim();
    const orderId = String(req.query.orderId || '').trim();
    if (familyId && ObjectId.isValid(familyId))
        filter.family_id = familyId;
    if (orderId && ObjectId.isValid(orderId))
        filter.order_id = orderId;
    const rows = await (await collection('order_logs'))
        .find(filter)
        .sort({ created_at: -1 })
        .limit(Math.min(Number(req.query.limit) || 200, 1000))
        .toArray();
    return res.json({ ok: true, guildId, logs: rows.map(normalizeLog) });
}));
ordersRouter.get('/export', asyncRoute(async (req, res) => {
    const guildId = defaultGuildId(req);
    const format = String(req.query.format || 'csv').toLowerCase();
    const rows = await (await collection('orders'))
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
    const rows = await (await collection('orders'))
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
        collection('order_families'),
        collection('order_settings')
    ]);
    const family = await families.findOne({ _id: new ObjectId(input.familyId), guild_id: guildId });
    if (!family || !family.active)
        return res.status(404).json({ ok: false, error: 'Familia ativa nao encontrada.' });
    const currency = resolveCurrency(input.currency);
    const items = await buildOrderItems(guildId, input.items, currency);
    const coupon = await findApplicableCoupon(guildId, input.couponId || '', String(family._id));
    const totals = calculateOrderTotals(items, coupon);
    const settings = await settingsCollection.findOne({ guild_id: guildId });
    const actor = getActor(req);
    const now = new Date();
    const orderId = new ObjectId();
    const doc = {
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
        currency,
        subtotal_value_cents: totals.subtotal,
        discount_value_cents: totals.discount,
        final_value_cents: totals.final,
        coupon_id: coupon?._id ? String(coupon._id) : null,
        coupon_code: coupon?.code || null,
        coupon_percentage: totals.percentage,
        total_value_cents: totals.final,
        status: 'pending',
        stock_applied: false,
        stock_restored: false,
        approval_channel_id: family.order_channel_id || settings?.order_channel_id || null,
        approval_message_id: null,
        created_by_id: actor.id,
        created_by_name: actor.name,
        source: 'web',
        created_at: now,
        updated_at: now
    };
    if (doc.approval_channel_id) {
        doc.approval_message_id = await sendApprovalMessage(doc.approval_channel_id, doc).catch(() => '');
    }
    await (await collection('orders')).insertOne(doc);
    await persistOrderItems(guildId, orderId, doc.order_number, items, now);
    if (coupon?._id) {
        await (await collection('order_coupons')).updateOne({ _id: coupon._id, guild_id: guildId }, { $inc: { used_count: 1 }, $set: { updated_at: now } });
    }
    await insertOrderLog({
        guild_id: guildId,
        order_id: String(orderId),
        order_number: doc.order_number,
        family_id: doc.family_id,
        family_name: doc.family_name,
        action: 'order_created',
        actor_id: actor.id,
        actor_name: actor.name,
        details: {
            items: items.length,
            currency,
            subtotalValue: moneyFromCents(totals.subtotal),
            coupon: coupon?.code || null,
            discountValue: moneyFromCents(totals.discount),
            totalValue: moneyFromCents(totals.final)
        },
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
        await (await collection('order_favorites')).insertOne({
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
    const orders = await collection('orders');
    const order = await orders.findOne({ _id: id, guild_id: guildId });
    if (!order)
        return res.status(404).json({ ok: false, error: 'Pedido nao encontrado.' });
    const actor = getActor(req);
    const now = new Date();
    const update = {
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
    const result = await orders.findOneAndUpdate({ _id: id, guild_id: guildId }, { $set: update }, { returnDocument: 'after' });
    if (!result)
        return res.status(404).json({ ok: false, error: 'Pedido nao encontrado.' });
    const [family, settings] = await Promise.all([
        (await collection('order_families')).findOne({ _id: new ObjectId(result.family_id), guild_id: guildId }),
        (await collection('order_settings')).findOne({ guild_id: guildId })
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
