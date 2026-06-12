const { Events } = require('discord.js');
const { handleChannelUpdate } = require('../utils/antiAbuseManager');
const { logger } = require('../utils/logger');

module.exports = {
  name: Events.ChannelUpdate,
  async execute(oldChannel, newChannel) {
    await handleChannelUpdate(oldChannel, newChannel).catch((error) => {
      logger.error('Erro ao processar Anti-Abuso em channelUpdate:', error);
    });
  },
};
