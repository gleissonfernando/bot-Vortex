const { Events } = require('discord.js');
const { handleRoleDelete } = require('../utils/antiAbuseManager');
const { logger } = require('../utils/logger');

module.exports = {
  name: Events.GuildRoleDelete,
  async execute(role) {
    await handleRoleDelete(role).catch((error) => {
      logger.error('Erro ao processar Anti-Abuso em roleDelete:', error);
    });
  },
};
