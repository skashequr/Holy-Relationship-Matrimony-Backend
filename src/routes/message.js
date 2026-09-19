const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const pageNumber = value => Math.max(1, Math.min(100000, parseInt(value, 10) || 1));
const pageLimit = (value, fallback) => Math.max(1, Math.min(100, parseInt(value, 10) || fallback));

const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Interest = require('../models/Interest');
const { protect } = require('../middleware/auth');

// Check if two users can chat (premium or accepted interest)
async function canChat(userA, userB) {
  if (!userB || userB.isBanned || userB.isActive === false) return false;
  const premium = user => user.isPremium && (!user.premiumExpiry || new Date(user.premiumExpiry) > new Date());
  if (premium(userA) || premium(userB)) return true;
  const accepted = await Interest.findOne({
    $or: [
      { senderId: userA._id, receiverId: userB._id, status: 'accepted' },
      { senderId: userB._id, receiverId: userA._id, status: 'accepted' },
    ],
  });
  return !!accepted;
}

// @route  GET /api/conversations
// @desc   Get my conversations (paginated)
// @access Private
router.get('/conversations', protect, async (req, res) => {
  try {
    const page = pageNumber(req.query.page);
    const limit = pageLimit(req.query.limit, 20);
    const skip = (page - 1) * limit;

    const [conversations, total] = await Promise.all([
      Conversation.find({ participants: req.user._id })
        .populate('participants', 'name gender profilePicture')
        .sort({ lastMessageAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit),
      Conversation.countDocuments({ participants: req.user._id }),
    ]);

    // Add unread count per conversation
    const withUnread = await Promise.all(
      conversations.map(async (c) => {
        const unread = await Message.countDocuments({
          conversationId: c._id,
          senderId: { $ne: req.user._id },
          isRead: false,
        });
        return { ...c.toObject(), unreadCount: unread };
      })
    );

    res.json({
      success: true,
      conversations: withUnread,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route  GET /api/messages/:conversationId
// @desc   Get messages in a conversation (paginated)
// @access Private
router.get('/:conversationId', protect, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.conversationId)) return res.status(400).json({ success: false, message: 'Invalid conversation.' });
    const conversation = await Conversation.findById(req.params.conversationId).populate('participants', 'name gender profilePicture');
    if (!conversation) return res.status(404).json({ success: false, message: 'Conversation not found.' });
    if (!conversation.participants.some((p) => p?._id.toString() === req.user._id.toString())) {
      return res.status(403).json({ success: false, message: 'Not authorized.' });
    }

    const page = pageNumber(req.query.page);
    const limit = pageLimit(req.query.limit, 30);
    const skip = (page - 1) * limit;

    const filter = { conversationId: req.params.conversationId };
    if (req.query.before) {
      if (!mongoose.isValidObjectId(req.query.before)) return res.status(400).json({ success: false, message: 'Invalid message cursor.' });
      filter._id = { $lt: req.query.before };
    }
    const messages = await Message.find(filter).sort({ _id: -1 }).skip(req.query.before ? 0 : skip).limit(limit + 1);
    const hasMore = messages.length > limit;
    if (hasMore) messages.pop();

    // Mark messages as read
    await Message.updateMany(
      { _id: { $in: messages.map(m => m._id) }, conversationId: req.params.conversationId, senderId: { $ne: req.user._id }, isRead: false },
      { isRead: true, readAt: new Date() }
    );

    res.json({ success: true, conversation, messages: messages.reverse(), pagination: { page, limit, hasMore } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route  POST /api/messages/start
// @desc   Start or get existing conversation with a user (premium users can message anyone)
// @access Private
router.post('/start', protect, async (req, res) => {
  try {
    const { userId } = req.body;
    if (!mongoose.isValidObjectId(userId)) return res.status(400).json({ success: false, message: 'userId is required.' });
    if (userId === req.user._id.toString()) {
      return res.status(400).json({ success: false, message: 'Cannot message yourself.' });
    }

    const User = require('../models/User');
    const otherUser = await User.findById(userId);
    if (!otherUser || otherUser.isBanned || otherUser.isActive === false) return res.status(404).json({ success: false, message: 'User not found.' });

    // Check permission: premium user OR accepted interest
    const allowed = await canChat(req.user, otherUser);
    if (!allowed) {
      return res.status(403).json({
        success: false,
        message: 'Chat requires premium membership or accepted interest.',
        messageBn: 'চ্যাট করতে প্রিমিয়াম সদস্যতা বা গৃহীত Interest প্রয়োজন।',
      });
    }

    // Find or create conversation
    let conversation = await Conversation.findOne({
      participants: { $all: [req.user._id, userId] },
    });
    if (!conversation) {
      conversation = await Conversation.create({ participants: [req.user._id, userId] });
    }

    await conversation.populate('participants', 'name gender profilePicture');
    res.json({ success: true, conversation });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route  POST /api/messages
// @desc   Send a message
// @access Private
router.post('/', protect, async (req, res) => {
  try {
    const { conversationId, text } = req.body;
    if (!mongoose.isValidObjectId(conversationId) || typeof text !== 'string' || !text.trim() || text.trim().length > 2000) {
      return res.status(400).json({ success: false, message: 'conversationId and text are required.' });
    }

    const conversation = await Conversation.findById(conversationId).populate('participants');
    if (!conversation) return res.status(404).json({ success: false, message: 'Conversation not found.' });
    if (!conversation.participants.some((p) => p?._id.toString() === req.user._id.toString())) {
      return res.status(403).json({ success: false, message: 'Not authorized.' });
    }

    // Check chat permission
    const otherUser = conversation.participants.find((p) => p?._id.toString() !== req.user._id.toString());
    const allowed = await canChat(req.user, otherUser);
    if (!allowed) {
      return res.status(403).json({
        success: false,
        message: 'Chat requires premium membership or accepted interest.',
        messageBn: 'চ্যাট করতে প্রিমিয়াম সদস্যতা বা গৃহীত Interest প্রয়োজন।',
      });
    }

    const message = await Message.create({ conversationId, senderId: req.user._id, text: text.trim() });

    // Update conversation last message
    await Conversation.findByIdAndUpdate(conversationId, {
      lastMessage: text.trim(),
      lastMessageAt: new Date(),
    });

    // Emit via Socket.io if available
    if (req.app.get('io')) {
      const rooms = [conversationId, ...conversation.participants.filter(Boolean).map(p => p._id.toString())];
      req.app.get('io').to(rooms).emit('receiveMessage', message);
    }

    res.status(201).json({ success: true, message: message });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Explicit read acknowledgement for visible messages, including live arrivals.
router.patch('/:conversationId/read', protect, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { messageId } = req.body;
    if (!mongoose.isValidObjectId(conversationId) || !mongoose.isValidObjectId(messageId)) return res.status(400).json({ success: false });
    const conversation = await Conversation.findOne({ _id: conversationId, participants: req.user._id });
    if (!conversation) return res.status(403).json({ success: false });
    const message = await Message.findOne({ _id: messageId, conversationId });
    if (!message) return res.status(404).json({ success: false });
    await Message.updateMany({ conversationId, _id: { $lte: messageId }, senderId: { $ne: req.user._id }, isRead: false }, { isRead: true, readAt: new Date() });
    req.app.get('io')?.to(conversation.participants.map(p => p.toString())).emit('messageRead', { conversationId, readerId: req.user._id.toString(), messageId });
    res.json({ success: true });
  } catch { res.status(500).json({ success: false, message: 'Could not mark messages as read.' }); }
});

module.exports = router;
