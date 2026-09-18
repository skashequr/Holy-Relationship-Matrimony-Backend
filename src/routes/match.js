const express = require('express');
const router = express.Router();

const User = require('../models/User');
const Biodata = require('../models/Biodata');
const { getDashboardSummary } = require('../services/dashboardService');
const { protect } = require('../middleware/auth');
const { getRecommendedMatches, sanitizeBiodata, calculateProfileCompleteness } = require('../services/matchService');

// Personal dashboard overview; never accept a user id from the client.
router.get('/dashboard', protect, async (req, res) => {
  try {
    res.json({ success: true, ...await getDashboardSummary(req.user) });
  } catch {
    res.status(500).json({ success: false, messageBn: 'ড্যাশবোর্ডের তথ্য পাওয়া যায়নি। আবার চেষ্টা করুন।' });
  }
});

// @route  GET /api/match/recommended
// @desc   Get recommended matches
// @access Private
router.get('/recommended', protect, async (req, res) => {
  try {
    const rawPage = Number(req.query.page);
    const page = Number.isFinite(rawPage) ? Math.max(1, Math.floor(rawPage) || 1) : 1;
    const limit = Math.min(50, Math.max(1, Math.floor(Number(req.query.limit) || 12)));
    const minScore = Math.min(100, Math.max(0, Number(req.query.minScore) || 0));
    const result = await getRecommendedMatches(
      req.user._id,
      Number(limit),
      Number(page),
      Number(minScore)
    );
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
});

// @route  GET /api/match/shortlist
// @desc   Get shortlisted profiles
// @access Private
router.get('/shortlist', protect, async (req, res) => {
  try {
    const { page = 1, limit = 12 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const user = await User.findById(req.user._id);
    const shortlistedIds = user.shortlistedProfiles;

    const [biodatas, total] = await Promise.all([
      Biodata.find({ userId: { $in: shortlistedIds }, status: 'approved' })
        .populate('userId', 'name gender profilePicture isVerified verificationBadge')
        .skip(skip)
        .limit(Number(limit))
        .sort({ createdAt: -1 }),
      Biodata.countDocuments({ userId: { $in: shortlistedIds }, status: 'approved' }),
    ]);

    const sanitizedBiodatas = biodatas.map((b) => sanitizeBiodata(b, user));

    res.json({
      success: true,
      data: sanitizedBiodatas,
      pagination: { total, page: Number(page), limit: Number(limit), totalPages: Math.ceil(total / Number(limit)) },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route  GET /api/match/new-profiles
// @desc   Get newly joined profiles
// @access Private
router.get('/new-profiles', protect, async (req, res) => {
  try {
    const targetGender = req.user.gender === 'male' ? 'female' : 'male';
    const targetUsers = await User.find({ gender: targetGender, isActive: true, isBanned: false }).select('_id');

    const biodatas = await Biodata.find({
      userId: { $in: targetUsers.map((u) => u._id) },
      status: 'approved',
      isActive: true,
      isMarried: { $ne: true },
    })
      .populate('userId', 'name gender profilePicture isVerified verificationBadge')
      .sort({ createdAt: -1 })
      .limit(8);

    const viewer = await User.findById(req.user._id);
    const sanitized = biodatas.map((b) => sanitizeBiodata(b, viewer));

    res.json({ success: true, data: sanitized });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route  GET /api/match/profile-completeness
// @desc   Get profile completeness percentage and suggestions
// @access Private
router.get('/profile-completeness', protect, async (req, res) => {
  try {
    const biodata = await Biodata.findOne({ userId: req.user._id });
    if (!biodata) {
      return res.json({
        success: true,
        biodata: null,
        percentage: 0,
        sections: [],
        suggestions: [{ section: 'বায়োডেটা', field: 'বায়োডেটা তৈরি করুন', pts: 100 }],
        totalEarned: 0,
        totalMax: 100,
      });
    }
    const result = calculateProfileCompleteness(biodata, req.user.gender);
    res.json({ success: true, ...result, biodata: {
      _id: biodata._id, status: biodata.status, isActive: biodata.isActive,
      isMarried: biodata.isMarried, biodataNumber: biodata.biodataNumber,
      rejectionReason: biodata.rejectionReason,
    } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route  GET /api/match/stats
// @desc   Get platform statistics
// @access Public
router.get('/stats', async (req, res) => {
  try {
    const [totalUsers, maleBiodatas, femaleBiodatas, approvedBiodatas] = await Promise.all([
      User.countDocuments({ isActive: true, isBanned: false }),
      User.countDocuments({ gender: 'male', isActive: true }),
      User.countDocuments({ gender: 'female', isActive: true }),
      Biodata.countDocuments({ status: 'approved' }),
    ]);

    res.json({
      success: true,
      stats: {
        totalUsers,
        maleBiodatas,
        femaleBiodatas,
        approvedBiodatas,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
