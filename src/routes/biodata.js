const express = require('express');
const router = express.Router();
const cloudinary = require('cloudinary').v2;
const fs = require('fs');

const Biodata = require('../models/Biodata');
const User = require('../models/User');
const { protect } = require('../middleware/auth');
const upload = require('../middleware/upload');
const { sanitizeBiodata } = require('../services/matchService');
const { createNotification, sendBiodataStatusEmail } = require('../services/notificationService');

// Remove empty strings so Mongoose enum validators don't reject unset fields
function sanitizeEmptyStrings(obj) {
  if (typeof obj !== 'object' || obj === null) return obj;
  if (Array.isArray(obj)) return obj;
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (Array.isArray(value)) {
      result[key] = value;
    } else if (typeof value === 'object' && value !== null) {
      result[key] = sanitizeEmptyStrings(value);
    } else if (value !== '') {
      result[key] = value;
    }
  }
  return result;
}

// Configure cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// @route  POST /api/biodata
// @desc   Create biodata
// @access Private
router.post('/', protect, async (req, res) => {
  try {
    // Check if biodata already exists
    const existing = await Biodata.findOne({ userId: req.user._id });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'Biodata already exists. Please update your existing biodata.',
        messageBn: 'বায়োডেটা ইতিমধ্যে বিদ্যমান।',
      });
    }

    const biodataData = { ...sanitizeEmptyStrings(req.body), userId: req.user._id };
    const biodata = await Biodata.create(biodataData);

    // Update user's biodataId
    await User.findByIdAndUpdate(req.user._id, { biodataId: biodata._id });

    // Notify admin
    await createNotification({
      userId: req.user._id,
      type: 'system',
      title: 'Biodata Submitted',
      titleBn: 'বায়োডেটা জমা দেওয়া হয়েছে',
      message: 'Your biodata has been submitted for review.',
      messageBn: 'আপনার বায়োডেটা পর্যালোচনার জন্য জমা দেওয়া হয়েছে।',
    });

    res.status(201).json({
      success: true,
      message: 'Biodata submitted for review.',
      messageBn: 'বায়োডেটা পর্যালোচনার জন্য জমা দেওয়া হয়েছে।',
      biodata,
    });
  } catch (error) {
    console.error('POST /api/biodata error:', error.message);
    if (error.name === 'ValidationError') {
      const fields = Object.values(error.errors).map((e) => e.message).join(', ');
      return res.status(400).json({
        success: false,
        message: fields,
        messageBn: 'তথ্য সঠিকভাবে পূরণ করুন। ' + fields,
      });
    }
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
});

// @route  GET /api/biodata/me
// @desc   Get my biodata
// @access Private
router.get('/me', protect, async (req, res) => {
  try {
    const biodata = await Biodata.findOne({ userId: req.user._id }).populate(
      'userId',
      'name email phone gender profilePicture isVerified verificationBadge'
    );

    if (!biodata) {
      return res.status(404).json({
        success: false,
        message: 'Biodata not found. Please create your biodata.',
        messageBn: 'বায়োডেটা পাওয়া যায়নি।',
      });
    }

    res.json({ success: true, biodata });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route  PUT /api/biodata
// @desc   Update my biodata
// @access Private
router.put('/', protect, async (req, res) => {
  try {
    const biodata = await Biodata.findOne({ userId: req.user._id });

    if (!biodata) {
      return res.status(404).json({ success: false, message: 'Biodata not found.' });
    }

    // Reset status to pending if it was approved (requires re-review)
    const updateData = { ...sanitizeEmptyStrings(req.body) };
    if (biodata.status === 'approved') {
      updateData.status = 'pending';
    }

    const updatedBiodata = await Biodata.findByIdAndUpdate(biodata._id, updateData, {
      new: true,
      runValidators: true,
    });

    res.json({
      success: true,
      message: 'Biodata updated. Awaiting review.',
      messageBn: 'বায়োডেটা আপডেট হয়েছে। পর্যালোচনার অপেক্ষায়।',
      biodata: updatedBiodata,
    });
  } catch (error) {
    console.error('PUT /api/biodata error:', error.message);
    if (error.name === 'ValidationError') {
      const fields = Object.values(error.errors).map((e) => e.message).join(', ');
      return res.status(400).json({
        success: false,
        message: fields,
        messageBn: 'তথ্য সঠিকভাবে পূরণ করুন। ' + fields,
      });
    }
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
});

// @route  POST /api/biodata/upload-photo
// @desc   Upload profile photo
// @access Private
router.post('/upload-photo', protect, upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded.' });
    }

    let photoUrl;

    // Try Cloudinary upload
    if (process.env.CLOUDINARY_CLOUD_NAME) {
      try {
        const result = await cloudinary.uploader.upload(req.file.path, {
          folder: 'holy-matrimony/profiles',
          width: 400,
          height: 400,
          crop: 'fill',
          quality: 'auto',
          format: 'webp',
        });
        photoUrl = result.secure_url;
      } catch (uploadErr) {
        console.error('Cloudinary upload failed:', uploadErr.message);
        return res.status(500).json({ success: false, message: 'Image upload failed. Please try again.' });
      } finally {
        if (req.file?.path && fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }
      }
    } else {
      // Fallback: store locally
      photoUrl = `/uploads/${req.file.filename}`;
    }

    // Update biodata and user
    await Biodata.findOneAndUpdate({ userId: req.user._id }, { profilePicture: photoUrl });
    await User.findByIdAndUpdate(req.user._id, { profilePicture: photoUrl });

    res.json({
      success: true,
      message: 'Photo uploaded successfully.',
      messageBn: 'ছবি সফলভাবে আপলোড হয়েছে।',
      photoUrl,
    });
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ success: false, message: 'Photo upload failed', error: error.message });
  }
});

