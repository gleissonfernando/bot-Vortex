const { Events } = require('discord.js');
const { handlePresenceLiveAlert } = require('../utils/liveAlertManager');

module.exports = {
  name: Events.PresenceUpdate,
  async execute(oldPresence, newPresence) {
    await handlePresenceLiveAlert(oldPresence, newPresence);
  },
};
