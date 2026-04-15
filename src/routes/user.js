const express = require('express');
const router = express.Router();

const User = require('../models/User');
const Report = require('../models/Report');
const Notification = require('../models/Notification');
const { protect } = require('../middleware/auth');

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

module.exports = router;
