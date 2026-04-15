const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    type: {
      type: String,
      enum: [
        'profile_viewed',
        'shortlisted',
        'contact_unlocked',
        'biodata_approved',
        'biodata_rejected',
        'payment_success',
        'new_match',
        'system',
      ],
    },
    title: { type: String, required: true },
    titleBn: { type: String },
    message: { type: String, required: true },
    messageBn: { type: String },
    isRead: { type: Boolean, default: false },
    link: { type: String },
    metadata: { type: mongoose.Schema.Types.Mixed },
  },
  {
    timestamps: true,
  }
);

notificationSchema.index({ userId: 1, isRead: 1 });
notificationSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
