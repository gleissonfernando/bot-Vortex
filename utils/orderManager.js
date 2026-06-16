const mongoose = require('mongoose');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { buildThemedPanelPayload } = require('./panelTheme');
const { hasCommandRole, hasVortexLevel } = require('./permissions');
const { safeDeferReply, safeEdit, safeReply, safeShowModal } = require('./safeReply');

function hasOrderManagerPermission(member) {
  return hasVortexLevel(member, ['admin', 'medio'])
    || hasCommandRole(member, 'encomenda')
    || Boolean(member?.permissions?.has?.(PermissionFlagsBits.ManageChannels));
}

function getCollection(name) {
  if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) return null;
  return mongoose.connection.db.collection(name);
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
  const number = Math.floor(Number(String(value || '').trim().replace(/\./g, '').replace(',', '.')));
  return Number.isFinite(number) && number > 0 ? number : null;
}

function parseDecimal(value, fallback = 0) {
  const text = String(value || '').trim().replace(/[R$\s]/g, '');
  if (!text) return fallback;
  const normalized = text.includes(',')
    ? text.replace(/\./g, '').replace(',', '.')
    : text;
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

function parseOrderId(customId, prefix) {
  const value = String(customId || '');
  if (!value.startsWith(prefix)) return '';
  const id = value.slice(prefix.length);
  return mongoose.Types.ObjectId.isValid(id) ? id : '';
}

function buildOrderButtons(orderId, status = 'pending') {
  const closed = status !== 'pending';
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`order_waiting_${orderId}`)
      .setLabel('Aguardando')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(`order_delivered_${orderId}`)
      .setLabel('Entregue')
      .setStyle(ButtonStyle.Success)
      .setDisabled(closed),
    new ButtonBuilder()
      .setCustomId(`order_rejected_${orderId}`)
      .setLabel('Nao Entregue')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(closed),
  );
}

function buildOrderPanelPayload(interaction = null) {
  const iconURL = interaction?.guild?.iconURL?.({ dynamic: true, size: 256 })
    || interaction?.client?.user?.displayAvatarURL?.()
    || null;

  const embed = new EmbedBuilder()
    .setColor('#0EA5E9')
    .setAuthor({ name: 'VORTEX | Encomendas', iconURL: iconURL || undefined })
    .setTitle('Painel de Encomendas')
    .setDescription([
      'Crie pedidos de municao e acompanhe o status em um canal automatico.',
      '',
      'O canal sera aberto dentro da categoria configurada na dashboard.',
    ].join('\n'))
    .addFields(
      {
        name: 'Nova encomenda',
        value: 'Informe familia, municao, quantidade, valor unitario e desconto.',
        inline: false,
      },
      {
        name: 'Canal automatico',
        value: '`pedido-nome-da-familia` com painel de status.',
        inline: false,
      }
    )
    .setFooter({ text: 'Vortex | Sistema de Encomendas' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('order_create')
      .setLabel('Nova encomenda')
      .setStyle(ButtonStyle.Primary)
  );

  return buildThemedPanelPayload('orders', embed, { components: [row] });
}

function buildCreateOrderModal() {
  return new ModalBuilder()
    .setCustomId('modal_order_create')
    .setTitle('Nova encomenda')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('family_name')
          .setLabel('Familia')
          .setPlaceholder('Ex: Noruega')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(80)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('ammo_name')
          .setLabel('Municao')
          .setPlaceholder('Ex: Pistola, Submetralhadora, Fuzil')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(80)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('quantity')
          .setLabel('Quantidade')
          .setPlaceholder('Ex: 1000')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(12)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('unit_price')
          .setLabel('Valor unitario')
          .setPlaceholder('Ex: 25 ou 25,50')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(16)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('discount_percent')
          .setLabel('Desconto em porcentagem')
          .setPlaceholder('Ex: 0, 5, 10')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(6)
      )
    );
}

function buildRejectModal(orderId) {
  return new ModalBuilder()
    .setCustomId(`modal_order_rejected_${orderId}`)
    .setTitle('Recusar encomenda')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('reason')
          .setLabel('Motivo da recusa')
          .setPlaceholder('Explique por que a encomenda nao foi entregue')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(800)
      )
    );
}

