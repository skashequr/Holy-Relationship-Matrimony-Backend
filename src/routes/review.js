const express = require('express');
const router = express.Router();

const Review = require('../models/Review');
const { protect } = require('../middleware/auth');

// @route  POST /api/reviews
// @desc   Submit a review (one per user)
// @access Private
router.post('/', protect, async (req, res) => {
  try {
    const { rating, comment, isMarried, marriedViaSite } = req.body;

    if (!rating || !comment) {
      return res.status(400).json({ success: false, message: 'Rating and comment are required.' });
    }
    if (rating < 1 || rating > 5) {
      return res.status(400).json({ success: false, message: 'Rating must be between 1 and 5.' });
    }
    if (comment.length > 500) {
      return res.status(400).json({ success: false, message: 'Comment cannot exceed 500 characters.' });
    }

    const existing = await Review.findOne({ userId: req.user._id });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'You have already submitted a review.',
        messageBn: 'আপনি ইতিমধ্যে একটি রিভিউ দিয়েছেন।',
      });
    }

    const review = await Review.create({
      userId: req.user._id,
      userName: req.user.name,
      userPhoto: req.user.profilePicture,
      rating: Number(rating),
      comment: comment.trim(),
      isMarried: !!isMarried,
      marriedViaSite: !!marriedViaSite,
    });

    res.status(201).json({
      success: true,
      message: 'Review submitted. Awaiting admin approval.',
      messageBn: 'রিভিউ জমা হয়েছে। অ্যাডমিন অনুমোদনের অপেক্ষায়।',
      review,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: 'You have already submitted a review.' });
    }
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route  GET /api/reviews/public
// @desc   Get approved reviews (public, paginated)
// @access Public
router.get('/public', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const [reviews, total] = await Promise.all([
      Review.find({ isApproved: true })
        .sort({ rating: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Review.countDocuments({ isApproved: true }),
    ]);

    const avg = reviews.reduce((sum, r) => sum + r.rating, 0) / (reviews.length || 1);
    res.json({
      success: true,
      reviews,
      averageRating: avg.toFixed(1),
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route  GET /api/reviews/my
// @desc   Get my own review
// @access Private
router.get('/my', protect, async (req, res) => {
  try {
    const review = await Review.findOne({ userId: req.user._id });
    res.json({ success: true, review });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
