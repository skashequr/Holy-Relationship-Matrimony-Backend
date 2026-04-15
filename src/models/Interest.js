const mongoose = require('mongoose');

const interestSchema = new mongoose.Schema(
  {
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    receiverId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    biodataId: { type: mongoose.Schema.Types.ObjectId, ref: 'Biodata', required: true },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'rejected'],
      default: 'pending',
    },
    message: { type: String, maxlength: 300, trim: true },
  },
  { timestamps: true }
);

// One interest per sender-receiver pair
interestSchema.index({ senderId: 1, receiverId: 1 }, { unique: true });

module.exports = mongoose.model('Interest', interestSchema);