// @route  GET /api/biodata/:id
// @desc   Get biodata by biodata _id OR by userId (for viewing from payments page)
// @access Private
router.get('/:id', protect, async (req, res) => {
  try {
    const populate = 'name gender profilePicture isVerified verificationBadge';

    // Try by biodata _id first, then fall back to userId
    let biodata = await Biodata.findById(req.params.id).populate('userId', populate).catch(() => null);

    if (!biodata) {
      biodata = await Biodata.findOne({ userId: req.params.id }).populate('userId', populate);
    }

    if (!biodata) {
      return res.status(404).json({ success: false, message: 'Biodata not found.' });
    }

    if (biodata.status !== 'approved' && biodata.userId._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'This biodata is not publicly available.' });
    }

    // Fetch viewer to check unlock status
    const viewer = await User.findById(req.user._id);

    // Gender rule: only bypass if viewer has already paid/unlocked this profile
    const biodataGender = biodata.userId.gender;
    const viewerGender = req.user.gender;
    const hasUnlocked = viewer.hasUnlockedContact(biodata.userId._id);

    if (biodataGender === viewerGender && !hasUnlocked && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'You can only view profiles of the opposite gender.',
        messageBn: 'আপনি শুধুমাত্র বিপরীত লিঙ্গের প্রোফাইল দেখতে পারবেন।',
      });
    }
    const sanitized = sanitizeBiodata(biodata, viewer);

    // Increment view count
    await Biodata.findByIdAndUpdate(req.params.id, { $inc: { views: 1 } });

    // Notify biodata owner of profile view
    await createNotification({
      userId: biodata.userId._id,
      type: 'profile_viewed',
      title: 'Profile Viewed',
      titleBn: 'প্রোফাইল দেখা হয়েছে',
      message: 'Someone viewed your profile.',
      messageBn: 'কেউ আপনার প্রোফাইল দেখেছে।',
    });

    res.json({ success: true, biodata: sanitized });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route  POST /api/biodata/:id/shortlist
