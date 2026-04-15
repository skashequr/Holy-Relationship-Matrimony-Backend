const jwt = require('jsonwebtoken');
const User = require('../models/User');

const protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  } else if (req.cookies && req.cookies.token) {
    token = req.cookies.token;
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized. Please login.',
      messageBn: 'অনুমোদিত নয়। অনুগ্রহ করে লগইন করুন।',
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found.',
        messageBn: 'ব্যবহারকারী পাওয়া যায়নি।',
      });
    }

    if (user.isBanned) {
      return res.status(403).json({
        success: false,
        message: 'Your account has been banned.',
        messageBn: 'আপনার অ্যাকাউন্ট নিষিদ্ধ করা হয়েছে।',
        reason: user.banReason,
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Your account is inactive.',
        messageBn: 'আপনার অ্যাকাউন্ট নিষ্ক্রিয়।',
      });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Token is invalid or expired.',
      messageBn: 'টোকেন অবৈধ বা মেয়াদ উত্তীর্ণ।',
    });
  }
};

const adminOnly = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({
      success: false,
      message: 'Access denied. Admin only.',
      messageBn: 'প্রবেশাধিকার নিষেধ। শুধুমাত্র অ্যাডমিন।',
    });
  }
};

const optionalAuth = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = await User.findById(decoded.id).select('-password');
    } catch (error) {
      // Ignore token errors for optional auth
    }
  }

  next();
};

module.exports = { protect, adminOnly, optionalAuth };
