const mongoose = require('mongoose');

const referralSchema = new mongoose.Schema(
  {
    referrerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    referredUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status: {
      type: String,
      enum: ['pending', 'rewarded'],
      default: 'pending',
    },
    pointsAwarded: { type: Number, default: 0 },
    rewardedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

referralSchema.index({ referrerId: 1 });
referralSchema.index({ referredUserId: 1 }, { unique: true });

module.exports = mongoose.model('Referral', referralSchema);
