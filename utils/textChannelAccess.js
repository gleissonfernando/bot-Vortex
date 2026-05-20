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

async function fetchTextChannels(guild) {
  const fetched = await guild.channels.fetch().catch(() => null);
  const source = fetched || guild.channels.cache;
  return source
    .filter((channel) => isTextChannel(channel))
    .sort((a, b) => {
      const parentCompare = String(a.parent?.name || '').localeCompare(String(b.parent?.name || ''));
      if (parentCompare) return parentCompare;
      return (a.rawPosition ?? 0) - (b.rawPosition ?? 0) || String(a.name || '').localeCompare(String(b.name || ''));
    });
}

async function syncTextChannelAccess(guild) {
  try {
    const channels = await fetchTextChannels(guild);
    if (!channels) return false;

    for (const channel of channels.values()) {
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
  fetchTextChannels,
  isTextChannel,
  syncTextChannelAccess,
};
