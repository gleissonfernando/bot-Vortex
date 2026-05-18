const { syncTextChannelAccess } = require('../utils/textChannelAccess');
const { isPrimaryGuild } = require('../utils/guildScope');

module.exports = {
  name: 'channelCreate',
  async execute(channel) {
    if (!channel?.guild) return;
    if (!isPrimaryGuild(channel.guild.id)) return;
    await syncTextChannelAccess(channel.guild).catch(() => null);
  },
};
