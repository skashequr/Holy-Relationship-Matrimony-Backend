const router = require('express').Router();
const fs = require('fs');
const User = require('../models/User');
const { protect, adminOnly } = require('../middleware/auth');

// A selfie is evidence for review, not automatic proof of identity.
async function submit(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ success: false, messageBn: 'সেলফি তুলুন।' });
    const bytes = await fs.promises.readFile(req.file.path);
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
      return res.status(400).json({ success: false, messageBn: 'ক্যামেরা দিয়ে JPEG সেলফি তুলে জমা দিন।' });
    }
    const user = await User.findOneAndUpdate({
      _id: req.user._id, isFaceVerified: { $ne: true }, faceVerificationStatus: { $ne: 'pending' },
    }, { faceVerificationStatus: 'pending', faceVerificationImage: bytes }, { new: true });
    if (!user) return res.status(409).json({ success: false, messageBn: 'যাচাই ইতিমধ্যে সম্পন্ন হয়েছে অথবা পর্যালোচনাধীন আছে।' });
    res.json({ success: true, messageBn: 'সেলফি জমা হয়েছে। অ্যাডমিন পর্যালোচনা করবেন।' });
  } catch (error) { next(error); }
  finally { if (req.file?.path) await fs.promises.unlink(req.file.path).catch(() => {}); }
}

router.use(protect, adminOnly);
router.get('/', async (req, res, next) => {
  try {
    const users = await User.find({ faceVerificationStatus: 'pending' }).select('name email profilePicture faceVerificationStatus').limit(200);
    res.json({ success: true, users });
  } catch (error) { next(error); }
});
router.get('/:id/photo', async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id).select('+faceVerificationImage');
    if (!user?.faceVerificationImage) return res.status(404).json({ success: false, message: 'Photo not found.' });
    res.set('Cache-Control', 'no-store').type('jpeg').send(user.faceVerificationImage);
  } catch (error) { next(error); }
});
router.patch('/:id', async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ success: false, message: 'Invalid status.' });
    const update = { faceVerificationStatus: status, isFaceVerified: status === 'approved' };
    if (status === 'approved') Object.assign(update, { isVerified: true, verificationBadge: true });
    const user = await User.findOneAndUpdate({ _id: req.params.id, faceVerificationStatus: 'pending' },
      { $set: update, $unset: { faceVerificationImage: 1 } }, { new: true });
    if (!user) return res.status(409).json({ success: false, messageBn: 'এই আবেদন আর পর্যালোচনাধীন নেই।' });
    res.json({ success: true });
  } catch (error) { next(error); }
});
module.exports = { router, submit };
