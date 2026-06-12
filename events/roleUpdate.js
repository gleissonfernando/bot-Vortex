const { Events } = require('discord.js');
const { handleRoleUpdate } = require('../utils/antiAbuseManager');
const { logger } = require('../utils/logger');

module.exports = {
  name: Events.GuildRoleUpdate,
  async execute(oldRole, newRole) {
    await handleRoleUpdate(oldRole, newRole).catch((error) => {
      logger.error('Erro ao processar Anti-Abuso em roleUpdate:', error);
    });
  },
};
