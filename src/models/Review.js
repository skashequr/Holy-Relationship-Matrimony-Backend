const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    userName: { type: String, required: true },
    userPhoto: { type: String, default: null },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, required: true, maxlength: 500, trim: true },
    isApproved: { type: Boolean, default: false },
    isMarried: { type: Boolean, default: false },
    marriedViaSite: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Review', reviewSchema);
