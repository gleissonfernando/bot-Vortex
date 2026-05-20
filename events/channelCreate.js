const { ChannelType } = require('discord.js');
const { syncTextChannelAccess } = require('../utils/textChannelAccess');
const { allowVoiceChannelAccess, syncVoiceChannelAccess } = require('../utils/voiceChannelAccess');
const { isPrimaryGuild } = require('../utils/guildScope');

module.exports = {
  name: 'channelCreate',
  async execute(channel) {
    if (!channel?.guild) return;
    if (!isPrimaryGuild(channel.guild.id)) return;

    if (channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice) {
      await allowVoiceChannelAccess(channel, channel.guild).catch(() => null);
      return;
    }

    if (channel.type === ChannelType.GuildCategory) {
      await syncVoiceChannelAccess(channel.guild).catch(() => null);
    }

    await syncTextChannelAccess(channel.guild).catch(() => null);
  },
};
