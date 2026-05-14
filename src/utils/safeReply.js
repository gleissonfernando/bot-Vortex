const { logger } = require('./logger');

function isAlreadyAcknowledgedError(error) {
  return error?.code === 40060
    || error?.rawError?.code === 40060
    || String(error?.message || '').includes('already been acknowledged');
}

function isUnknownInteractionError(error) {
  return error?.code === 10062
    || error?.rawError?.code === 10062
    || String(error?.message || '').includes('Unknown interaction');
}

function getInteractionContext(interaction, extra = {}) {
  return {
    commandName: interaction?.commandName || interaction?.customId || 'unknown',
    customId: interaction?.customId || null,
    userId: interaction?.user?.id || null,
    guildId: interaction?.guildId || interaction?.guild?.id || null,
    channelId: interaction?.channelId || interaction?.channel?.id || null,
    replied: Boolean(interaction?.replied),
    deferred: Boolean(interaction?.deferred),
    at: new Date().toISOString(),
    ...extra,
  };
}

function logInteractionError(interaction, error, action = 'interaction_response') {
  if (isUnknownInteractionError(error)) return;
  logger.error(`Erro ao responder interação: ${action}`, error, getInteractionContext(interaction));
}

async function safeReply(interaction, options = {}) {
  // Use reply() apenas na primeira resposta da interação.
  // Se a interação já foi respondida ou deferida, use followUp().
  try {
    if (!interaction?.isRepliable?.()) return null;
    if (interaction.replied || interaction.deferred) {
      return await interaction.followUp(options);
    }
    return await interaction.reply(options);
  } catch (error) {
    if (isAlreadyAcknowledgedError(error)) {
      return interaction.followUp(options).catch((followError) => {
        logInteractionError(interaction, followError, 'safeReply.followUp_after_40060');
        return null;
      });
    }
    logInteractionError(interaction, error, 'safeReply');
    return null;
  }
}

async function safeEdit(interaction, options = {}) {
  // Use editReply() obrigatoriamente depois de deferReply().
  // Se não houver defer/reply anterior, cai para safeReply().
  try {
    if (!interaction?.isRepliable?.()) return null;
    if (interaction.deferred || interaction.replied) {
      return await interaction.editReply(options);
    }
    return await safeReply(interaction, options);
  } catch (error) {
    if (isAlreadyAcknowledgedError(error)) {
      return interaction.followUp(options).catch((followError) => {
        logInteractionError(interaction, followError, 'safeEdit.followUp_after_40060');
        return null;
      });
    }
    return interaction.followUp(options).catch(() => {
      logInteractionError(interaction, error, 'safeEdit');
      return null;
    });
  }
}

async function safeDeferReply(interaction, options = {}) {
  // Use deferReply() quando o processamento vai demorar.
  // Depois disso, finalize com safeEdit()/editReply(), nunca reply().
  try {
    if (!interaction?.isRepliable?.()) return false;
    if (interaction.replied || interaction.deferred) return true;
    await interaction.deferReply(options);
    return true;
  } catch (error) {
    if (isAlreadyAcknowledgedError(error)) return true;
    logInteractionError(interaction, error, 'safeDeferReply');
    return false;
  }
}

async function safeShowModal(interaction, modal, fallbackMessage = '❌ Essa interação já foi processada. Clique novamente para abrir o formulário.') {
  // Modais precisam ser a primeira resposta da interação.
  // Se a interação já foi respondida/deferida, não tente showModal().
  try {
    if (interaction.replied || interaction.deferred) {
      return safeReply(interaction, { content: fallbackMessage, ephemeral: true });
    }
    return await interaction.showModal(modal);
  } catch (error) {
    if (isAlreadyAcknowledgedError(error)) {
      return safeReply(interaction, { content: fallbackMessage, ephemeral: true });
    }
    logInteractionError(interaction, error, 'safeShowModal');
    throw error;
  }
}

async function safeUpdate(interaction, options = {}) {
  // Em botões/select menus, use update() para alterar a mensagem original.
  // Se já houve defer/reply, use editReply()/followUp() em vez de reply().
  try {
    if (interaction.replied || interaction.deferred) {
      return await interaction.editReply(options);
    }
    return await interaction.update(options);
  } catch (error) {
    if (isAlreadyAcknowledgedError(error)) {
      return safeEdit(interaction, options);
    }
    logInteractionError(interaction, error, 'safeUpdate');
    return null;
  }
}

async function safeDeferUpdate(interaction) {
  // Use deferUpdate() em botões/select menus quando vai processar e responder depois.
  // Depois use followUp() para mensagem nova ou editReply() para alterar resposta existente.
  try {
    if (interaction.replied || interaction.deferred) return true;
    await interaction.deferUpdate();
    return true;
  } catch (error) {
    if (isAlreadyAcknowledgedError(error)) return true;
    logInteractionError(interaction, error, 'safeDeferUpdate');
    return false;
  }
}

module.exports = {
  safeReply,
  safeEdit,
  safeDeferReply,
  safeShowModal,
  safeUpdate,
  safeDeferUpdate,
  getInteractionContext,
  logInteractionError,
  isAlreadyAcknowledgedError,
  isUnknownInteractionError,
};