async function createOrderFromInteraction(interaction, input) {
  const settingsCollection = getCollection('order_settings');
  const orders = getCollection('orders');
  const logs = getCollection('order_logs');
  if (!settingsCollection || !orders || !logs) {
    return { ok: false, message: 'MongoDB nao esta conectado. Nao foi possivel criar a encomenda.' };
  }

  const guild = interaction.guild;
  if (!guild) return { ok: false, message: 'Use este comando dentro de um servidor.' };

  const settings = await settingsCollection.findOne({ guild_id: guild.id });
  if (!settings?.order_category_id) {
    return { ok: false, message: 'Configure a categoria das encomendas na dashboard antes de criar pedidos.' };
  }

  const category = await guild.channels.fetch(settings.order_category_id).catch(() => null);
  if (!category || category.type !== ChannelType.GuildCategory) {
    return { ok: false, message: 'A categoria configurada nao existe mais no servidor. Escolha outra na dashboard.' };
  }

  const familyName = String(input.familyName || '').trim().slice(0, 80);
  const ammoName = String(input.ammoName || '').trim().slice(0, 80);
  const quantity = parsePositiveInt(input.quantity);
  const unitPrice = parseDecimal(input.unitPrice);
  const discountPercent = parseDecimal(input.discountPercent, 0);

  if (!familyName || familyName.length < 2) return { ok: false, message: 'Informe o nome da familia.' };
  if (!ammoName || ammoName.length < 2) return { ok: false, message: 'Informe o tipo de municao.' };
  if (!quantity) return { ok: false, message: 'Informe uma quantidade maior que zero.' };
  if (unitPrice === null) return { ok: false, message: 'Informe um valor unitario valido.' };
  if (discountPercent === null || discountPercent > 100) return { ok: false, message: 'Informe um desconto entre 0 e 100.' };

  const orderId = new mongoose.Types.ObjectId();
  const familySlug = createSlug(familyName);
  const unitPriceCents = cents(unitPrice);
  const originalValueCents = unitPriceCents * quantity;
  const discountValueCents = Math.round(originalValueCents * (discountPercent / 100));
  const finalValueCents = Math.max(0, originalValueCents - discountValueCents);

  const channel = await guild.channels.create({
    name: `pedido-${familySlug}`.slice(0, 100),
    type: ChannelType.GuildText,
    parent: category.id,
    permissionOverwrites: [
      { id: guild.id, deny: [PermissionFlagsBits.SendMessages] },
      {
        id: interaction.client.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.ManageMessages,
        ],
      },
    ],
    reason: `Encomenda ${orderId} - ${familyName}`,
  });

  const now = new Date();
  const doc = {
    _id: orderId,
    guild_id: guild.id,
    family_name: familyName,
    family_slug: familySlug,
    ammo_name: ammoName,
    quantity,
    unit_price_cents: unitPriceCents,
    original_value_cents: originalValueCents,
    discount_percent: discountPercent,
    discount_value_cents: discountValueCents,
    final_value_cents: finalValueCents,
    status: 'pending',
    order_category_id: category.id,
    order_channel_id: channel.id,
    order_message_id: null,
    created_by_id: interaction.user.id,
    created_by_name: interaction.user.tag || interaction.user.username || interaction.user.id,
    created_at: now,
    updated_at: now,
  };

  const panelEmbed = new EmbedBuilder()
    .setColor('#0EA5E9')
    .setTitle('Painel de Controle da Encomenda')
    .setDescription([
      `Familia: **${doc.family_name}**`,
      `Municao: **${doc.ammo_name}**`,
      `Quantidade: **${doc.quantity.toLocaleString('pt-BR')}**`,
      `Valor original: **${formatMoney(doc.original_value_cents)}**`,
      `Desconto: **${doc.discount_percent}%**`,
      `Valor final: **${formatMoney(doc.final_value_cents)}**`,
      '',
      'Status atual: **Aguardando**',
    ].join('\n'))
    .setFooter({ text: 'Vortex | Encomendas' })
    .setTimestamp();

  const message = await channel.send({
    embeds: [panelEmbed],
    components: [buildOrderButtons(String(orderId))],
    allowedMentions: { parse: [] },
  });

  doc.order_message_id = message.id;
  await orders.insertOne(doc);
  await logs.insertOne({
    guild_id: guild.id,
    order_id: String(orderId),
    action: 'created',
    actor_id: interaction.user.id,
    actor_name: interaction.user.tag || interaction.user.username || interaction.user.id,
    channel_id: channel.id,
    category_id: category.id,
    created_at: now,
  }).catch(() => null);

  return { ok: true, order: doc, channel };
}

async function updateOrderStatus(orderId, status, interaction, rejectionReason = null) {
  const orders = getCollection('orders');
  const logs = getCollection('order_logs');
  if (!orders || !logs) {
    return { ok: false, message: 'MongoDB nao esta conectado. Nao foi possivel atualizar a encomenda.' };
  }

  const now = new Date();
  const id = new mongoose.Types.ObjectId(orderId);
  const update = {
    status,
    updated_at: now,
    closed_at: now,
    decided_by_id: interaction.user.id,
    decided_by_name: interaction.user.tag || interaction.user.username || interaction.user.id,
  };
  if (rejectionReason) update.rejection_reason = rejectionReason;

  const result = await orders.findOneAndUpdate(
    { _id: id, status: 'pending' },
    { $set: update },
    { returnDocument: 'after' }
  );

  if (!result) {
    return { ok: false, message: 'Encomenda nao encontrada ou ja finalizada.' };
  }

  await logs.insertOne({
    guild_id: result.guild_id,
    order_id: orderId,
    action: status,
    actor_id: interaction.user.id,
    actor_name: interaction.user.tag || interaction.user.username || interaction.user.id,
    reason: rejectionReason,
    channel_id: interaction.channelId,
    created_at: now,
  }).catch(() => null);

  return { ok: true, order: result };
}

