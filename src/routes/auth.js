const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
// Generate a cryptographically random 6-digit numeric OTP
const generateNumericOTP = () => {
  const buf = crypto.randomBytes(3); // 3 bytes → 0..16777215
  return String(parseInt(buf.toString('hex'), 16) % 1000000).padStart(6, '0');
};

const User = require('../models/User');
const OTP = require('../models/OTP');
const { protect } = require('../middleware/auth');
const { authLimiter, otpLimiter } = require('../middleware/rateLimiter');
const { sendOTPEmail } = require('../services/notificationService');

const generateAccessToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '15m' });
};

const generateRefreshToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET, { expiresIn: '7d' });
};

// keep backward compat alias
const generateToken = generateAccessToken;

// @route  POST /api/auth/register
// @desc   Register new user
// @access Public
router.post(
  '/register',
  authLimiter,
  [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
    body('phone').matches(/^(\+880|880|0)?1[3-9]\d{8}$/).withMessage('Valid Bangladeshi phone required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('gender').isIn(['male', 'female']).withMessage('Gender must be male or female'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { name, email, phone, password, gender } = req.body;

    try {
      // Check for duplicate email or phone — do this before sending OTP
      const existingUser = await User.findOne({ $or: [{ email }, { phone }] });
      if (existingUser) {
        const field = existingUser.email === email ? 'email' : 'phone';
        return res.status(400).json({
          success: false,
          message: `User with this ${field} already exists.`,
          messageBn: `এই ${field === 'email' ? 'ইমেইল' : 'ফোন'} দিয়ে ইতিমধ্যে একটি অ্যাকাউন্ট আছে।`,
        });
      }

      // Generate OTP
      const otp = generateNumericOTP();
      const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      // Delete any previous pending registration OTP for this email
      await OTP.deleteMany({ identifier: email, purpose: 'registration' });

      // Store OTP with pending registration data in metadata.
      // The user is NOT created here — creation happens only after OTP is verified.
      await OTP.create({
        identifier: email,
        type: 'email',
        otp: await bcrypt.hash(otp, 8),
        purpose: 'registration',
        expiresAt: otpExpiry,
        metadata: { name, email, phone, password, gender },
      });

      await sendOTPEmail(email, otp, 'registration');

      res.status(200).json({
        success: true,
        message: 'OTP sent. Please verify your email to complete registration.',
        messageBn: 'OTP পাঠানো হয়েছে। নিবন্ধন সম্পন্ন করতে ইমেইল যাচাই করুন।',
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
  }
);

// @route  POST /api/auth/login
// @desc   Login user
// @access Public
router.post(
  '/login',
  authLimiter,
  [
    body('email').isEmail().withMessage('Valid email is required').toLowerCase().trim(),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { email, password } = req.body;

    try {
      const user = await User.findOne({ email }).select('+password');
      if (!user || !(await user.matchPassword(password))) {
        return res.status(401).json({
          success: false,
          message: 'Invalid email or password.',
          messageBn: 'ইমেইল বা পাসওয়ার্ড ভুল।',
        });
      }

      if (user.isBanned) {
        return res.status(403).json({
          success: false,
          message: `Account banned: ${user.banReason}`,
          messageBn: 'অ্যাকাউন্ট নিষিদ্ধ।',
        });
      }

      await User.findByIdAndUpdate(user._id, { lastLogin: new Date() });

      const token = generateAccessToken(user._id);
      const refreshToken = generateRefreshToken(user._id);
      await User.findByIdAndUpdate(user._id, { refreshToken });

      // Set refresh token in httpOnly cookie
      res.cookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: '/',
      });

      res.json({
        success: true,
        message: 'Login successful.',
        messageBn: 'লগইন সফল।',
        token,
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          gender: user.gender,
          role: user.role,
          isEmailVerified: user.isEmailVerified,
          isVerified: user.isVerified,
          profilePicture: user.profilePicture,
          biodataId: user.biodataId,
        },
      });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
  }
);

// @route  POST /api/auth/send-otp
// @desc   Send OTP to email or phone
// @access Public
router.post('/send-otp', otpLimiter, async (req, res) => {
  const { identifier, type, purpose } = req.body;

  if (!identifier || !type || !purpose) {
    return res.status(400).json({ success: false, message: 'identifier, type, and purpose are required.' });
  }

  try {
    const otp = generateNumericOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    // Delete existing OTPs for this identifier+purpose
    await OTP.deleteMany({ identifier, purpose });

    await OTP.create({
      identifier,
      type,
      otp: await bcrypt.hash(otp, 8),
      purpose,
      expiresAt,
    });

    if (type === 'email') {
      await sendOTPEmail(identifier, otp, purpose);
    }
    // SMS sending would be done here for type === 'phone'

    res.json({
      success: true,
      message: `OTP sent to your ${type}.`,
      messageBn: `আপনার ${type === 'email' ? 'ইমেইলে' : 'ফোনে'} OTP পাঠানো হয়েছে।`,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to send OTP', error: error.message });
  }
});

// @route  POST /api/auth/verify-otp
// @desc   Verify OTP
// @access Public
router.post('/verify-otp', async (req, res) => {
  const { identifier, otp, purpose } = req.body;

  if (!identifier || !otp || !purpose) {
    return res.status(400).json({ success: false, message: 'All fields required.' });
  }

  try {
    const otpRecord = await OTP.findOne({
      identifier,
      purpose,
      isUsed: false,
      expiresAt: { $gt: new Date() },
    });

    if (!otpRecord) {
      return res.status(400).json({
        success: false,
        message: 'OTP expired or not found. Please request a new one.',
        messageBn: 'OTP মেয়াদ শেষ বা পাওয়া যায়নি।',
      });
    }

    if (otpRecord.attempts >= 5) {
      return res.status(429).json({
        success: false,
        message: 'Too many incorrect attempts. Please request a new OTP.',
      });
    }

    const isValid = await bcrypt.compare(otp, otpRecord.otp);
    if (!isValid) {
      await OTP.findByIdAndUpdate(otpRecord._id, { $inc: { attempts: 1 } });
      return res.status(400).json({
        success: false,
        message: 'Invalid OTP.',
        messageBn: 'ভুল OTP।',
      });
    }

    // Mark OTP as used
    await OTP.findByIdAndUpdate(otpRecord._id, { isUsed: true });

    // For registration: create the user NOW (after OTP verified), return token
    if (purpose === 'registration' && otpRecord.metadata) {
      const { name, email: regEmail, phone, password, gender } = otpRecord.metadata;

      // Final duplicate check (edge case: two tabs submitting same email simultaneously)
      const alreadyExists = await User.findOne({ $or: [{ email: regEmail }, { phone }] });
      if (alreadyExists) {
        return res.status(400).json({
          success: false,
          message: 'Account already exists.',
          messageBn: 'এই ইমেইল বা ফোন দিয়ে আগেই অ্যাকাউন্ট আছে।',
        });
      }

      const newUser = await User.create({
        name,
        email: regEmail,
        phone,
        password,
        gender,
        isEmailVerified: true,
      });

      const token = generateAccessToken(newUser._id);
      const refreshToken = generateRefreshToken(newUser._id);
      await User.findByIdAndUpdate(newUser._id, { refreshToken });

      res.cookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: '/',
      });

      return res.json({
        success: true,
        message: 'Email verified. Registration complete.',
        messageBn: 'ইমেইল যাচাই সফল। নিবন্ধন সম্পন্ন হয়েছে!',
        token,
        user: {
          _id: newUser._id,
          name: newUser.name,
          email: newUser.email,
          phone: newUser.phone,
          gender: newUser.gender,
          role: newUser.role,
          isEmailVerified: true,
        },
      });
    }

    // For other purposes (verify, etc.): just mark email/phone verified
    if (purpose === 'verify') {
      const updateField = otpRecord.type === 'email' ? { isEmailVerified: true } : { isPhoneVerified: true };
      await User.findOneAndUpdate({ email: identifier }, updateField);
    }

    res.json({
      success: true,
      message: 'OTP verified successfully.',
      messageBn: 'OTP সফলভাবে যাচাই হয়েছে।',
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
});

// @route  POST /api/auth/forgot-password
// @desc   Send password reset email
// @access Public
router.post('/forgot-password', authLimiter, async (req, res) => {
  const { email } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ success: false, message: 'No account found with this email.' });
    }

    const otp = generateNumericOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await OTP.deleteMany({ identifier: email, purpose: 'reset_password' });
    await OTP.create({
      identifier: email,
      type: 'email',
      otp: await bcrypt.hash(otp, 8),
      purpose: 'reset_password',
      expiresAt,
    });

    await sendOTPEmail(email, otp, 'reset_password');

    res.json({ success: true, message: 'Password reset OTP sent to email.' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route  POST /api/auth/reset-password
// @desc   Reset password with OTP
// @access Public
router.post('/reset-password', async (req, res) => {
  const { email, otp, newPassword } = req.body;

  if (!email || !otp || !newPassword) {
    return res.status(400).json({ success: false, message: 'All fields required.' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ success: false, message: 'Password must be at least 6 characters.' });
  }

  try {
    const otpRecord = await OTP.findOne({
      identifier: email,
      purpose: 'reset_password',
      isUsed: false,
      expiresAt: { $gt: new Date() },
    });

    if (!otpRecord) {
      return res.status(400).json({ success: false, message: 'Invalid or expired OTP.' });
    }

    const isValid = await bcrypt.compare(otp, otpRecord.otp);
    if (!isValid) {
      return res.status(400).json({ success: false, message: 'Invalid OTP.' });
    }

    await OTP.findByIdAndUpdate(otpRecord._id, { isUsed: true });

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    // Explicitly hash the new password — do not rely solely on the pre-save hook
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    // Mark as modified so the pre-save hook skips double-hashing
    user.$locals = { passwordAlreadyHashed: true };
    await user.save();

    res.json({ success: true, message: 'Password reset successfully.', messageBn: 'পাসওয়ার্ড সফলভাবে পরিবর্তন হয়েছে।' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route  GET /api/auth/me
// @desc   Get current user
// @access Private
router.get('/me', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .populate('biodataId')
      .select('-password -resetPasswordToken -emailVerificationToken');

    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route  POST /api/auth/logout
// @desc   Logout user - clear refresh token
// @access Private
router.post('/logout', protect, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user._id, { refreshToken: null });
    res.clearCookie('refreshToken');
    res.json({ success: true, message: 'Logged out successfully.', messageBn: 'লগআউট সফল।' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route  POST /api/auth/refresh-token
// @desc   Refresh access token using refresh token from cookie
// @access Public
router.post('/refresh-token', async (req, res) => {
  const refreshToken = req.cookies?.refreshToken;
  if (!refreshToken) {
    return res.status(401).json({ success: false, message: 'No refresh token provided.' });
  }
  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('+refreshToken');
    if (!user || user.refreshToken !== refreshToken) {
      return res.status(401).json({ success: false, message: 'Invalid refresh token.' });
    }
    if (user.isBanned) {
      return res.status(403).json({ success: false, message: 'Account banned.', messageBn: 'অ্যাকাউন্ট নিষিদ্ধ।' });
    }
    const newAccessToken = generateAccessToken(user._id);
    res.json({ success: true, token: newAccessToken });
  } catch (error) {
    res.status(401).json({ success: false, message: 'Refresh token expired or invalid.' });
  }
});

// @route  PUT /api/auth/change-password
// @desc   Change password
// @access Private
router.put('/change-password', protect, async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  try {
    const user = await User.findById(req.user._id).select('+password');
    const isMatch = await user.matchPassword(currentPassword);

    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'Current password is incorrect.' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'New password must be at least 6 characters.' });
    }

    user.password = newPassword;
    await user.save();

    res.json({ success: true, message: 'Password changed successfully.' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
