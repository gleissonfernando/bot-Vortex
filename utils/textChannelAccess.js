const { ChannelType } = require('discord.js');
const { logger } = require('./logger');

function isTextChannel(channel) {
  return Boolean(
    channel
    && channel.permissionOverwrites?.edit
    && (
      channel.type === ChannelType.GuildText
      || channel.type === ChannelType.GuildAnnouncement
      || channel.type === ChannelType.GuildForum
      || channel.isThread?.()
    )
  );
}

async function allowTextChannelAccess(channel, guild) {
  if (!isTextChannel(channel)) return false;

  const botId = guild.client.user.id;
  await channel.permissionOverwrites.edit(botId, {
    ViewChannel: true,
    ReadMessageHistory: true,
    SendMessages: true,
  }, { reason: 'Garantir acesso do bot Vortex aos canais de texto' }).catch(() => null);

  return true;
}

async function syncTextChannelAccess(guild) {
  try {
    const channels = await guild.channels.fetch().catch(() => guild.channels.cache);
    if (!channels) return false;

    const targets = channels.filter((channel) => isTextChannel(channel));
    for (const channel of targets.values()) {
      await allowTextChannelAccess(channel, guild);
    }

    return true;
  } catch (error) {
    logger.error('Erro ao sincronizar acesso aos canais de texto:', error);
    return false;
  }
}

module.exports = {
  allowTextChannelAccess,
  syncTextChannelAccess,
};
