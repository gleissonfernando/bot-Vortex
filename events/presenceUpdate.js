const { Events } = require('discord.js');
const { handleFiveMActivityAlert } = require('../utils/fivemActivityAlertManager');
const { logger } = require('../utils/logger');

module.exports = {
  name: Events.PresenceUpdate,
  async execute(oldPresence, newPresence) {
    await handleFiveMActivityAlert(oldPresence, newPresence).catch((error) => {
      logger.error('Erro ao processar atividade FiveM/ponto automatico:', error);
    });
  },
};
