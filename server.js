require('dotenv').config();
const http = require('http');
const { Server } = require('socket.io');
const app = require('./src/app');
const connectDB = require('./src/config/db');

const PORT = process.env.PORT || 5000;
const server = http.createServer(app);

// ── Socket.io ──────────────────────────────────────────────────────────
const allowedOrigins = (
  process.env.FRONTEND_URL ||
  'https://www.holymarriagemedia.com,http://localhost:3000,http://localhost:5173'
)
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const isAllowed = (origin) => {
  // allow Postman / server-side requests
  if (!origin) return true;

  // explicitly allowed domains
  if (allowedOrigins.includes(origin)) return true;

  // allow all Vercel preview deployments
  if (/^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(origin)) {
    return true;
  }

  // localhost during development
  if (
    process.env.NODE_ENV !== 'production' &&
    /^http:\/\/localhost(:\d+)?$/.test(origin)
  ) {
    return true;
  }

  return false;
};

const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      if (isAllowed(origin)) {
        callback(null, true);
      } else {
        console.log('Socket blocked by CORS:', origin);

        callback(new Error(`Socket CORS blocked: ${origin}`));
      }
    },

    credentials: true,

    methods: ['GET', 'POST'],

    allowedHeaders: ['Content-Type', 'Authorization'],
  },
});

require('./src/services/messageSocket').setupMessageSocket(io);

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
