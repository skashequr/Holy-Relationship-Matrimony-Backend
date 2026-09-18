const Biodata = require('../models/Biodata');
const Interest = require('../models/Interest');
const Notification = require('../models/Notification');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');

// All activity queries are scoped to the authenticated account.
async function getDashboardSummary(user) {
  const [biodata, pendingInterests, unreadNotifications, conversations] = await Promise.all([
    Biodata.findOne({ userId: user._id }).select('status isActive isMarried biodataNumber views rejectionReason'),
    Interest.countDocuments({ receiverId: user._id, status: 'pending' }),
    Notification.countDocuments({ userId: user._id, isRead: false }),
    Conversation.find({ participants: user._id }).select('_id'),
  ]);
  const unreadMessages = await Message.countDocuments({
    conversationId: { $in: conversations.map((item) => item._id) },
    senderId: { $ne: user._id },
    isRead: false,
  });
  return {
    biodata,
    stats: {
      profileViews: biodata?.views || 0,
      shortlisted: user.shortlistedProfiles?.length || 0,
      pendingInterests,
      unreadMessages,
      unreadNotifications,
    },
  };
}

module.exports = { getDashboardSummary };
