const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');
const compression = require('compression');
const path = require('path');
const fs = require('fs');

const authRoutes = require('./routes/auth');
const biodataRoutes = require('./routes/biodata');
const searchRoutes = require('./routes/search');
const paymentRoutes = require('./routes/payment');
const matchRoutes = require('./routes/match');
const adminRoutes = require('./routes/admin');
const userRoutes = require('./routes/user');
const interestRoutes = require('./routes/interest');
const messageRoutes = require('./routes/message');
const reviewRoutes = require('./routes/review');
const { apiLimiter } = require('./middleware/rateLimiter');

const isProd = process.env.NODE_ENV === 'production';

// Fail fast in production if critical env vars are missing
if (isProd) {
  const required = ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'MONGO_URI', 'FRONTEND_URL'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

const app = express();

// Create uploads temp directory
const uploadsDir = path.join(__dirname, '../uploads/temp');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// ── HTTPS enforcement (production only, behind a proxy) ────────────────
if (isProd) {
  app.set('trust proxy', 1);
  app.use((req, res, next) => {
    if (req.header('x-forwarded-proto') !== 'https') {
      return res.redirect(301, `https://${req.header('host')}${req.url}`);
    }
    next();
  });
}

// ── Security headers ───────────────────────────────────────────────────
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // needed for Cloudinary images
    contentSecurityPolicy: isProd
      ? {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:', 'https:'],
            connectSrc: ["'self'", process.env.FRONTEND_URL],
          },
        }
      : false,
    hsts: isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
  })
);

// ── CORS — fail-close in production ───────────────────────────────────
const rawOrigins = process.env.FRONTEND_URL || (isProd ? '' : 'http://localhost:3000');
const allowedOrigins = rawOrigins.split(',').map((o) => o.trim()).filter(Boolean);

if (isProd && allowedOrigins.length === 0) {
  throw new Error('FRONTEND_URL must be set in production');
}

// Derive project slug from the primary Vercel URL (e.g. "hrmmm" from hrmmm.vercel.app)
// so every Vercel preview deployment for the same project is automatically allowed.
const vercelProject = allowedOrigins
  .map((o) => { try { return new URL(o).hostname; } catch { return ''; } })
  .find((h) => h.endsWith('.vercel.app'))
  ?.split('.')[0] || null;

const isAllowedOrigin = (origin) => {
  if (!origin) return true; // no-origin: mobile / curl / server-to-server
  if (allowedOrigins.includes(origin)) return true;
  // Allow Vercel preview deployments: <project>-<hash>-<scope>.vercel.app
  if (vercelProject && /^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(origin)) {
    const slug = new URL(origin).hostname.split('.')[0];
    if (slug.startsWith(vercelProject.slice(0, 4))) return true;
  }
  // Allow localhost in dev
  if (!isProd && /^http:\/\/localhost(:\d+)?$/.test(origin)) return true;
  return false;
};

app.use(
  cors({
    origin: (origin, callback) => {
      if (isAllowedOrigin(origin)) return callback(null, true);
      callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400, // preflight cache 24h
  })
);

// ── Body parsing & sanitization ────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());
app.use(mongoSanitize()); // prevent NoSQL injection
app.use(xss());           // strip XSS from strings

// ── Compression ────────────────────────────────────────────────────────
app.use(compression());

// ── Request logging ────────────────────────────────────────────────────
if (!isProd) {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined')); // structured logs in prod
}

// ── Static files ───────────────────────────────────────────────────────
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// ── Rate limiting ──────────────────────────────────────────────────────
app.use('/api/', apiLimiter);

// ── Routes ─────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/biodata', biodataRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/match', matchRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/user', userRoutes);
app.use('/api/interests', interestRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/reviews', reviewRoutes);

// ── Health check ───────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'Holy Relationship Matrimony API is running',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
  });
});

// ── 404 ────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found.' });
});

// ── Global error handler ───────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  // Only log stack in development; never expose internals to clients
  if (!isProd) {
    console.error('[Error]', err);
  } else {
    console.error(`[Error] ${req.method} ${req.path} — ${err.message}`);
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map((e) => e.message);
    return res.status(400).json({ success: false, message: messages.join(', ') });
  }

  // MongoDB duplicate key
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    return res.status(400).json({ success: false, message: `${field} already exists.` });
  }

  // Invalid ObjectId
  if (err.name === 'CastError') {
    return res.status(400).json({ success: false, message: 'Invalid ID format.' });
  }

  // CORS error
  if (err.message?.startsWith('CORS:')) {
    return res.status(403).json({ success: false, message: 'CORS not allowed.' });
  }

  res.status(err.statusCode || 500).json({
    success: false,
    message: isProd ? 'Internal Server Error' : err.message,
  });
});

module.exports = app;
