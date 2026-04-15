const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      maxlength: [100, 'Name cannot exceed 100 characters'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email'],
    },
    phone: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
      match: [/^(\+880|880|0)?1[3-9]\d{8}$/, 'Please enter a valid Bangladeshi phone number'],
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [6, 'Password must be at least 6 characters'],
      select: false,
    },
    gender: {
      type: String,
      enum: ['male', 'female'],
      required: [true, 'Gender is required'],
    },
    role: {
      type: String,
      enum: ['user', 'admin'],
      default: 'user',
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    isEmailVerified: {
      type: Boolean,
      default: false,
    },
    isPhoneVerified: {
      type: Boolean,
      default: false,
    },
    isNIDVerified: {
      type: Boolean,
      default: false,
    },
    verificationBadge: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isBanned: {
      type: Boolean,
      default: false,
    },
    banReason: {
      type: String,
    },
    profilePicture: {
      type: String,
      default: null,
    },
    biodataId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Biodata',
      default: null,
    },
    shortlistedProfiles: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    unlockedContacts: [
      {
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
        },
        unlockedAt: {
          type: Date,
          default: Date.now,
        },
        paymentId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Payment',
        },
      },
    ],
    isPremium: { type: Boolean, default: false },
    premiumSince: { type: Date, default: null },
    premiumExpiry: { type: Date, default: null },
    premiumNote: { type: String, default: null },
    refreshToken: { type: String, default: null, select: false },
    resetPasswordToken: String,
    resetPasswordExpire: Date,
    emailVerificationToken: String,
    emailVerificationExpire: Date,
    lastLogin: {
      type: Date,
      default: null,
    },
    preferredLanguage: {
      type: String,
      enum: ['bn', 'en'],
      default: 'bn',
    },
  },
  {
    timestamps: true,
  }
);

// Encrypt password before saving
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  // Skip if caller already hashed (e.g. password reset route)
  if (this.$locals?.passwordAlreadyHashed) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Match password
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// Check if contact is unlocked
userSchema.methods.hasUnlockedContact = function (targetUserId) {
  return this.unlockedContacts.some(
    (uc) => uc.userId.toString() === targetUserId.toString()
  );
};

module.exports = mongoose.model('User', userSchema);
