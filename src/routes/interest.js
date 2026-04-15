const express = require('express');
const router = express.Router();

const Interest = require('../models/Interest');
const Biodata = require('../models/Biodata');
const User = require('../models/User');
const Conversation = require('../models/Conversation');
const { protect } = require('../middleware/auth');
const { createNotification } = require('../services/notificationService');

// @route  POST /api/interests
// @desc   Send interest to a biodata owner
// @access Private
router.post('/', protect, async (req, res) => {
  try {
    const { biodataId, message } = req.body;

    if (!biodataId) {
      return res.status(400).json({
        success: false,
        message: 'biodataId is required.',
        messageBn: 'বায়োডেটা ID পাওয়া যায়নি।',
      });
    }

    // Validate ObjectId format before querying
    if (!biodataId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid biodataId.',
        messageBn: 'বায়োডেটা ID সঠিক নয়।',
      });
    }

    const biodata = await Biodata.findById(biodataId);
    if (!biodata) {
      return res.status(404).json({
        success: false,
        message: 'Biodata not found.',
        messageBn: 'বায়োডেটা পাওয়া যায়নি।',
      });
    }

    const receiverId = biodata.userId.toString();
    const senderId = req.user._id.toString();

    if (receiverId === senderId) {
      return res.status(400).json({
        success: false,
        message: 'Cannot send interest to yourself.',
        messageBn: 'নিজেকে Interest পাঠানো যাবে না।',
      });
    }

    // Free users: max 3 interests per month
    if (!req.user.isPremium) {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      const count = await Interest.countDocuments({ senderId, createdAt: { $gte: monthStart } });
      if (count >= 3) {
        return res.status(403).json({
          success: false,
          message: 'Free users can send max 3 interests per month.',
          messageBn: 'ফ্রি সদস্যরা মাসে সর্বোচ্চ ৩টি Interest পাঠাতে পারবেন। প্রিমিয়াম নিন।',
        });
      }
    }

    // Check for existing interest
    const existing = await Interest.findOne({ senderId, receiverId });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'Interest already sent.',
        messageBn: 'ইতিমধ্যে Interest পাঠানো হয়েছে।',
      });
    }

    const interest = await Interest.create({ senderId, receiverId, biodataId, message });

    await createNotification({
      userId: receiverId,
      type: 'system',
      title: 'New Interest',
      titleBn: 'নতুন Interest',
      message: `${req.user.name} sent you an interest.`,
      messageBn: `${req.user.name} আপনাকে Interest পাঠিয়েছেন।`,
    });

    res.status(201).json({ success: true, messageBn: 'Interest পাঠানো হয়েছে।', interest });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Interest already sent.',
        messageBn: 'ইতিমধ্যে Interest পাঠানো হয়েছে।',
      });
    }
    res.status(500).json({ success: false, message: 'Server error', messageBn: 'সার্ভারে সমস্যা হয়েছে।' });
  }
});

// @route  GET /api/interests/sent
// @desc   Get my sent interests (paginated)
// @access Private
router.get('/sent', protect, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const [interests, total] = await Promise.all([
      Interest.find({ senderId: req.user._id })
        .populate('receiverId', 'name gender profilePicture')
        .populate('biodataId', 'personal.fullName personal.age personal.maritalStatus status')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Interest.countDocuments({ senderId: req.user._id }),
    ]);

    res.json({
      success: true,
      interests,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route  GET /api/interests/received
// @desc   Get interests received by me (paginated)
// @access Private
router.get('/received', protect, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const [interests, total] = await Promise.all([
      Interest.find({ receiverId: req.user._id })
        .populate('senderId', 'name gender profilePicture')
        .populate('biodataId', 'personal.fullName personal.age personal.maritalStatus status')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Interest.countDocuments({ receiverId: req.user._id }),
    ]);

    res.json({
      success: true,
      interests,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route  PATCH /api/interests/:id
// @desc   Accept or reject an interest
// @access Private
router.patch('/:id', protect, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['accepted', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, message: 'status must be accepted or rejected.' });
    }

    const interest = await Interest.findById(req.params.id);
    if (!interest) return res.status(404).json({ success: false, message: 'Interest not found.' });
    if (interest.receiverId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized.' });
    }
    // Prevent re-processing an already accepted/rejected interest
    if (interest.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'This interest has already been processed.',
        messageBn: 'এই Interest ইতিমধ্যে প্রক্রিয়া করা হয়েছে।',
      });
    }

    interest.status = status;
    await interest.save();

    // If accepted, create conversation
    if (status === 'accepted') {
      const existing = await Conversation.findOne({
        participants: { $all: [interest.senderId, interest.receiverId] },
      });
      if (!existing) {
        await Conversation.create({ participants: [interest.senderId, interest.receiverId] });
      }
    }

    await createNotification({
      userId: interest.senderId,
      type: 'system',
      title: status === 'accepted' ? 'Interest Accepted' : 'Interest Rejected',
      titleBn: status === 'accepted' ? 'Interest গৃহীত হয়েছে' : 'Interest প্রত্যাখ্যাত হয়েছে',
      message: `${req.user.name} ${status === 'accepted' ? 'accepted' : 'rejected'} your interest.`,
      messageBn: `${req.user.name} আপনার Interest ${status === 'accepted' ? 'গ্রহণ' : 'প্রত্যাখ্যান'} করেছেন।`,
    });

    res.json({ success: true, message: `Interest ${status}.`, interest });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route  DELETE /api/interests/:id
// @desc   Withdraw a sent interest
// @access Private
router.delete('/:id', protect, async (req, res) => {
  try {
    const interest = await Interest.findById(req.params.id);
    if (!interest) return res.status(404).json({ success: false, message: 'Interest not found.' });
    if (interest.senderId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized.' });
    }
    if (interest.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Cannot withdraw a processed interest.' });
    }
    await interest.deleteOne();
    res.json({ success: true, message: 'Interest withdrawn.' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
