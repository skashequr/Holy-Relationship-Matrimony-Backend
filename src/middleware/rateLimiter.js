const rateLimit = require('express-rate-limit');

const isDev = process.env.NODE_ENV !== 'production';

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 1000 : 20,
  skip: () => isDev, // completely skip in development
  message: {
    success: false,
    message: 'Too many requests. Please try again after 15 minutes.',
    messageBn: 'অনেক বেশি অনুরোধ। অনুগ্রহ করে ১৫ মিনিট পরে আবার চেষ্টা করুন।',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const otpLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: isDev ? 1000 : 5,
  skip: () => isDev,
  message: {
    success: false,
    message: 'Too many OTP requests. Please try again after 5 minutes.',
    messageBn: 'অনেক বেশি OTP অনুরোধ। অনুগ্রহ করে ৫ মিনিট পরে আবার চেষ্টা করুন।',
  },
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isDev ? 10000 : 200,
  skip: () => isDev,
  message: {
    success: false,
    message: 'API rate limit exceeded.',
    messageBn: 'অনেক বেশি অনুরোধ। একটু পরে চেষ্টা করুন।',
  },
});

// Search/match endpoints — heavier DB queries, stricter limit per user
const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isDev ? 10000 : 40,
  skip: () => isDev,
  keyGenerator: (req) => req.user?._id?.toString() || req.ip,
  message: {
    success: false,
    message: 'Too many search requests. Please slow down.',
    messageBn: 'অনেক বেশি সার্চ অনুরোধ। একটু বিরতি নিন।',
  },
});

module.exports = { authLimiter, otpLimiter, apiLimiter, searchLimiter };
