const router = require('express').Router();
const mongoose = require('mongoose');
const { protect, adminOnly } = require('../middleware/auth');
const { CounselingBooking, counselingTypes } = require('../models/CounselingBooking');

router.get('/types', (req, res) => res.json({ success: true, types: counselingTypes }));
router.use(protect);
router.get('/my-bookings', async (req, res, next) => {
  try {
    const bookings = await CounselingBooking.find({ userId: req.user._id }).sort({ createdAt: -1 });
    res.json({ success: true, bookings });
  } catch (error) { next(error); }
});
router.post('/book', async (req, res, next) => {
  try {
    const { counselingType, name, phone, preferredDate, preferredTime, note = '' } = req.body;
    const strings = [counselingType, name, phone, preferredDate, preferredTime, note];
    const date = new Date(`${preferredDate}T${preferredTime}:00+06:00`);
    if (strings.some(v => typeof v !== 'string') || !name.trim() || name.trim().length > 100 ||
        !/^\+?[0-9][0-9\s-]{6,19}$/.test(phone.trim()) || note.length > 2000 ||
        !counselingTypes.some(t => t.value === counselingType) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(preferredDate) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(preferredTime) ||
        !Number.isFinite(date.getTime()) || date <= new Date() ||
        new Date(`${preferredDate}T00:00:00Z`).toISOString().slice(0, 10) !== preferredDate) {
      return res.status(400).json({ success: false, messageBn: 'সঠিক তথ্য ও ভবিষ্যতের তারিখ-সময় নির্বাচন করুন।' });
    }
    const booking = await CounselingBooking.create({ userId: req.user._id, counselingType, name, phone, preferredDate, preferredTime, note });
    res.status(201).json({ success: true, booking });
  } catch (error) { next(error); }
});
router.get('/admin/bookings', adminOnly, async (req, res, next) => {
  try {
    const bookings = await CounselingBooking.find().sort({ createdAt: -1 }).limit(200);
    res.json({ success: true, bookings });
  } catch (error) { next(error); }
});
router.patch('/admin/bookings/:id', adminOnly, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id) || !['pending', 'confirmed', 'completed', 'cancelled'].includes(req.body.status)) {
      return res.status(400).json({ success: false, messageBn: 'সঠিক স্ট্যাটাস নির্বাচন করুন।' });
    }
    const booking = await CounselingBooking.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true, runValidators: true });
    if (!booking) return res.status(404).json({ success: false, messageBn: 'বুকিং পাওয়া যায়নি।' });
    res.json({ success: true, booking });
  } catch (error) { next(error); }
});
module.exports = router;
