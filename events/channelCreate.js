const { ChannelType } = require('discord.js');
const { syncTextChannelAccess } = require('../utils/textChannelAccess');
const { allowVoiceChannelAccess, syncVoiceChannelAccess } = require('../utils/voiceChannelAccess');
const { handleChannelCreate } = require('../utils/antiAbuseManager');
const { isPrimaryGuild } = require('../utils/guildScope');
const { isMaintenanceMode } = require('../utils/maintenanceMode');

module.exports = {
  name: 'channelCreate',
  async execute(channel) {
    if (isMaintenanceMode()) return;

    if (!channel?.guild) return;

    await handleChannelCreate(channel).catch(() => null);

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
