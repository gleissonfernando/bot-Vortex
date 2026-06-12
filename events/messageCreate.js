const { Events } = require('discord.js');
const { handleMirrorMessage } = require('../utils/mirrorMessageManager');
const { handleCadastroMessage } = require('../utils/chatCadastroManager');
const { handleWebhookMessage } = require('../utils/antiAbuseManager');
const { logger } = require('../utils/logger');
const { buildMaintenanceEmbed, isMaintenanceMode, readMaintenanceConfig } = require('../utils/maintenanceMode');

const maintenanceAlertCooldown = new Map();

function shouldSendMaintenanceAlert(message) {
  if (message.author?.bot) return false;
  if (!message.client?.user?.id) return false;
  if (!message.mentions?.users?.has(message.client.user.id)) return false;

  const key = `${message.guildId || 'dm'}:${message.channelId}:${message.author.id}`;
  const now = Date.now();
  const last = maintenanceAlertCooldown.get(key) || 0;
  if (now - last < 60 * 1000) return false;
  maintenanceAlertCooldown.set(key, now);
  return true;
}

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    if (isMaintenanceMode()) {
      if (shouldSendMaintenanceAlert(message)) {
        await message.reply({
          embeds: [buildMaintenanceEmbed(message.client, readMaintenanceConfig())],
          allowedMentions: { repliedUser: false, parse: [] },
        }).catch(() => null);
      }
      return;
    }

    const handledWebhook = await handleWebhookMessage(message).catch((error) => {
      logger.error('Erro ao processar Anti-Abuso de webhook:', error);
      return false;
    });
    if (handledWebhook) return;

    const handledCadastro = await handleCadastroMessage(message).catch((error) => {
      logger.error('Erro ao processar modo cadastro:', error);
      return false;
    });
    if (handledCadastro) return;

    await handleMirrorMessage(message).catch((error) => {
      logger.error('Erro ao processar mensagem espelhada:', error);
    });
  },
};
