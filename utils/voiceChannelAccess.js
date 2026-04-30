const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { logger } = require('./logger');

const HIDDEN_CALL_ROLE_ID = '1497687531326673190';

async function allowVoiceChannelAccess(channel, guild) {
  if (!channel?.permissionOverwrites?.edit) return false;

  const botId = guild.client.user.id;
  await channel.permissionOverwrites.edit(botId, {
    ViewChannel: true,
    Connect: true,
    ReadMessageHistory: true,
    ManageChannels: true,
  }, { reason: 'Garantir acesso do bot Vortex às calls' }).catch(() => null);

  await channel.permissionOverwrites.edit(HIDDEN_CALL_ROLE_ID, {
    ViewChannel: true,
    Connect: true,
    ReadMessageHistory: true,
  }, { reason: 'Garantir acesso do cargo máximo às calls ocultas' }).catch(() => null);

  return true;
}

async function syncVoiceChannelAccess(guild) {
  try {
    const channels = await guild.channels.fetch().catch(() => guild.channels.cache);
    if (!channels) return false;

    const targets = channels.filter((channel) =>
      channel?.type === ChannelType.GuildVoice || channel?.type === ChannelType.GuildStageVoice
    );

    for (const channel of targets.values()) {
      await allowVoiceChannelAccess(channel, guild);
      if (channel.parent?.permissionOverwrites?.edit) {
        await channel.parent.permissionOverwrites.edit(guild.client.user.id, {
          ViewChannel: true,
        }, { reason: 'Garantir acesso do bot Vortex à categoria das calls' }).catch(() => null);
        await channel.parent.permissionOverwrites.edit(HIDDEN_CALL_ROLE_ID, {
          ViewChannel: true,
        }, { reason: 'Garantir acesso do cargo máximo à categoria das calls ocultas' }).catch(() => null);
      }
    }

    return true;
  } catch (error) {
    logger.error('Erro ao sincronizar acesso às calls:', error);
    return false;
  }
}

module.exports = {
  HIDDEN_CALL_ROLE_ID,
  allowVoiceChannelAccess,
  syncVoiceChannelAccess,
};
