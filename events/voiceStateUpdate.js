const { Events } = require('discord.js');
const { handleVoiceStateUpdate } = require('../config/callManager');
const { handleVoiceStateUpdate: handleAntiAbuseVoiceStateUpdate } = require('../utils/antiAbuseManager');
const { allowVoiceChannelAccess } = require('../utils/voiceChannelAccess');
const { isPrimaryGuild } = require('../utils/guildScope');
const { logger } = require('../utils/logger');
const { isMaintenanceMode } = require('../utils/maintenanceMode');

module.exports = {
  name: Events.VoiceStateUpdate,
  async execute(oldState, newState) {
    if (isMaintenanceMode()) return;

    const guild = newState.guild || oldState.guild;
    if (!guild) return;

    await handleAntiAbuseVoiceStateUpdate(oldState, newState).catch((error) => {
      logger.error('Erro ao processar Anti-Abuso em voiceStateUpdate:', error);
    });

    if (!isPrimaryGuild(guild.id)) return;

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
