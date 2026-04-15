const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');

const Payment = require('../models/Payment');
const User = require('../models/User');
const Biodata = require('../models/Biodata');
const { protect } = require('../middleware/auth');
const {
  initiateBkashPayment,
  executeBkashPayment,
  initiateNagadPayment,
  processContactUnlock,
  verifyPayment,
} = require('../services/paymentService');

// @route  POST /api/payment/initiate
// @desc   Initiate payment to unlock contact
// @access Private
router.post('/initiate', protect, async (req, res) => {
  const { targetUserId, paymentMethod, payerPhone } = req.body;

  if (!targetUserId || !paymentMethod) {
    return res.status(400).json({ success: false, message: 'targetUserId and paymentMethod are required.' });
  }

  try {
    // Check target user exists
    const targetUser = await User.findById(targetUserId);
    if (!targetUser) {
      return res.status(404).json({ success: false, message: 'Profile not found.' });
    }

    // Check if contact already unlocked
    const viewer = await User.findById(req.user._id);
    if (viewer.hasUnlockedContact(targetUserId)) {
      return res.status(400).json({
        success: false,
        message: 'You have already unlocked this contact.',
        messageBn: 'আপনি ইতিমধ্যে এই যোগাযোগ আনলক করেছেন।',
      });
    }

    const amount = Number(process.env.CONTACT_UNLOCK_PRICE) || 50;
    const orderId = uuidv4();
    const callbackURL = `${process.env.FRONTEND_URL}/payment/callback`;

    let paymentData;

    if (paymentMethod === 'bkash') {
      paymentData = await initiateBkashPayment({
        amount,
        payerPhone,
        merchantInvoiceNumber: orderId,
        callbackURL,
      });
    } else if (paymentMethod === 'nagad') {
      paymentData = await initiateNagadPayment({ amount, orderId, callbackURL });
    } else if (paymentMethod === 'rocket') {
      // Rocket payment gateway integration would go here
      paymentData = { success: true, redirectURL: `${callbackURL}?orderId=${orderId}` };
    } else {
      return res.status(400).json({ success: false, message: 'Invalid payment method.' });
    }

    if (!paymentData.success) {
      return res.status(500).json({ success: false, message: 'Payment initiation failed.' });
    }

    // Create pending payment record
    const payment = await Payment.create({
      payerId: req.user._id,
      targetUserId,
      amount,
      paymentMethod,
      paymentType: 'contact_unlock',
      status: 'pending',
      payerPhone,
      metadata: { orderId, ...paymentData },
    });

    res.json({
      success: true,
      message: 'Payment initiated.',
      messageBn: 'পেমেন্ট শুরু হয়েছে।',
      paymentId: payment._id,
      amount,
      ...paymentData,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
});

// @route  POST /api/payment/verify-bkash
// @desc   Verify bKash payment after redirect
// @access Private
router.post('/verify-bkash', protect, async (req, res) => {
  const { paymentID, status, paymentDbId } = req.body;

  if (status !== 'success') {
    return res.status(400).json({ success: false, message: 'Payment was not successful.' });
  }

  try {
    const payment = await Payment.findById(paymentDbId);
    if (!payment || payment.payerId.toString() !== req.user._id.toString()) {
      return res.status(404).json({ success: false, message: 'Payment record not found.' });
    }

    // In production, verify with bKash API using stored token
    // For now, mark as completed
    const result = await processContactUnlock({
      payerId: req.user._id,
      targetUserId: payment.targetUserId,
      paymentMethod: 'bkash',
      payerPhone: payment.payerPhone,
      gatewayData: { transactionId: paymentID, gatewayTransactionId: paymentID },
    });

    await Payment.findByIdAndUpdate(paymentDbId, {
      status: 'completed',
      gatewayTransactionId: paymentID,
    });

    res.json({
      success: true,
      message: 'Payment successful! Contact information unlocked.',
      messageBn: 'পেমেন্ট সফল! যোগাযোগের তথ্য আনলক হয়েছে।',
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Payment verification failed.' });
  }
});

// @route  POST /api/payment/manual-verify
// @desc   Manual payment verification (Rocket / manual TrxID submission)
// @access Private
router.post('/manual-verify', protect, async (req, res) => {
  const { targetUserId, paymentMethod, transactionId, payerPhone } = req.body;

  // ── 1. Input validation ──────────────────────────────────────────────────
  if (!targetUserId || !paymentMethod || !transactionId || !payerPhone) {
    return res.status(400).json({
      success: false,
      message: 'targetUserId, paymentMethod, transactionId and payerPhone are required.',
      messageBn: 'সব তথ্য পূরণ করুন।',
    });
  }

  // Transaction ID format: alphanumeric, 8–30 characters
  const trxPattern = /^[A-Za-z0-9]{8,30}$/;
  if (!trxPattern.test(transactionId.trim())) {
    return res.status(400).json({
      success: false,
      message: 'Invalid transaction ID format.',
      messageBn: 'ট্রানজেকশন আইডি সঠিক নয়। কমপক্ষে ৮টি অক্ষর/সংখ্যা থাকতে হবে।',
    });
  }

  // Phone: Bangladesh mobile number (01XXXXXXXXX)
  const phonePattern = /^01[3-9]\d{8}$/;
  if (!phonePattern.test(payerPhone.trim())) {
    return res.status(400).json({
      success: false,
      message: 'Invalid payer phone number.',
      messageBn: 'মোবাইল নম্বর সঠিক নয়। বাংলাদেশি নম্বর দিন (01XXXXXXXXX)।',
    });
  }

  try {
    // ── 2. Duplicate transaction ID check ───────────────────────────────────
    const existingTxn = await Payment.findOne({
      transactionId: transactionId.trim(),
      status: 'completed',
    });
    if (existingTxn) {
      return res.status(400).json({
        success: false,
        message: 'This transaction ID has already been used.',
        messageBn: 'এই ট্রানজেকশন আইডি আগেই ব্যবহার করা হয়েছে।',
      });
    }

    // ── 3. Check if contact already unlocked ────────────────────────────────
    const viewer = await User.findById(req.user._id);
    if (viewer.hasUnlockedContact(targetUserId)) {
      return res.status(400).json({
        success: false,
        message: 'Contact already unlocked.',
        messageBn: 'এই যোগাযোগ তথ্য ইতিমধ্যে আনলক করা আছে।',
      });
    }

    // ── 4. Verify target user exists ────────────────────────────────────────
    const targetUser = await User.findById(targetUserId);
    if (!targetUser) {
      return res.status(404).json({ success: false, message: 'Target profile not found.' });
    }

    // ── 5. Save as PENDING — admin must approve before contact is unlocked ──
    const amount = Number(process.env.CONTACT_UNLOCK_PRICE) || 50;
    const payment = await Payment.create({
      payerId: req.user._id,
      targetUserId,
      amount,
      paymentMethod,
      paymentType: 'contact_unlock',
      status: 'pending',
      transactionId: transactionId.trim(),
      payerPhone: payerPhone.trim(),
    });

    res.json({
      success: true,
      pending: true,
      message: 'Payment submitted. Awaiting admin verification.',
      messageBn: 'পেমেন্ট জমা হয়েছে। অ্যাডমিন যাচাইয়ের পর যোগাযোগ আনলক হবে।',
      paymentId: payment._id,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'This transaction ID has already been used.',
        messageBn: 'এই ট্রানজেকশন আইডি আগেই ব্যবহার করা হয়েছে।',
      });
    }
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
});

// @route  GET /api/payment/history
// @desc   Get payment history for current user
// @access Private
router.get('/history', protect, async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const [payments, total] = await Promise.all([
      Payment.find({ payerId: req.user._id })
        .populate('targetUserId', 'name gender profilePicture')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      Payment.countDocuments({ payerId: req.user._id }),
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

// @route  GET /api/payment/pricing
// @desc   Get current pricing
// @access Public
router.get('/pricing', (req, res) => {
  res.json({
    success: true,
    pricing: {
      contactUnlock: Number(process.env.CONTACT_UNLOCK_PRICE) || 50,
      currency: 'BDT',
      description: 'Unlock contact information of one profile',
      descriptionBn: 'একটি প্রোফাইলের যোগাযোগের তথ্য আনলক করুন',
    },
  });
});

module.exports = router;
