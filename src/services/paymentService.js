const axios = require('axios');
const Payment = require('../models/Payment');
const User = require('../models/User');
const { createNotification } = require('./notificationService');

/**
 * Initiate bKash payment
 */
const initiateBkashPayment = async ({ amount, payerPhone, merchantInvoiceNumber, callbackURL }) => {
  try {
    // Step 1: Get bKash token
    const tokenResponse = await axios.post(
      `${process.env.BKASH_BASE_URL}/tokenized/checkout/token/grant`,
      {
        app_key: process.env.BKASH_APP_KEY,
        app_secret: process.env.BKASH_APP_SECRET,
      },
      {
        headers: {
          username: process.env.BKASH_USERNAME,
          password: process.env.BKASH_PASSWORD,
          'Content-Type': 'application/json',
        },
      }
    );

    const { id_token } = tokenResponse.data;

    // Step 2: Create payment
    const createResponse = await axios.post(
      `${process.env.BKASH_BASE_URL}/tokenized/checkout/create`,
      {
        mode: '0011',
        payerReference: payerPhone,
        callbackURL,
        amount: String(amount),
        currency: 'BDT',
        intent: 'sale',
        merchantInvoiceNumber,
      },
      {
        headers: {
          Authorization: id_token,
          'X-APP-Key': process.env.BKASH_APP_KEY,
          'Content-Type': 'application/json',
        },
      }
    );

    return {
      success: true,
      bkashURL: createResponse.data.bkashURL,
      paymentID: createResponse.data.paymentID,
      token: id_token,
    };
  } catch (error) {
    console.error('bKash initiation error:', error.response?.data || error.message);
    return { success: false, error: error.message };
  }
};

/**
 * Execute bKash payment after callback
 */
const executeBkashPayment = async ({ paymentID, token }) => {
  try {
    const response = await axios.post(
      `${process.env.BKASH_BASE_URL}/tokenized/checkout/execute`,
      { paymentID },
      {
        headers: {
          Authorization: token,
          'X-APP-Key': process.env.BKASH_APP_KEY,
          'Content-Type': 'application/json',
        },
      }
    );

    return {
      success: response.data.statusCode === '0000',
      data: response.data,
      transactionId: response.data.trxID,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

/**
 * Initiate Nagad payment
 */
const initiateNagadPayment = async ({ amount, orderId, callbackURL }) => {
  try {
    const sensitiveData = {
      merchantId: process.env.NAGAD_MERCHANT_ID,
      orderId,
      amount: String(amount),
      currencyCode: '050',
      challenge: orderId,
    };

    // In production, this would use actual RSA encryption with Nagad's public key
    // This is a simplified version for development
    const response = await axios.post(
      `${process.env.NAGAD_BASE_URL}check-out/initialize/${process.env.NAGAD_MERCHANT_ID}/${orderId}`,
      {
        accountNumber: '01XXXXXXXXX',
        dateTime: new Date().toISOString(),
        sensitiveData: Buffer.from(JSON.stringify(sensitiveData)).toString('base64'),
        signature: 'signature_placeholder',
      }
    );

    return {
      success: true,
      redirectURL: response.data.redirectURL,
      paymentReferenceId: response.data.paymentReferenceId,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

/**
 * Process contact unlock payment
 */
const processContactUnlock = async ({ payerId, targetUserId, paymentMethod, payerPhone, gatewayData }) => {
  const amount = Number(process.env.CONTACT_UNLOCK_PRICE) || 50;

  // Create payment record
  const payment = await Payment.create({
    payerId,
    targetUserId,
    amount,
    paymentMethod,
    paymentType: 'contact_unlock',
    payerPhone,
    status: 'completed', // In production, verify via gateway callback
    transactionId: gatewayData?.transactionId || `TXN${Date.now()}`,
    gatewayTransactionId: gatewayData?.gatewayTransactionId,
    gatewayResponse: gatewayData,
  });

  // Update user's unlocked contacts
  await User.findByIdAndUpdate(payerId, {
    $push: {
      unlockedContacts: {
        userId: targetUserId,
        unlockedAt: new Date(),
        paymentId: payment._id,
      },
    },
  });

  // Notify the target user
  await createNotification({
    userId: targetUserId,
    type: 'contact_unlocked',
    title: 'Contact Information Viewed',
    titleBn: 'যোগাযোগের তথ্য দেখা হয়েছে',
    message: 'Someone has unlocked your contact information.',
    messageBn: 'কেউ আপনার যোগাযোগের তথ্য আনলক করেছে।',
  });

  return { success: true, payment };
};

/**
 * Verify payment status (generic)
 */
const verifyPayment = async (paymentId) => {
  const payment = await Payment.findById(paymentId);
  if (!payment) return { success: false, message: 'Payment not found' };
  return { success: true, payment };
};

module.exports = {
  initiateBkashPayment,
  executeBkashPayment,
  initiateNagadPayment,
  processContactUnlock,
  verifyPayment,
};
