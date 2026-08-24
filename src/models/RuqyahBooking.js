const mongoose = require('mongoose');

const ruqyahBookingSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    slotId: { type: mongoose.Schema.Types.ObjectId, ref: 'RuqyahSlot', required: true },
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    problem: { type: String, required: true, trim: true },
    paymentStatus: {
      type: String,
      enum: ['pending', 'paid'],
      default: 'pending',
    },
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'cancelled'],
      default: 'pending',
    },
    adminNote: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('RuqyahBooking', ruqyahBookingSchema);
