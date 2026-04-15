const Notification = require('../models/Notification');
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

/**
 * Create in-app notification
 */
const createNotification = async ({ userId, type, title, titleBn, message, messageBn, link, metadata }) => {
  try {
    const notification = await Notification.create({
      userId,
      type,
      title,
      titleBn,
      message,
      messageBn,
      link,
      metadata,
    });
    return notification;
  } catch (error) {
    console.error('Notification creation error:', error);
  }
};

/**
 * Send email
 */
const sendEmail = async ({ to, subject, html, text }) => {
  try {
    const info = await transporter.sendMail({
      from: `"${process.env.FROM_NAME}" <${process.env.FROM_EMAIL}>`,
      to,
      subject,
      text,
      html,
    });
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Email send error:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Send OTP email
 */
const sendOTPEmail = async (email, otp, purpose) => {
  const purposeText = {
    registration: 'Registration Verification',
    login: 'Login Verification',
    reset_password: 'Password Reset',
    verify: 'Email Verification',
  };

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: Arial, sans-serif; background: #f4f4f4; margin: 0; padding: 20px; }
        .container { max-width: 600px; margin: 0 auto; background: #fff; border-radius: 8px; overflow: hidden; }
        .header { background: linear-gradient(135deg, #1a5276, #2e86c1); padding: 30px; text-align: center; }
        .header h1 { color: #fff; margin: 0; font-size: 24px; }
        .body { padding: 30px; }
        .otp-box { background: #f0f8ff; border: 2px dashed #2e86c1; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0; }
        .otp { font-size: 36px; font-weight: bold; color: #1a5276; letter-spacing: 10px; }
        .footer { background: #f4f4f4; padding: 20px; text-align: center; font-size: 12px; color: #666; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Holy Relationship Matrimony</h1>
          <p style="color: #cce4ff; margin: 5px 0;">হোলি রিলেশনশিপ ম্যাট্রিমনি</p>
        </div>
        <div class="body">
          <h2>${purposeText[purpose] || 'Verification'}</h2>
          <p>Your One-Time Password (OTP) for <strong>${purposeText[purpose]}</strong> is:</p>
          <div class="otp-box">
            <div class="otp">${otp}</div>
            <p style="color: #666; font-size: 14px;">Valid for 10 minutes only</p>
          </div>
          <p style="color: #999; font-size: 13px;">
            If you did not request this OTP, please ignore this email and ensure your account is secure.
          </p>
        </div>
        <div class="footer">
          <p>© 2024 Holy Relationship Marriage Matrimony. All rights reserved.</p>
          <p>Bangladesh | Islamic Matrimony Service</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return sendEmail({
    to: email,
    subject: `[Holy Matrimony] ${purposeText[purpose]} OTP: ${otp}`,
    html,
    text: `Your OTP is: ${otp}. Valid for 10 minutes.`,
  });
};

/**
 * Send biodata approval/rejection notification
 */
const sendBiodataStatusEmail = async (email, name, status, reason = '') => {
  const isApproved = status === 'approved';
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: Arial, sans-serif; background: #f4f4f4; }
        .container { max-width: 600px; margin: 20px auto; background: #fff; border-radius: 8px; overflow: hidden; }
        .header { background: linear-gradient(135deg, #1a5276, #2e86c1); padding: 30px; text-align: center; }
        .header h1 { color: #fff; margin: 0; }
        .body { padding: 30px; }
        .status-badge { display: inline-block; padding: 8px 20px; border-radius: 20px; font-weight: bold;
          background: ${isApproved ? '#d5f5e3' : '#fdecea'};
          color: ${isApproved ? '#1e8449' : '#c0392b'}; }
        .footer { background: #f4f4f4; padding: 20px; text-align: center; font-size: 12px; color: #666; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header"><h1>Holy Relationship Matrimony</h1></div>
        <div class="body">
          <p>Dear ${name},</p>
          <p>Your biodata has been reviewed by our team.</p>
          <p>Status: <span class="status-badge">${isApproved ? '✅ Approved' : '❌ Rejected'}</span></p>
          ${isApproved
            ? '<p>Congratulations! Your biodata is now live and visible to other members. May Allah bless your journey.</p>'
            : `<p>Unfortunately, your biodata was not approved. Reason: <strong>${reason}</strong></p><p>Please update your biodata and resubmit.</p>`
          }
        </div>
        <div class="footer">© 2024 Holy Relationship Marriage Matrimony</div>
      </div>
    </body>
    </html>
  `;

  return sendEmail({
    to: email,
    subject: `[Holy Matrimony] Biodata ${isApproved ? 'Approved' : 'Rejected'}`,
    html,
  });
};

module.exports = { createNotification, sendEmail, sendOTPEmail, sendBiodataStatusEmail };
