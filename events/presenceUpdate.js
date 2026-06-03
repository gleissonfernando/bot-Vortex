const { Events } = require('discord.js');
const { handleFiveMActivityAlert } = require('../utils/fivemActivityAlertManager');
const { syncPresence } = require('../utils/frequencyDashboardSync');
const { logger } = require('../utils/logger');
const { isMaintenanceMode } = require('../utils/maintenanceMode');

module.exports = {
  name: Events.PresenceUpdate,
  async execute(oldPresence, newPresence) {
    if (isMaintenanceMode()) return;

    await handleFiveMActivityAlert(oldPresence, newPresence).catch((error) => {
      logger.error('Erro ao processar atividade FiveM:', error);
    });
    await syncPresence(newPresence);
  },
};
