const { Events } = require('discord.js');
const { handleChannelDelete } = require('../utils/antiAbuseManager');
const { logger } = require('../utils/logger');

module.exports = {
  name: Events.ChannelDelete,
  async execute(channel) {
    await handleChannelDelete(channel).catch((error) => {
      logger.error('Erro ao processar Anti-Abuso em channelDelete:', error);
    });
  },
};
