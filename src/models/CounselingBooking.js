const mongoose = require('mongoose');

const counselingTypes = [
  { value: 'marriage', label: '💍 Marriage Counseling', labelBn: 'বিবাহ কাউন্সেলিং' },
  { value: 'relationship', label: '❤️ Relationship Counseling', labelBn: 'সম্পর্ক কাউন্সেলিং' },
  { value: 'family', label: '👨‍👩‍👧 Family Counseling', labelBn: 'পারিবারিক কাউন্সেলিং' },
  { value: 'pre-marriage', label: '🤝 Pre-Marriage Counseling', labelBn: 'বিবাহ-পূর্ব কাউন্সেলিং' },
  { value: 'remarriage', label: '🔄 Remarriage Counseling', labelBn: 'পুনর্বিবাহ কাউন্সেলিং' },
  { value: 'compatibility', label: '🧠 Compatibility Discussion', labelBn: 'মানসিক সামঞ্জস্য আলোচনা' },
  { value: 'matrimonial', label: '📋 Matrimonial Guidance', labelBn: 'বিবাহবিষয়ক দিকনির্দেশনা' },
  { value: 'mental-health', label: '🌿 Mental Health Counseling', labelBn: 'মানসিক কাউন্সেলিং' },
];

const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  counselingType: { type: String, enum: counselingTypes.map(t => t.value), required: true },
  name: { type: String, required: true, trim: true, maxlength: 100 },
  phone: { type: String, required: true, trim: true, maxlength: 20 },
  preferredDate: { type: String, required: true },
  preferredTime: { type: String, required: true },
  note: { type: String, trim: true, maxlength: 2000, default: '' },
  status: { type: String, enum: ['pending', 'confirmed', 'completed', 'cancelled'], default: 'pending' },
}, { timestamps: true });

module.exports = { CounselingBooking: mongoose.model('CounselingBooking', schema), counselingTypes };
