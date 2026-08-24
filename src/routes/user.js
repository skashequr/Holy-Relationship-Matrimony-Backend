const express = require('express');
const router = express.Router();
const cloudinary = require('cloudinary').v2;
const fs = require('fs');

const User = require('../models/User');
const Report = require('../models/Report');
const Notification = require('../models/Notification');
const { protect } = require('../middleware/auth');
const upload = require('../middleware/upload');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// @route  PUT /api/user/profile
// @desc   Update user profile (name, phone, language preference)
// @access Private
router.put('/profile', protect, async (req, res) => {
  const { name, phone, preferredLanguage } = req.body;

  try {
    const updateData = {};
    if (name) updateData.name = name;
    if (phone) updateData.phone = phone;
    if (preferredLanguage) updateData.preferredLanguage = preferredLanguage;

    const user = await User.findByIdAndUpdate(req.user._id, updateData, {
      new: true,
      runValidators: true,
    }).select('-password');

    res.json({ success: true, message: 'Profile updated.', user });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
});

// @route  POST /api/user/report
// @desc   Report a user
// @access Private
router.post('/report', protect, async (req, res) => {
  const { reportedUserId, reason, description } = req.body;

  if (!reportedUserId || !reason) {
    return res.status(400).json({ success: false, message: 'reportedUserId and reason are required.' });
  }

  try {
    // Check if already reported
    const existing = await Report.findOne({
      reportedBy: req.user._id,
      reportedUser: reportedUserId,
      status: 'pending',
    });

    if (existing) {
      return res.status(400).json({ success: false, message: 'You have already reported this user.' });
    }

    const report = await Report.create({
      reportedBy: req.user._id,
      reportedUser: reportedUserId,
      reason,
      description,
    });

    res.status(201).json({
      success: true,
      message: 'Report submitted. We will review it shortly.',
      messageBn: 'অভিযোগ জমা দেওয়া হয়েছে।',
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route  GET /api/user/notifications
// @desc   Get user notifications
// @access Private
router.get('/notifications', protect, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find({ userId: req.user._id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      Notification.countDocuments({ userId: req.user._id }),
      Notification.countDocuments({ userId: req.user._id, isRead: false }),
    ]);

    res.json({
      success: true,
      notifications,
      unreadCount,
      pagination: { total, page: Number(page), limit: Number(limit), totalPages: Math.ceil(total / Number(limit)) },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route  PUT /api/user/notifications/read-all
// @desc   Mark all notifications as read
// @access Private
router.put('/notifications/read-all', protect, async (req, res) => {
  try {
    await Notification.updateMany({ userId: req.user._id, isRead: false }, { isRead: true });
    res.json({ success: true, message: 'All notifications marked as read.' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route  PUT /api/user/notifications/:id/read
// @desc   Mark notification as read
// @access Private
router.put('/notifications/:id/read', protect, async (req, res) => {
  try {
    await Notification.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { isRead: true }
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route  DELETE /api/user/account
// @desc   Deactivate account
// @access Private
router.delete('/account', protect, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user._id, { isActive: false });
    res.json({ success: true, message: 'Account deactivated.' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route  POST /api/user/face-verify
// @desc   Submit selfie for face verification — auto-verifies the account
// @access Private
router.post('/face-verify', protect, upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No photo uploaded.', messageBn: 'কোনো ছবি আপলোড করা হয়নি।' });
    }

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    if (user.isFaceVerified) {
      if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.json({ success: true, message: 'Already face verified.', messageBn: 'ইতিমধ্যে যাচাই করা হয়েছে।' });
    }

    let photoUrl = null;
    if (process.env.CLOUDINARY_CLOUD_NAME) {
      try {
        const result = await cloudinary.uploader.upload(req.file.path, {
          folder: 'holy-matrimony/face-verifications',
          width: 400,
          height: 400,
          crop: 'fill',
          quality: 'auto',
        });
        photoUrl = result.secure_url;
      } catch (err) {
        console.error('Cloudinary face upload error:', err.message);
      }
    }
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

    await User.findByIdAndUpdate(req.user._id, {
      isFaceVerified: true,
      faceVerificationPhoto: photoUrl,
      isVerified: true,
      verificationBadge: true,
    });

    await Notification.create({
      userId: req.user._id,
      type: 'system',
      title: 'Face Verification Successful',
      titleBn: 'ফেস যাচাই সম্পন্ন',
      message: 'Your account has been verified via face verification.',
      messageBn: 'আপনার অ্যাকাউন্ট ফেস যাচাইয়ের মাধ্যমে স্বয়ংক্রিয়ভাবে যাচাই হয়েছে।',
      isRead: false,
    });

    res.json({ success: true, message: 'Face verified successfully.', messageBn: 'ফেস যাচাই সফল হয়েছে। আপনার অ্যাকাউন্ট যাচাই হয়েছে।' });
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    console.error('POST /api/user/face-verify error:', error.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
