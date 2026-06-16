const mongoose = require('mongoose');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { hasVortexLevel } = require('./permissions');
const { safeDeferReply, safeEdit, safeReply, safeShowModal } = require('./safeReply');

function hasOrderManagerPermission(member) {
  return hasVortexLevel(member, ['admin', 'medio'])
    || Boolean(member?.permissions?.has?.(PermissionFlagsBits.ManageChannels));
}

function getCollection(name) {
  if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) return null;
  return mongoose.connection.db.collection(name);
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
  handleOrderButton,
  handleOrderModal,
};
