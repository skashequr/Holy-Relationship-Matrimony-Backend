const mongoose = require('mongoose');

const pointUnlockSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    biodataId: { type: mongoose.Schema.Types.ObjectId, ref: 'Biodata', required: true },
    pointsUsed: { type: Number, default: 100 },
  },
  { timestamps: true }
);

pointUnlockSchema.index({ userId: 1, biodataId: 1 }, { unique: true });

module.exports = mongoose.model('PointUnlock', pointUnlockSchema);
