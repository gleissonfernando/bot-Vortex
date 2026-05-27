const { Events } = require('discord.js');
const { handleVoiceStateUpdate } = require('../config/callManager');
const { allowVoiceChannelAccess } = require('../utils/voiceChannelAccess');
const { isPrimaryGuild } = require('../utils/guildScope');
const { logger } = require('../utils/logger');
const { isMaintenanceMode } = require('../utils/maintenanceMode');

module.exports = {
  name: Events.VoiceStateUpdate,
  async execute(oldState, newState) {
    if (isMaintenanceMode()) return;

    const guild = newState.guild || oldState.guild;
    if (!guild || !isPrimaryGuild(guild.id)) return;

    const channel = newState.channel || oldState.channel;
    if (channel) {
      await allowVoiceChannelAccess(channel, guild).catch((error) => {
        logger.warn(`Nao foi possivel garantir acesso à call ${channel.id}: ${error.message}`);
      });
    }

    await handleVoiceStateUpdate(oldState, newState, guild.client).catch((error) => {
      logger.error('Erro ao processar voiceStateUpdate:', error);
    });
  },
};
