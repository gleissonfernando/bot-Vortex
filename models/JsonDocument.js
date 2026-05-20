const mongoose = require('mongoose');

const JsonDocumentSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, index: true },
  sourcePath: { type: String, default: null },
  data: { type: mongoose.Schema.Types.Mixed, default: {} },
  updatedAt: { type: Date, default: Date.now, index: true },
}, {
  minimize: false,
});

JsonDocumentSchema.pre('save', function updateTimestamp(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.models.JsonDocument || mongoose.model('JsonDocument', JsonDocumentSchema);
