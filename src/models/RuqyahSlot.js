const mongoose = require('mongoose');

const ruqyahSlotSchema = new mongoose.Schema(
  {
    date: { type: Date, required: true },
    time: { type: String, required: true }, // e.g. "10:00 AM"
    capacity: { type: Number, default: 1, min: 1 },
    bookedCount: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    note: { type: String, default: '' }, // admin note for this slot
  },
  { timestamps: true }
);

// Virtual: is this slot full?
ruqyahSlotSchema.virtual('isFull').get(function () {
  return this.bookedCount >= this.capacity;
});

ruqyahSlotSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('RuqyahSlot', ruqyahSlotSchema);
