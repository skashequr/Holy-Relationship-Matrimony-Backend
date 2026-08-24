const express = require('express');
const router = express.Router();
const RuqyahSlot = require('../models/RuqyahSlot');
const RuqyahBooking = require('../models/RuqyahBooking');
const { protect } = require('../middleware/auth');

// ── GET /api/ruqyah/slots ─────────────────────────────────────────────────
// Returns active, future, non-full slots
router.get('/slots', async (req, res) => {
  try {
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const slots = await RuqyahSlot.find({
      isActive: true,
      date: { $gte: now },
    }).sort({ date: 1, time: 1 });

    res.json({ success: true, slots });
  } catch (error) {
    console.error('GET /ruqyah/slots error:', error.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ── POST /api/ruqyah/book ─────────────────────────────────────────────────
router.post('/book', protect, async (req, res) => {
  try {
    const { slotId, name, phone, problem } = req.body;
    if (!slotId || !name || !phone || !problem) {
      return res.status(400).json({
        success: false,
        message: 'সব তথ্য পূরণ করুন।',
        messageBn: 'সব তথ্য পূরণ করুন।',
      });
    }

    const slot = await RuqyahSlot.findById(slotId);
    if (!slot || !slot.isActive) {
      return res.status(404).json({ success: false, messageBn: 'স্লটটি পাওয়া যায়নি।' });
    }
    if (slot.bookedCount >= slot.capacity) {
      return res.status(400).json({ success: false, messageBn: 'এই স্লটে আর বুকিং নেওয়া সম্ভব নয়।' });
    }

    // Prevent duplicate booking by same user for same slot
    const existing = await RuqyahBooking.findOne({ userId: req.user._id, slotId, status: { $ne: 'cancelled' } });
    if (existing) {
      return res.status(400).json({ success: false, messageBn: 'আপনি ইতিমধ্যে এই স্লটে বুকিং করেছেন।' });
    }

    const booking = await RuqyahBooking.create({
      userId: req.user._id,
      slotId,
      name: name.trim(),
      phone: phone.trim(),
      problem: problem.trim(),
    });

    // Increment booked count
    await RuqyahSlot.findByIdAndUpdate(slotId, { $inc: { bookedCount: 1 } });

    res.status(201).json({ success: true, messageBn: 'বুকিং সফলভাবে হয়েছে।', booking });
  } catch (error) {
    console.error('POST /ruqyah/book error:', error.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ── GET /api/ruqyah/my-bookings ───────────────────────────────────────────
router.get('/my-bookings', protect, async (req, res) => {
  try {
    const bookings = await RuqyahBooking.find({ userId: req.user._id })
      .populate('slotId', 'date time note')
      .sort({ createdAt: -1 });

    res.json({ success: true, bookings });
  } catch (error) {
    console.error('GET /ruqyah/my-bookings error:', error.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
