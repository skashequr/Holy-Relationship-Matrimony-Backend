const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Conversation = require('../models/Conversation');

function setupMessageSocket(io) {
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select('isActive isBanned');
      if (!user || !user.isActive || user.isBanned) return next(new Error('Account unavailable'));
      socket.userId = user._id.toString();
      socket.tokenExpiry = decoded.exp;
      next();
    } catch { next(new Error('Authentication required')); }
  });
  io.on('connection', socket => {
    const userId = socket.userId;
    socket.join(userId);
    // Force a fresh authenticated handshake when the access token expires.
    const expiryTimer = socket.tokenExpiry ? setTimeout(() => socket.disconnect(true),
      Math.min(2147483647, Math.max(0, socket.tokenExpiry * 1000 - Date.now()))) : null;
    socket.on('disconnect', () => { if (expiryTimer) clearTimeout(expiryTimer); });
    const validId = id => typeof id === 'string' && /^[a-f\d]{24}$/i.test(id);
    const allowed = async id => {
      if (!validId(id)) return false;
      if (socket.tokenExpiry && Date.now() >= socket.tokenExpiry * 1000) { socket.disconnect(true); return false; }
      const user = await User.findById(userId).select('isActive isBanned');
      if (!user?.isActive || user.isBanned) { socket.disconnect(true); return false; }
      return !!(await Conversation.exists({ _id: id, participants: userId }));
    };
    socket.on('joinConversation', async (id, ack) => {
      try {
        const permitted = await allowed(id);
        if (permitted) await socket.join(id);
        if (typeof ack === 'function') ack({ success: permitted });
      } catch { if (typeof ack === 'function') ack({ success: false }); }
    });
    socket.on('leaveConversation', id => { if (validId(id) && id !== userId) socket.leave(id); });
    for (const event of ['typing', 'stopTyping']) {
      socket.on(event, async (payload = {}) => {
        try {
          const id = payload?.conversationId;
          if (await allowed(id)) socket.to(id).emit(event, { conversationId: id, userId });
        } catch { /* Transient database errors must not crash the socket server. */ }
      });
    }
    // Read receipts are persisted and authorized by PATCH /messages/:id/read.
  });
}
module.exports = { setupMessageSocket };
