const { Events } = require('discord.js');
const { handleMirrorMessage } = require('../utils/mirrorMessageManager');
const { logger } = require('../utils/logger');

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    await handleMirrorMessage(message).catch((error) => {
      logger.error('Erro ao processar mensagem espelhada:', error);
    });
  },
};
