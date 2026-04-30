const { syncTextChannelAccess } = require('../utils/textChannelAccess');

module.exports = {
  name: 'channelCreate',
  async execute(channel) {
    if (!channel?.guild) return;
    await syncTextChannelAccess(channel.guild).catch(() => null);
  },
};
