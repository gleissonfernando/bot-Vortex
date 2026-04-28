const { Events } = require('discord.js');
const { handleVoiceLiveAlert } = require('../utils/liveAlertManager');

module.exports = {
  name: Events.VoiceStateUpdate,
  async execute(oldState, newState) {
    await handleVoiceLiveAlert(oldState, newState);
  },
};
