const cron = require('node-cron');
const User = require('../models/User');
const OTP = require('../models/OTP');
const { sendEmail } = require('../services/notificationService');

// Daily 00:00 — expire premium memberships
cron.schedule('0 0 * * *', async () => {
  try {
    const now = new Date();
    const expired = await User.find({ isPremium: true, premiumExpiry: { $lt: now } });

    if (expired.length > 0) {
      await User.updateMany(
        { isPremium: true, premiumExpiry: { $lt: now } },
        { $set: { isPremium: false } }
      );

      for (const user of expired) {
        await sendEmail({
          to: user.email,
          subject: 'প্রিমিয়াম মেয়াদ শেষ | Holy Relationship',
          html: `<p>প্রিয় ${user.name},</p><p>আপনার প্রিমিয়াম সদস্যতার মেয়াদ শেষ হয়েছে। পুনরায় সক্রিয় করতে অ্যাডমিনের সাথে যোগাযোগ করুন।</p>`,
        }).catch(() => {});
      }

      console.log(`[Cron] ${expired.length} premium memberships expired.`);
    }
  } catch (err) {
    console.error('[Cron] Premium expiry error:', err.message);
  }
});

// Daily 09:00 — premium expiry reminder (3 days before)
cron.schedule('0 9 * * *', async () => {
  try {
    const now = new Date();
    const in3Days = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

    const expiringSoon = await User.find({
      isPremium: true,
      premiumExpiry: { $gte: now, $lte: in3Days },
    });

    for (const user of expiringSoon) {
      await sendEmail({
        to: user.email,
        subject: 'প্রিমিয়াম মেয়াদ শেষ হতে চলেছে | Holy Relationship',
        html: `<p>প্রিয় ${user.name},</p><p>আপনার প্রিমিয়াম সদস্যতার মেয়াদ ৩ দিনের মধ্যে শেষ হবে। সময়মতো নবায়ন করুন।</p>`,
      }).catch(() => {});
    }

    if (expiringSoon.length > 0) {
      console.log(`[Cron] ${expiringSoon.length} premium expiry reminders sent.`);
    }
  } catch (err) {
    console.error('[Cron] Reminder error:', err.message);
  }
});

// Weekly Sunday 00:00 — cleanup unverified accounts older than 30 days
cron.schedule('0 0 * * 0', async () => {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const result = await User.deleteMany({
      isEmailVerified: false,
      createdAt: { $lt: thirtyDaysAgo },
      role: 'user',
    });

    // Cleanup expired OTPs
    await OTP.deleteMany({ expiresAt: { $lt: new Date() } });

    console.log(`[Cron] Cleanup: ${result.deletedCount} unverified accounts removed.`);
  } catch (err) {
    console.error('[Cron] Cleanup error:', err.message);
  }
});

console.log('[Cron] Scheduled jobs initialized.');
