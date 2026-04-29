const { Events } = require('discord.js');
const { handleFiveMActivityAlert } = require('../utils/fivemActivityAlertManager');
const { handlePresenceLiveAlert } = require('../utils/liveAlertManager');

module.exports = {
  name: Events.PresenceUpdate,
  async execute(oldPresence, newPresence) {
    await handlePresenceLiveAlert(oldPresence, newPresence);
    await handleFiveMActivityAlert(oldPresence, newPresence);
  },
};
