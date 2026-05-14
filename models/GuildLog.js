const mongoose = require('mongoose');

const GuildLogSchema = new mongoose.Schema({
  guildId: { type: String, required: true, index: true },
  type: { type: String, default: 'info', index: true },
  title: { type: String, default: 'Evento' },
  description: { type: String, default: '' },
  userId: { type: String, default: null, index: true },
  userName: { type: String, default: null },
  userAvatar: { type: String, default: null },
  channelId: { type: String, default: null },
  channelName: { type: String, default: null },
  messageId: { type: String, default: null },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  severity: { type: String, default: 'low', index: true },
  ipAddress: { type: String, default: null },
  userAgent: { type: String, default: null },
  createdAt: { type: Date, default: Date.now, index: true },
});

GuildLogSchema.index({ guildId: 1, createdAt: -1 });
GuildLogSchema.index({ guildId: 1, type: 1, createdAt: -1 });

module.exports = mongoose.models.GuildLog || mongoose.model('GuildLog', GuildLogSchema);
