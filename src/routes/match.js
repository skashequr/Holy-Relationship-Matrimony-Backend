const express = require('express');
const router = express.Router();

const User = require('../models/User');
const Biodata = require('../models/Biodata');
const { protect } = require('../middleware/auth');
const { getRecommendedMatches, sanitizeBiodata, calculateProfileCompleteness } = require('../services/matchService');

// @route  GET /api/match/recommended
// @desc   Get recommended matches
// @access Private
router.get('/recommended', protect, async (req, res) => {
  try {
    const { page = 1, limit = 12, minScore = 0 } = req.query;
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
        percentage: 0,
        sections: [],
        suggestions: [{ section: 'বায়োডেটা', field: 'বায়োডেটা তৈরি করুন', pts: 100 }],
        totalEarned: 0,
        totalMax: 100,
      });
    }
    const result = calculateProfileCompleteness(biodata, req.user.gender);
    res.json({ success: true, ...result });
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