// @desc   Shortlist or remove from shortlist a profile
// @access Private
router.post('/:id/shortlist', protect, async (req, res) => {
  try {
    const targetBiodata = await Biodata.findById(req.params.id);
    if (!targetBiodata) {
      return res.status(404).json({ success: false, message: 'Biodata not found.' });
    }

    const targetUserId = targetBiodata.userId;

    // Use atomic ops to prevent race conditions: $addToSet prevents duplicates
    const user = await User.findById(req.user._id).select('shortlistedProfiles');
    const isShortlisted = user.shortlistedProfiles.some(
      (id) => id.toString() === targetUserId.toString()
    );

    if (isShortlisted) {
      await User.findByIdAndUpdate(req.user._id, { $pull: { shortlistedProfiles: targetUserId } });
      await Biodata.findByIdAndUpdate(req.params.id, { $inc: { shortlistCount: -1 } });
      return res.json({ success: true, isShortlisted: false, message: 'Removed from shortlist.' });
    } else {
      // $addToSet prevents duplicates atomically
      await User.findByIdAndUpdate(req.user._id, { $addToSet: { shortlistedProfiles: targetUserId } });
      await Biodata.findByIdAndUpdate(req.params.id, { $inc: { shortlistCount: 1 } });

      // Notify the target user
      await createNotification({
        userId: targetUserId,
        type: 'shortlisted',
        title: 'Profile Shortlisted',
        titleBn: 'প্রোফাইল শর্টলিস্ট করা হয়েছে',
        message: 'Someone added your profile to their shortlist.',
        messageBn: 'কেউ আপনার প্রোফাইল শর্টলিস্ট করেছে।',
      });

      return res.json({ success: true, isShortlisted: true, message: 'Added to shortlist.' });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route  PATCH /api/biodata/me/married
// @desc   Mark own biodata as married
// @access Private
router.patch('/me/married', protect, async (req, res) => {
  try {
    const { marriedVia } = req.body;
    if (!marriedVia || !['এই সাইটের মাধ্যমে', 'অন্যভাবে'].includes(marriedVia)) {
      return res.status(400).json({ success: false, message: 'marriedVia is required.' });
    }

    const biodata = await Biodata.findOne({ userId: req.user._id });
    if (!biodata) return res.status(404).json({ success: false, message: 'Biodata not found.' });
    if (biodata.isMarried) return res.status(400).json({ success: false, message: 'Already marked as married.' });

    biodata.isMarried = true;
    biodata.marriedAt = new Date();
    biodata.marriedVia = marriedVia;
    biodata.isActive = false; // Hide from search
    await biodata.save();

    res.json({
      success: true,
      message: 'Congratulations! Profile marked as married.',
      messageBn: 'আল্লাহুমা বারিক! বিয়ে হিসেবে চিহ্নিত হয়েছে।',
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route  GET /api/biodata/suggested
// @desc   Get suggested matches based on own partner preferences
// @access Private
router.get('/suggested', protect, async (req, res) => {
  try {
    const myBiodata = await Biodata.findOne({ userId: req.user._id });
    const oppositeGender = req.user.gender === 'male' ? 'female' : 'male';

    const oppositeUsers = await User.find({ gender: oppositeGender }).select('_id');
    const userIds = oppositeUsers.map((u) => u._id);

    const query = {
      userId: { $in: userIds },
      status: 'approved',
      isMarried: { $ne: true },
      isActive: true,
    };

    if (myBiodata?.partnerExpectations) {
      const pe = myBiodata.partnerExpectations;
      if (pe.ageMin || pe.ageMax) {
        query['personal.age'] = {};
        if (pe.ageMin) query['personal.age'].$gte = pe.ageMin;
        if (pe.ageMax) query['personal.age'].$lte = pe.ageMax;
      }
    }

    const profiles = await Biodata.find(query)
      .populate('userId', 'name gender profilePicture isVerified verificationBadge')
      .sort({ createdAt: -1 })
      .limit(10);

    res.json({ success: true, profiles });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @route  GET /api/biodata/:id/download
// @desc   Download biodata as PDF
// @access Private
router.get('/:id/download', protect, async (req, res) => {
  try {
    const biodata = await Biodata.findById(req.params.id).populate(
      'userId', 'name gender profilePicture isVerified verificationBadge isPremium'
    );
    if (!biodata) return res.status(404).json({ success: false, message: 'Biodata not found.' });

    const viewerId = req.user._id.toString();
    const ownerId = biodata.userId._id.toString();
    const isOwner = viewerId === ownerId;
    const isAdmin = req.user.role === 'admin';
    const isPremium = req.user.isPremium;
    const hasPurchased = req.user.unlockedContacts?.some((uc) => uc.userId?.toString() === ownerId);

    if (!isOwner && !isAdmin && !isPremium && !hasPurchased) {
      return res.status(403).json({
        success: false,
        message: 'Purchase or premium required to download.',
        messageBn: 'ডাউনলোড করতে পেমেন্ট বা প্রিমিয়াম দরকার।',
      });
    }

    const { generateBiodataPDF } = require('../services/pdfService');
    const pdfBuffer = await generateBiodataPDF(biodata);

    const filename = `biodata-${biodata.personal?.fullName || biodata._id}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdfBuffer);
  } catch (error) {
    res.status(500).json({ success: false, message: 'PDF generation failed', error: error.message });
  }
});

module.exports = router;
