const { Events } = require('discord.js');
const { handleRoleCreate } = require('../utils/antiAbuseManager');
const { logger } = require('../utils/logger');

module.exports = {
  name: Events.GuildRoleCreate,
  async execute(role) {
    await handleRoleCreate(role).catch((error) => {
      logger.error('Erro ao processar Anti-Abuso em roleCreate:', error);
    });
  },
};
