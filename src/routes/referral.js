const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Referral = require('../models/Referral');
const PointUnlock = require('../models/PointUnlock');
const Biodata = require('../models/Biodata');
const { protect } = require('../middleware/auth');

const POINTS_PER_REFERRAL = 10;
const POINTS_TO_UNLOCK = 100;

// ── GET /api/referral/me ──────────────────────────────────────────────────
// My referral stats: code, points, referral count
router.get('/me', protect, async (req, res) => {
  try {
    let user = await User.findById(req.user._id).select('referralCode referralPoints referredBy');

    // Generate code for existing users who don't have one yet
    if (!user.referralCode) {
      const crypto = require('crypto');
      user.referralCode = crypto.randomBytes(3).toString('hex').toUpperCase();
      await user.save({ validateBeforeSave: false });
    }

    const [totalReferrals, rewarded, unlocks] = await Promise.all([
      Referral.countDocuments({ referrerId: req.user._id }),
      Referral.countDocuments({ referrerId: req.user._id, status: 'rewarded' }),
      PointUnlock.countDocuments({ userId: req.user._id }),
    ]);

    const baseUrl = 'https://www.holymarriagemedia.com';
    const referralLink = `${baseUrl}/register?ref=${user.referralCode}`;

    res.json({
      success: true,
      referralCode: user.referralCode,
      referralLink,
      points: user.referralPoints,
      pointsToUnlock: POINTS_TO_UNLOCK,
      unlockableCount: Math.floor(user.referralPoints / POINTS_TO_UNLOCK),
      totalReferrals,
      rewarded,
      unlocks,
    });
  } catch (error) {
    console.error('GET /referral/me error:', error.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ── GET /api/referral/list ────────────────────────────────────────────────
// List of my referrals with status
router.get('/list', protect, async (req, res) => {
  try {
    const referrals = await Referral.find({ referrerId: req.user._id })
      .populate('referredUserId', 'name createdAt')
      .sort({ createdAt: -1 })
      .limit(50);

    res.json({ success: true, referrals });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ── GET /api/referral/unlocked ────────────────────────────────────────────
// Which biodatas I unlocked with points
router.get('/unlocked', protect, async (req, res) => {
  try {
    const unlocks = await PointUnlock.find({ userId: req.user._id })
      .populate('biodataId', 'personal.name')
      .sort({ createdAt: -1 });
    res.json({ success: true, unlocks });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ── POST /api/referral/unlock/:biodataId ──────────────────────────────────
// Spend 100 points to unlock a biodata's contact info
router.post('/unlock/:biodataId', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('referralPoints');

    if (user.referralPoints < POINTS_TO_UNLOCK) {
      return res.status(400).json({
        success: false,
        messageBn: `আনলক করতে ${POINTS_TO_UNLOCK} পয়েন্ট দরকার। আপনার কাছে ${user.referralPoints} পয়েন্ট আছে।`,
      });
    }

    // Check if already unlocked
    const existing = await PointUnlock.findOne({ userId: req.user._id, biodataId: req.params.biodataId });
    if (existing) {
      return res.status(400).json({ success: false, messageBn: 'এই বায়োডেটা আগেই আনলক করা আছে।' });
    }

    // Check biodata exists and is approved
    const biodata = await Biodata.findById(req.params.biodataId);
    if (!biodata || biodata.status !== 'approved') {
      return res.status(404).json({ success: false, messageBn: 'বায়োডেটা পাওয়া যায়নি।' });
    }

    // Deduct points and create unlock record
    await User.findByIdAndUpdate(req.user._id, { $inc: { referralPoints: -POINTS_TO_UNLOCK } });
    await PointUnlock.create({ userId: req.user._id, biodataId: req.params.biodataId, pointsUsed: POINTS_TO_UNLOCK });

    res.json({ success: true, messageBn: 'বায়োডেটা আনলক হয়েছে!', pointsUsed: POINTS_TO_UNLOCK });
  } catch (error) {
    console.error('POST /referral/unlock error:', error.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ── GET /api/referral/check/:biodataId ───────────────────────────────────
// Check if current user has unlocked a specific biodata with points
router.get('/check/:biodataId', protect, async (req, res) => {
  try {
    const unlock = await PointUnlock.findOne({ userId: req.user._id, biodataId: req.params.biodataId });
    res.json({ success: true, isUnlocked: !!unlock });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
