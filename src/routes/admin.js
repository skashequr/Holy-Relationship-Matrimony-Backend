const express = require('express');
const router = express.Router();

const User = require('../models/User');
const Biodata = require('../models/Biodata');
const Payment = require('../models/Payment');
const Report = require('../models/Report');
const Review = require('../models/Review');
const Settings = require('../models/Settings');
const { protect, adminOnly } = require('../middleware/auth');
const { sendBiodataStatusEmail, createNotification } = require('../services/notificationService');

// All admin routes require authentication and admin role
router.use(protect, adminOnly);

// ===== DASHBOARD ANALYTICS =====
// @route  GET /api/admin/analytics
router.get('/analytics', async (req, res) => {
  try {
    const now = new Date();
    const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

    const [
      totalUsers,
      newUsersThisMonth,
      newUsersThisWeek,
      maleUsers,
      femaleUsers,
      totalBiodatas,
      pendingBiodatas,
      approvedBiodatas,
      rejectedBiodatas,
      totalPayments,
      totalRevenue,
      monthlyRevenue,
      totalReports,
      pendingReports,
    ] = await Promise.all([
      User.countDocuments({ role: 'user' }),
      User.countDocuments({ role: 'user', createdAt: { $gte: thirtyDaysAgo } }),
      User.countDocuments({ role: 'user', createdAt: { $gte: sevenDaysAgo } }),
      User.countDocuments({ gender: 'male', role: 'user' }),
      User.countDocuments({ gender: 'female', role: 'user' }),
      Biodata.countDocuments(),
      Biodata.countDocuments({ status: 'pending' }),
      Biodata.countDocuments({ status: 'approved' }),
      Biodata.countDocuments({ status: 'rejected' }),
      Payment.countDocuments({ status: 'completed' }),
      Payment.aggregate([{ $match: { status: 'completed' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
      Payment.aggregate([
        { $match: { status: 'completed', createdAt: { $gte: thirtyDaysAgo } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      Report.countDocuments(),
      Report.countDocuments({ status: 'pending' }),
    ]);

    // Monthly user growth for chart
    const monthlyGrowth = await User.aggregate([
      {
        $match: {
          createdAt: { $gte: new Date(now.getFullYear(), now.getMonth() - 5, 1) },
        },
      },
      {
        $group: {
          _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]);

    // Daily revenue for chart
    const dailyRevenue = await Payment.aggregate([
      {
        $match: {
          status: 'completed',
          createdAt: { $gte: sevenDaysAgo },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          amount: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    res.json({
      success: true,
      analytics: {
        users: {
          total: totalUsers,
          newThisMonth: newUsersThisMonth,
          newThisWeek: newUsersThisWeek,
          male: maleUsers,
          female: femaleUsers,
        },
        biodatas: {
          total: totalBiodatas,
          pending: pendingBiodatas,
          approved: approvedBiodatas,
          rejected: rejectedBiodatas,
        },
        payments: {
          total: totalPayments,
          totalRevenue: totalRevenue[0]?.total || 0,
          monthlyRevenue: monthlyRevenue[0]?.total || 0,
        },
        reports: { total: totalReports, pending: pendingReports },
        charts: { monthlyGrowth, dailyRevenue },
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
});

// ===== USER MANAGEMENT =====
// @route  GET /api/admin/users
router.get('/users', async (req, res) => {
  try {
    const { page = 1, limit = 20, search, gender, status, verified, ageMin, ageMax } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const query = { role: 'user' };
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
      ];
    }
    if (gender) query.gender = gender;
    if (status === 'banned') query.isBanned = true;
    if (status === 'active') query.isActive = true;
    if (verified === 'true') query.isVerified = true;

    if (ageMin || ageMax) {
      const ageQuery = {};
      if (ageMin) ageQuery.$gte = Number(ageMin);
      if (ageMax) ageQuery.$lte = Number(ageMax);
      const matchingBiodatas = await Biodata.find({ 'personal.age': ageQuery }).select('userId');
      query._id = { $in: matchingBiodatas.map((b) => b.userId) };
    }

    const [users, total] = await Promise.all([
      User.find(query)
        .select('-password -resetPasswordToken -emailVerificationToken')
        .populate('biodataId', 'biodataNumber status personal.fullName personal.age')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      User.countDocuments(query),
    ]);

    res.json({
      success: true,
      users,
      pagination: { total, page: Number(page), limit: Number(limit), totalPages: Math.ceil(total / Number(limit)) },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route  PUT /api/admin/users/:id/ban
router.put('/users/:id/ban', async (req, res) => {
  try {
    if (req.params.id === req.user._id.toString()) {
      return res.status(400).json({ success: false, message: 'You cannot ban your own account.' });
    }
    const targetUser = await User.findById(req.params.id);
    if (!targetUser) return res.status(404).json({ success: false, message: 'User not found.' });
    if (targetUser.role === 'admin') {
      return res.status(400).json({ success: false, message: 'Cannot ban another admin.' });
    }
    const { reason } = req.body;
    await User.findByIdAndUpdate(req.params.id, { isBanned: true, banReason: reason || 'Violated terms of service' });
    res.json({ success: true, message: 'User banned.' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route  PUT /api/admin/users/:id/unban
router.put('/users/:id/unban', async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.params.id, { isBanned: false, banReason: null });
    res.json({ success: true, message: 'User unbanned.' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route  PUT /api/admin/users/:id/verify
router.put('/users/:id/verify', async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.params.id, {
      isVerified: true,
      isNIDVerified: true,
      verificationBadge: true,
    });

    await createNotification({
      userId: req.params.id,
      type: 'system',
      title: 'Account Verified',
      titleBn: 'অ্যাকাউন্ট যাচাই হয়েছে',
      message: 'Your account has been verified by admin.',
      messageBn: 'অ্যাডমিন আপনার অ্যাকাউন্ট যাচাই করেছেন।',
    });

    res.json({ success: true, message: 'User verified.' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ===== BIODATA MANAGEMENT =====
// @route  GET /api/admin/biodatas
router.get('/biodatas', async (req, res) => {
  try {
    const { page = 1, limit = 20, status, gender, ageMin, ageMax } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const query = {};
    if (status) query.status = status;
    if (ageMin || ageMax) {
      query['personal.age'] = {};
      if (ageMin) query['personal.age'].$gte = Number(ageMin);
      if (ageMax) query['personal.age'].$lte = Number(ageMax);
    }

    let userQuery = {};
    if (gender) userQuery.gender = gender;

    const targetUsers = await User.find(userQuery).select('_id');
    if (gender) query.userId = { $in: targetUsers.map((u) => u._id) };

    const [biodatas, total] = await Promise.all([
      Biodata.find(query)
        .populate('userId', 'name email gender phone profilePicture isVerified')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      Biodata.countDocuments(query),
    ]);

    res.json({
      success: true,
      biodatas,
      pagination: { total, page: Number(page), limit: Number(limit), totalPages: Math.ceil(total / Number(limit)) },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route  PUT /api/admin/biodatas/:id/approve
router.put('/biodatas/:id/approve', async (req, res) => {
  try {
    const biodata = await Biodata.findById(req.params.id).populate('userId', 'email name');
    if (!biodata) return res.status(404).json({ success: false, message: 'Biodata not found.' });

    await Biodata.findByIdAndUpdate(req.params.id, { status: 'approved', rejectionReason: null });

    await createNotification({
      userId: biodata.userId._id,
      type: 'biodata_approved',
      title: 'Biodata Approved',
      titleBn: 'বায়োডেটা অনুমোদিত',
      message: 'Your biodata has been approved and is now live.',
      messageBn: 'আপনার বায়োডেটা অনুমোদিত হয়েছে।',
    });

    await sendBiodataStatusEmail(biodata.userId.email, biodata.userId.name, 'approved');

    res.json({ success: true, message: 'Biodata approved.' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route  PUT /api/admin/biodatas/:id/reject
router.put('/biodatas/:id/reject', async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ success: false, message: 'Rejection reason is required.' });

    const biodata = await Biodata.findById(req.params.id).populate('userId', 'email name');
    if (!biodata) return res.status(404).json({ success: false, message: 'Biodata not found.' });

    await Biodata.findByIdAndUpdate(req.params.id, { status: 'rejected', rejectionReason: reason });

    await createNotification({
      userId: biodata.userId._id,
      type: 'biodata_rejected',
      title: 'Biodata Rejected',
      titleBn: 'বায়োডেটা প্রত্যাখ্যাত',
      message: `Your biodata was rejected. Reason: ${reason}`,
      messageBn: `আপনার বায়োডেটা প্রত্যাখ্যাত হয়েছে।`,
    });

    await sendBiodataStatusEmail(biodata.userId.email, biodata.userId.name, 'rejected', reason);

    res.json({ success: true, message: 'Biodata rejected.' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ===== PAYMENT MANAGEMENT =====
// @route  GET /api/admin/payments
router.get('/payments', async (req, res) => {
  try {
    const { page = 1, limit = 20, status, method } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const query = {};
    if (status) query.status = status;
    if (method) query.paymentMethod = method;

    const [payments, total] = await Promise.all([
      Payment.find(query)
        .populate('payerId', 'name email gender phone')
        .populate('targetUserId', 'name gender')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      Payment.countDocuments(query),
    ]);

    res.json({
      success: true,
      payments,
      pagination: { total, page: Number(page), limit: Number(limit), totalPages: Math.ceil(total / Number(limit)) },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route  PATCH /api/admin/payments/:id/approve
// @desc   Approve a pending manual payment → unlock contact
router.patch('/payments/:id/approve', async (req, res) => {
  try {
    const payment = await Payment.findById(req.params.id);
    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found.' });
    if (payment.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Only pending payments can be approved.' });
    }

    // Mark as completed
    payment.status = 'completed';
    await payment.save();

    // Unlock contact for payer
    await User.findByIdAndUpdate(payment.payerId, {
      $push: {
        unlockedContacts: {
          userId: payment.targetUserId,
          unlockedAt: new Date(),
          paymentId: payment._id,
        },
      },
    });

    // Notify payer
    await createNotification({
      userId: payment.payerId,
      type: 'system',
      title: 'Payment Approved',
      titleBn: 'পেমেন্ট অনুমোদিত হয়েছে',
      message: 'Your payment has been verified. Contact information is now unlocked.',
      messageBn: 'আপনার পেমেন্ট যাচাই হয়েছে। যোগাযোগের তথ্য আনলক হয়েছে।',
    });

    res.json({ success: true, message: 'Payment approved and contact unlocked.', payment });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
});

// @route  PATCH /api/admin/payments/:id/reject
// @desc   Reject a pending manual payment
router.patch('/payments/:id/reject', async (req, res) => {
  try {
    const { reason } = req.body;
    const payment = await Payment.findById(req.params.id);
    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found.' });
    if (payment.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Only pending payments can be rejected.' });
    }

    payment.status = 'failed';
    if (reason) payment.refundReason = reason;
    await payment.save();

    // Notify payer
    await createNotification({
      userId: payment.payerId,
      type: 'system',
      title: 'Payment Rejected',
      titleBn: 'পেমেন্ট প্রত্যাখ্যাত হয়েছে',
      message: `Your payment could not be verified.${reason ? ` Reason: ${reason}` : ''}`,
      messageBn: `আপনার পেমেন্ট যাচাই করা যায়নি।${reason ? ` কারণ: ${reason}` : ''} সঠিক ট্রানজেকশন আইডি দিয়ে আবার চেষ্টা করুন।`,
    });

    res.json({ success: true, message: 'Payment rejected.', payment });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
});

// ===== REPORT MANAGEMENT =====
// @route  GET /api/admin/reports
router.get('/reports', async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const query = {};
    if (status) query.status = status;

    const [reports, total] = await Promise.all([
      Report.find(query)
        .populate('reportedBy', 'name email gender')
        .populate('reportedUser', 'name email gender')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      Report.countDocuments(query),
    ]);

    res.json({
      success: true,
      reports,
      pagination: { total, page: Number(page), limit: Number(limit), totalPages: Math.ceil(total / Number(limit)) },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route  PUT /api/admin/reports/:id/resolve
router.put('/reports/:id/resolve', async (req, res) => {
  try {
    const { action, adminNote } = req.body; // action: 'ban_user' | 'dismiss'

    const report = await Report.findById(req.params.id);
    if (!report) return res.status(404).json({ success: false, message: 'Report not found.' });

    await Report.findByIdAndUpdate(req.params.id, {
      status: 'resolved',
      adminNote,
      reviewedBy: req.user._id,
      reviewedAt: new Date(),
    });

    if (action === 'ban_user') {
      await User.findByIdAndUpdate(report.reportedUser, {
        isBanned: true,
        banReason: 'Reported and reviewed by admin.',
      });
    }

    res.json({ success: true, message: 'Report resolved.' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ===== PREMIUM MANAGEMENT =====
// @route  GET /api/admin/premium-members
router.get('/premium-members', async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const now = new Date();

    const [users, total] = await Promise.all([
      User.find({ isPremium: true })
        .select('name email phone premiumSince premiumExpiry premiumNote gender profilePicture')
        .sort({ premiumExpiry: 1 })
        .skip(skip)
        .limit(Number(limit)),
      User.countDocuments({ isPremium: true }),
    ]);

    res.json({
      success: true,
      users: users.map((u) => ({
        ...u.toObject(),
        daysRemaining: u.premiumExpiry ? Math.ceil((u.premiumExpiry - now) / (1000 * 60 * 60 * 24)) : null,
        isExpired: u.premiumExpiry ? u.premiumExpiry < now : false,
      })),
      pagination: { total, page: Number(page), totalPages: Math.ceil(total / Number(limit)) },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route  PATCH /api/admin/users/:id/set-premium
router.patch('/users/:id/set-premium', async (req, res) => {
  try {
    const { durationDays = 30, note } = req.body;
    const now = new Date();
    const expiry = new Date(now.getTime() + Number(durationDays) * 24 * 60 * 60 * 1000);

    await User.findByIdAndUpdate(req.params.id, {
      isPremium: true,
      premiumSince: now,
      premiumExpiry: expiry,
      premiumNote: note || null,
    });

    await createNotification({
      userId: req.params.id,
      type: 'system',
      title: 'Premium Activated',
      titleBn: 'প্রিমিয়াম সক্রিয় হয়েছে',
      message: `Your premium membership has been activated for ${durationDays} days.`,
      messageBn: `আপনার প্রিমিয়াম সদস্যতা ${durationDays} দিনের জন্য সক্রিয় হয়েছে।`,
    });

    res.json({ success: true, message: 'Premium activated.', premiumExpiry: expiry });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route  PATCH /api/admin/users/:id/revoke-premium
router.patch('/users/:id/revoke-premium', async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.params.id, {
      isPremium: false,
      premiumSince: null,
      premiumExpiry: null,
      premiumNote: null,
    });

    await createNotification({
      userId: req.params.id,
      type: 'system',
      title: 'Premium Revoked',
      titleBn: 'প্রিমিয়াম বাতিল হয়েছে',
      message: 'Your premium membership has been revoked.',
      messageBn: 'আপনার প্রিমিয়াম সদস্যতা বাতিল করা হয়েছে।',
    });

    res.json({ success: true, message: 'Premium revoked.' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ===== MARRIED LIST =====
// @route  GET /api/admin/married
router.get('/married', async (req, res) => {
  try {
    const { page = 1, limit = 20, via } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const query = { isMarried: true };
    if (via === 'site') query.marriedVia = 'এই সাইটের মাধ্যমে';
    else if (via === 'other') query.marriedVia = 'অন্যভাবে';

    const [biodatas, total] = await Promise.all([
      Biodata.find(query)
        .populate('userId', 'name email phone gender profilePicture')
        .sort({ marriedAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      Biodata.countDocuments(query),
    ]);

    res.json({
      success: true,
      biodatas,
      pagination: { total, page: Number(page), totalPages: Math.ceil(total / Number(limit)) },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route  GET /api/admin/married/export
router.get('/married/export', async (req, res) => {
  try {
    const biodatas = await Biodata.find({ isMarried: true })
      .populate('userId', 'name email phone')
      .sort({ marriedAt: -1 });

    const rows = [
      ['নাম', 'ইমেইল', 'ফোন', 'বিয়ের তারিখ', 'মাধ্যম'],
      ...biodatas.map((b) => [
        b.userId?.name || '',
        b.userId?.email || '',
        b.userId?.phone || '',
        b.marriedAt ? new Date(b.marriedAt).toLocaleDateString('bn-BD') : '',
        b.marriedVia || '',
      ]),
    ];

    const csv = rows.map((r) => r.join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=married-list.csv');
    res.send('\uFEFF' + csv); // BOM for Excel Bengali support
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ===== PURCHASES EXPORT =====
// @route  GET /api/admin/purchases/export
router.get('/purchases/export', async (req, res) => {
  try {
    const payments = await Payment.find()
      .populate('payerId', 'name email phone')
      .populate('targetUserId', 'name')
      .sort({ createdAt: -1 });

    const rows = [
      ['ক্রেতার নাম', 'ইমেইল', 'ফোন', 'প্রোফাইল', 'পরিমাণ', 'পদ্ধতি', 'TXN ID', 'তারিখ', 'স্ট্যাটাস'],
      ...payments.map((p) => [
        p.payerId?.name || '',
        p.payerId?.email || '',
        p.payerId?.phone || '',
        p.targetUserId?.name || '',
        p.amount,
        p.paymentMethod || '',
        p.transactionId || '',
        new Date(p.createdAt).toLocaleDateString('bn-BD'),
        p.status,
      ]),
    ];

    const csv = rows.map((r) => r.join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=payments.csv');
    res.send('\uFEFF' + csv);
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ===== REVIEW MANAGEMENT =====
// @route  GET /api/admin/reviews
router.get('/reviews', async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const query = {};
    if (status === 'pending') query.isApproved = false;
    else if (status === 'approved') query.isApproved = true;

    const [reviews, total] = await Promise.all([
      Review.find(query).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
      Review.countDocuments(query),
    ]);

    res.json({
      success: true,
      reviews,
      pagination: { total, page: Number(page), totalPages: Math.ceil(total / Number(limit)) },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route  PATCH /api/admin/reviews/:id/approve
router.patch('/reviews/:id/approve', async (req, res) => {
  try {
    await Review.findByIdAndUpdate(req.params.id, { isApproved: true });
    res.json({ success: true, message: 'Review approved.' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route  DELETE /api/admin/reviews/:id
router.delete('/reviews/:id', async (req, res) => {
  try {
    await Review.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Review deleted.' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ===== SETTINGS (persistent) =====
// @route  GET /api/admin/settings
router.get('/settings', async (req, res) => {
  try {
    const keys = ['contactUnlockPrice', 'premiumPrice', 'premiumDurationDays', 'freeInterestLimit', 'maintenanceMode', 'siteName', 'whatsappNumber', 'contactPhone'];
    const all = await Promise.all(keys.map((k) => Settings.findOne({ key: k })));
    const result = {};
    keys.forEach((k, i) => { result[k] = all[i]?.value ?? null; });
    res.json({ success: true, settings: result });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route  PUT /api/admin/settings
router.put('/settings', async (req, res) => {
  try {
    const allowed = ['contactUnlockPrice', 'premiumPrice', 'premiumDurationDays', 'freeInterestLimit', 'maintenanceMode', 'siteName', 'whatsappNumber', 'contactPhone'];
    await Promise.all(
      Object.entries(req.body)
        .filter(([k]) => allowed.includes(k))
        .map(([k, v]) => Settings.set(k, v))
    );
    res.json({ success: true, message: 'Settings updated.' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
