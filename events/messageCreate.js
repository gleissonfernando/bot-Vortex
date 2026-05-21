const { Events } = require('discord.js');
const { handleMirrorMessage } = require('../utils/mirrorMessageManager');
const { handleCadastroMessage } = require('../utils/chatCadastroManager');
const { logger } = require('../utils/logger');

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
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
