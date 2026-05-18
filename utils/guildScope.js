const config = require('../config/config');

function normalizeGuildId(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (/^\d{15,25}$/.test(text)) return text;
  const match = text.match(/\d{15,25}/);
  return match ? match[0] : null;
}

function getPrimaryGuildId() {
  return normalizeGuildId(config.guildId);
}

function isPrimaryGuild(guildId) {
  const primaryGuildId = getPrimaryGuildId();
  if (!primaryGuildId) return true;
  return String(guildId || '') === primaryGuildId;
}

function isPrimaryGuildChannel(channel) {
  if (!channel?.guildId) return true;
  return isPrimaryGuild(channel.guildId);
}

module.exports = {
  normalizeGuildId,
  getPrimaryGuildId,
  isPrimaryGuild,
  isPrimaryGuildChannel,
};
