const mongoose = require('mongoose');

const UserVerificationSchema = new mongoose.Schema({
    discordId: { type: String, required: true, unique: true },
    token: { type: String, required: true },
    verified: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('UserVerification', UserVerificationSchema);
