const { Events } = require('discord.js');
const { handleFiveMActivityAlert } = require('../utils/fivemActivityAlertManager');
const { handlePresenceLiveAlert } = require('../utils/liveAlertManager');
const { logger } = require('../utils/logger');

module.exports = {
  name: Events.PresenceUpdate,
  async execute(oldPresence, newPresence) {
    await handlePresenceLiveAlert(oldPresence, newPresence).catch((error) => {
      logger.error('Erro ao processar alerta de live por presenca:', error);
    });

    await handleFiveMActivityAlert(oldPresence, newPresence).catch((error) => {
      logger.error('Erro ao processar atividade FiveM/ponto automatico:', error);
    });
  },
};