async function closeOrderPanel(interaction, order, status) {
  const orderId = String(order?._id || '');
  const components = orderId ? [buildOrderButtons(orderId, status)] : [];

  if (interaction.message?.editable) {
    await interaction.message.edit({ components }).catch(() => null);
    return;
  }

  const channelId = order?.order_channel_id;
  const messageId = order?.order_message_id;
  if (!channelId || !messageId) return;

  const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return;
  const message = await channel.messages.fetch(messageId).catch(() => null);
  if (message?.editable) await message.edit({ components }).catch(() => null);
}

async function handleOrderButton(interaction) {
  if (!hasOrderManagerPermission(interaction.member)) {
    return safeReply(interaction, { content: 'Voce nao tem permissao para alterar encomendas.', ephemeral: true });
  }

  if (interaction.customId === 'order_create') {
    return safeShowModal(interaction, buildCreateOrderModal());
  }

  const deliveredId = parseOrderId(interaction.customId, 'order_delivered_');
  if (deliveredId) {
    await safeDeferReply(interaction, { ephemeral: true });
    const result = await updateOrderStatus(deliveredId, 'delivered', interaction);
    if (!result.ok) return safeEdit(interaction, { content: result.message });
    await closeOrderPanel(interaction, result.order, 'delivered');
    await interaction.channel?.send({
      content: `Encomenda marcada como **Entregue** por <@${interaction.user.id}>.`,
      allowedMentions: { parse: [] },
    }).catch(() => null);
    return safeEdit(interaction, { content: 'Encomenda entregue e historico salvo.' });
  }

  const rejectedId = parseOrderId(interaction.customId, 'order_rejected_');
  if (rejectedId) {
    return safeShowModal(interaction, buildRejectModal(rejectedId));
  }

  return safeReply(interaction, { content: 'Acao de encomenda invalida.', ephemeral: true });
}

async function handleOrderModal(interaction) {
  if (!hasOrderManagerPermission(interaction.member)) {
    return safeReply(interaction, { content: 'Voce nao tem permissao para alterar encomendas.', ephemeral: true });
  }

  if (interaction.customId === 'modal_order_create') {
    await safeDeferReply(interaction, { ephemeral: true });
    const result = await createOrderFromInteraction(interaction, {
      familyName: interaction.fields.getTextInputValue('family_name'),
      ammoName: interaction.fields.getTextInputValue('ammo_name'),
      quantity: interaction.fields.getTextInputValue('quantity'),
      unitPrice: interaction.fields.getTextInputValue('unit_price'),
      discountPercent: interaction.fields.getTextInputValue('discount_percent') || '0',
    });

    if (!result.ok) return safeEdit(interaction, { content: result.message });
    return safeEdit(interaction, {
      content: [
        'Encomenda criada com sucesso.',
        `Canal: <#${result.channel.id}>`,
        `Familia: **${result.order.family_name}**`,
        `Valor final: **${formatMoney(result.order.final_value_cents)}**`,
      ].join('\n'),
      allowedMentions: { parse: [] },
    });
  }

  const orderId = parseOrderId(interaction.customId, 'modal_order_rejected_');
  if (!orderId) {
    return safeReply(interaction, { content: 'Formulario de encomenda invalido.', ephemeral: true });
  }

  await safeDeferReply(interaction, { ephemeral: true });
  const reason = interaction.fields.getTextInputValue('reason').trim();
  const result = await updateOrderStatus(orderId, 'rejected', interaction, reason);
  if (!result.ok) return safeEdit(interaction, { content: result.message });

  await closeOrderPanel(interaction, result.order, 'rejected');
  await interaction.channel?.send({
    content: [
      `Encomenda marcada como **Nao Entregue** por <@${interaction.user.id}>.`,
      `Motivo: ${reason}`,
    ].join('\n'),
    allowedMentions: { parse: [] },
  }).catch(() => null);

  return safeEdit(interaction, { content: 'Encomenda recusada, motivo salvo e painel fechado.' });
}

module.exports = {
  buildOrderPanelPayload,
  createOrderFromInteraction,
  handleOrderButton,
  handleOrderModal,
  hasOrderManagerPermission,
};
