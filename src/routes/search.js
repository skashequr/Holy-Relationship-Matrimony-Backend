const express = require('express');
const router = express.Router();

const Biodata = require('../models/Biodata');
const User = require('../models/User');
const { protect } = require('../middleware/auth');
const { searchLimiter } = require('../middleware/rateLimiter');
const { sanitizeBiodata } = require('../services/matchService');

// @route  GET /api/search
// @desc   Search and filter biodata profiles
// @access Private
router.get('/', protect, searchLimiter, async (req, res) => {
  try {
    const {
      ageMin,
      ageMax,
      heightMin,
      heightMax,
      maritalStatus,
      division,
      district,
      education,
      profession,
      complexion,
      madhab,
      praysFiveTimes,
      income,
      familyReligiousness,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = req.query;

    // Enforce safe pagination bounds
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 12));

    // Escape special regex characters to prevent ReDoS injection
    const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Build query
    const query = { status: 'approved', isActive: true };

    // Only show opposite gender profiles
    const targetGender = req.user.gender === 'male' ? 'female' : 'male';
    const targetUsers = await User.find({ gender: targetGender, isActive: true, isBanned: false }).select('_id');
    query.userId = { $in: targetUsers.map((u) => u._id) };

    // Age filter
    if (ageMin || ageMax) {
      query['personal.age'] = {};
      if (ageMin) query['personal.age'].$gte = Number(ageMin);
      if (ageMax) query['personal.age'].$lte = Number(ageMax);
    }

    // Height filter
    if (heightMin || heightMax) {
      query['personal.height'] = {};
      if (heightMin) query['personal.height'].$gte = Number(heightMin);
      if (heightMax) query['personal.height'].$lte = Number(heightMax);
    }

    // Marital status
    if (maritalStatus) {
      query['personal.maritalStatus'] = maritalStatus;
    }

    // Location — escape user input before using in regex to prevent ReDoS
    if (division) {
      query['address.permanentDivision'] = { $regex: escapeRegex(division), $options: 'i' };
    }
    if (district) {
      query['address.permanentDistrict'] = { $regex: escapeRegex(district), $options: 'i' };
    }

    // Education
    if (education) {
      query['education.highestLevel'] = education;
    }

    // Profession
    if (profession) {
      query['profession.occupationType'] = profession;
    }

    // Complexion
    if (complexion) {
      query['personal.complexion'] = complexion;
    }

    // Religious filters
    if (madhab) {
      query['religion.madhab'] = madhab;
    }
    if (praysFiveTimes === 'true') {
      query['religion.praysFiveTimes'] = true;
    }

    // Income filter
    if (income) {
      query['profession.monthlyIncome'] = income;
    }

    // Family religiousness
    if (familyReligiousness) {
      query['family.familyReligiousness'] = familyReligiousness;
    }

    // Whitelist sortBy to prevent arbitrary field injection
    const allowedSortFields = ['createdAt', 'personal.age', 'views', 'shortlistCount'];
    const safeSortBy = allowedSortFields.includes(sortBy) ? sortBy : 'createdAt';

    const skip = (page - 1) * limit;
    const sortObj = { [safeSortBy]: sortOrder === 'asc' ? 1 : -1 };

    const [biodatas, total] = await Promise.all([
      Biodata.find(query)
        .populate('userId', 'name gender profilePicture isVerified verificationBadge')
        .sort(sortObj)
        .skip(skip)
        .limit(Number(limit)),
      Biodata.countDocuments(query),
    ]);

    const viewer = await User.findById(req.user._id);

    const sanitizedBiodatas = biodatas.map((b) => sanitizeBiodata(b, viewer));

    res.json({
      success: true,
      data: sanitizedBiodatas,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
});

// @route  GET /api/search/districts
// @desc   Get list of districts for filter
// @access Public
router.get('/meta/districts', (req, res) => {
  const divisions = {
    Dhaka: ['Dhaka', 'Gazipur', 'Narayanganj', 'Narsingdi', 'Manikganj', 'Munshiganj', 'Faridpur', 'Madaripur', 'Shariatpur', 'Rajbari', 'Gopalganj', 'Kishoreganj', 'Tangail'],
    Chittagong: ['Chittagong', "Cox's Bazar", 'Comilla', 'Feni', 'Noakhali', 'Lakshmipur', 'Chandpur', 'Brahmanbaria', 'Khagrachhari', 'Rangamati', 'Bandarban'],
    Rajshahi: ['Rajshahi', 'Natore', 'Naogaon', 'Chapai Nawabganj', 'Pabna', 'Sirajganj', 'Bogura', 'Joypurhat'],
    Khulna: ['Khulna', 'Jessore', 'Satkhira', 'Narail', 'Bagerhat', 'Magura', 'Jhenaidah', 'Kushtia', 'Meherpur', 'Chuadanga'],
    Barishal: ['Barishal', 'Patuakhali', 'Pirojpur', 'Bhola', 'Jhalokati', 'Barguna'],
    Sylhet: ['Sylhet', 'Moulvibazar', 'Habiganj', 'Sunamganj'],
    Rangpur: ['Rangpur', 'Dinajpur', 'Nilphamari', 'Gaibandha', 'Kurigram', 'Lalmonirhat', 'Thakurgaon', 'Panchagarh'],
    Mymensingh: ['Mymensingh', 'Netrokona', 'Sherpur', 'Jamalpur'],
  };

  res.json({ success: true, divisions });
});

module.exports = router;
