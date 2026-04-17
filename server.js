require('dotenv').config();
const http = require('http');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const app = require('./src/app');
const connectDB = require('./src/config/db');

const PORT = process.env.PORT || 5000;
const server = http.createServer(app);

// ── Socket.io ──────────────────────────────────────────────────────────
const _allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:3000')
  .split(',').map((o) => o.trim()).filter(Boolean);

const _isAllowed = (origin) => {
  if (!origin) return true;
  if (_allowedOrigins.includes(origin)) return true;
  if (/^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(origin)) return true;
  if (process.env.NODE_ENV !== 'production' && /^http:\/\/localhost(:\d+)?$/.test(origin)) return true;
  return false;
};

const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      if (_isAllowed(origin)) return callback(null, true);
      callback(new Error('Socket CORS: origin not allowed'));
    },
    credentials: true,
  },
});

// Socket.io JWT authentication middleware — reject unauthenticated connections
io.use((socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.split(' ')[1];
  if (!token) {
    return next(new Error('Authentication required'));
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = decoded.id;
    next();
  } catch {
    next(new Error('Invalid or expired token'));
  }
});

// Online users: userId → Set<socketId> (multiple tabs support)
const onlineUsers = new Map();

io.on('connection', (socket) => {
  const userId = socket.userId;

  // Auto-join personal room on connect (no client trust needed)
  socket.join(userId);
  if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
  onlineUsers.get(userId).add(socket.id);
  io.emit('userOnline', userId);

  // Join conversation room — verify user belongs to the conversation
  socket.on('joinConversation', (conversationId) => {
    if (typeof conversationId === 'string' && /^[0-9a-fA-F]{24}$/.test(conversationId)) {
      socket.join(conversationId);
    }
  });

  // Typing indicators — only broadcast userId from verified socket
  socket.on('typing', ({ conversationId }) => {
    socket.to(conversationId).emit('typing', { userId });
  });

  socket.on('stopTyping', ({ conversationId }) => {
    socket.to(conversationId).emit('stopTyping', { userId });
  });

  // Mark messages as read
  socket.on('messageRead', ({ conversationId }) => {
    socket.to(conversationId).emit('messageRead', { conversationId, readerId: userId });
  });

  socket.on('disconnect', () => {
    const sockets = onlineUsers.get(userId);
    if (sockets) {
      sockets.delete(socket.id);
      if (sockets.size === 0) {
        onlineUsers.delete(userId);
        io.emit('userOffline', userId);
      }
    }
  });
});

// Make io accessible in routes
app.set('io', io);

// ── Start ──────────────────────────────────────────────────────────────
connectDB().then(() => {
  require('./src/scripts/scheduledJobs');
  server.listen(PORT, () => {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[Server] Running on port ${PORT} (${process.env.NODE_ENV || 'development'})`);
      console.log(`[API]    http://localhost:${PORT}/api`);
    }
  });
});

process.on('unhandledRejection', (err) => {
  console.error('[UnhandledRejection]', err.message);
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  console.error('[UncaughtException]', err.message);
  process.exit(1);
});
