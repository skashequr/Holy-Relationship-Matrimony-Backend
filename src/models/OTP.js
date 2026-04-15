const mongoose = require('mongoose');

const otpSchema = new mongoose.Schema(
  {
    identifier: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      enum: ['email', 'phone'],
      required: true,
    },
    otp: {
      type: String,
      required: true,
    },
    purpose: {
      type: String,
      enum: ['registration', 'login', 'reset_password', 'verify'],
      required: true,
    },
    attempts: {
      type: Number,
      default: 0,
    },
    isUsed: {
      type: Boolean,
      default: false,
    },
    // Stores pending registration data so the user is only created after OTP is verified
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expireAfterSeconds: 0 },
    },
  },
  {
    timestamps: true,
  }
);

// Fast lookup for verify-otp and send-otp routes
otpSchema.index({ identifier: 1, purpose: 1, isUsed: 1 });

module.exports = mongoose.model('OTP', otpSchema);
