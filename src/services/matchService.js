const Biodata = require('../models/Biodata');
const User = require('../models/User');

// Education tier map for proximity scoring
const EDU_TIER = {
  no_education: 1,
  psc: 2, jsc: 2, ssc: 2,
  hsc: 3, madrasa_dakhil: 3, madrasa_alim: 3,
  honours: 4, madrasa_fazil: 4, others: 4,
  masters: 5, madrasa_kamil: 5,
  phd: 6,
};

const STABLE_PROFESSIONS = ['doctor', 'engineer', 'teacher', 'service_holder', 'lawyer', 'business'];

/**
 * Score how well a candidate matches a seeker's expectations (0–100 per category)
 */
const scoreOneDimension = (seekerBiodata, candidateBiodata, seekerGender) => {
  const exp = seekerBiodata.partnerExpectations || {};
  const c = candidateBiodata;
  const breakdown = {};

  // ── Religious Mindset (30 pts) ────────────────────────────────────
  let religious = 0;
  if (c.religion?.praysFiveTimes) religious += 10;
  if (c.religion?.avoidsHaram) religious += 8;
  religious += ({ complete: 7, partial: 4, learning: 2, none: 0 }[c.religion?.quranRecitation] || 0);
  if (c.religion?.madhab && c.religion.madhab === seekerBiodata.religion?.madhab) religious += 3;
  religious += ({ very_religious: 2, religious: 1, moderate: 0 }[c.family?.familyReligiousness] || 0);
  breakdown.religious = Math.min(religious, 30);

  // ── Age Compatibility (20 pts) ────────────────────────────────────
  let age = 10;
  const cAge = c.personal?.age;
  const sAge = seekerBiodata.personal?.age;
  if (cAge) {
    if (exp.ageMin || exp.ageMax) {
      const inRange =
        (!exp.ageMin || cAge >= exp.ageMin) &&
        (!exp.ageMax || cAge <= exp.ageMax);
      if (inRange) {
        age = 20;
      } else {
        const diff = Math.min(
          exp.ageMin ? Math.abs(cAge - exp.ageMin) : 99,
          exp.ageMax ? Math.abs(cAge - exp.ageMax) : 99
        );
        age = diff <= 2 ? 14 : diff <= 5 ? 7 : diff <= 8 ? 3 : 0;
      }
    } else if (sAge) {
      const gap = seekerGender === 'male' ? sAge - cAge : cAge - sAge;
      if (gap >= 1 && gap <= 7) age = 18;
      else if (gap >= 0 && gap <= 12) age = 13;
      else if (gap >= -3 && gap < 0) age = 10;
      else age = 5;
    }
  }
  breakdown.age = Math.min(age, 20);

  // ── Location (15 pts) ─────────────────────────────────────────────
  let location = 5;
  if (exp.district && exp.district.length > 0) {
    if (exp.district.includes(c.address?.permanentDistrict)) location = 15;
    else if (exp.district.includes(c.address?.currentDistrict)) location = 10;
    else location = 2;
  } else if (seekerBiodata.address?.permanentDistrict) {
    if (c.address?.permanentDistrict === seekerBiodata.address.permanentDistrict) location = 15;
    else if (c.address?.permanentDivision === seekerBiodata.address?.permanentDivision) location = 8;
  }
  breakdown.location = Math.min(location, 15);

  // ── Education (15 pts) ────────────────────────────────────────────
  let education = 8;
  const cEduTier = EDU_TIER[c.education?.highestLevel] || 0;
  if (exp.education && exp.education.length > 0) {
    if (exp.education.includes(c.education?.highestLevel)) {
      education = 15;
    } else {
      const expTier = Math.max(...exp.education.map((e) => EDU_TIER[e] || 0));
      const diff = Math.abs(cEduTier - expTier);
      education = diff === 0 ? 15 : diff === 1 ? 9 : diff === 2 ? 4 : 1;
    }
  } else if (cEduTier > 0) {
    education = cEduTier >= 5 ? 15 : cEduTier === 4 ? 12 : cEduTier === 3 ? 8 : 5;
  }
  breakdown.education = Math.min(education, 15);

  // ── Profession (10 pts) ───────────────────────────────────────────
  let profession = 5;
  if (exp.profession && exp.profession.length > 0) {
    profession = exp.profession.includes(c.profession?.occupationType) ? 10 : 3;
  } else {
    profession = STABLE_PROFESSIONS.includes(c.profession?.occupationType) ? 8 : 5;
  }
  breakdown.profession = Math.min(profession, 10);

  // ── Lifestyle / Family (10 pts) ───────────────────────────────────
  let lifestyle = 0;
  lifestyle += ({ very_religious: 4, religious: 3, moderate: 1 }[c.family?.familyReligiousness] || 0);
  if (c.personal?.maritalStatus === 'single') lifestyle += 3;
  else if (c.personal?.maritalStatus) lifestyle += 1;
  if (c.lifestyle?.aboutSelf) lifestyle += 2;
  if (c.lifestyle?.hobbies?.length > 0) lifestyle += 1;
  breakdown.lifestyle = Math.min(lifestyle, 10);

  const total = Object.values(breakdown).reduce((s, v) => s + v, 0);
  return { total: Math.min(Math.round(total), 100), breakdown };
};

/**
 * Bidirectional score: seeker→candidate (65%) + candidate→seeker (35%)
 * Gives a more realistic "mutual fit" score
 */
const calculateCompatibilityScore = (seekerBiodata, candidateBiodata, seekerGender) => {
  const forward = scoreOneDimension(seekerBiodata, candidateBiodata, seekerGender);

  // Reverse: how well seeker fits candidate's expectations
  const reverseGender = seekerGender === 'male' ? 'female' : 'male';
  const reverse = scoreOneDimension(candidateBiodata, seekerBiodata, reverseGender);

  // Weighted average — seeker's satisfaction matters more (65/35)
  const finalTotal = Math.round(forward.total * 0.65 + reverse.total * 0.35);

  return {
    total: Math.min(finalTotal, 100),
    breakdown: forward.breakdown, // show forward breakdown to user
    reverseScore: reverse.total,
  };
};

/**
 * Generate 2–3 Bengali match reason strings for display
 */
const generateMatchReasons = (seekerBiodata, candidateBiodata, breakdown, seekerGender) => {
  const reasons = [];
  const c = candidateBiodata;
  const s = seekerBiodata;
  const exp = s.partnerExpectations || {};

  // Religious reasons
  if (breakdown.religious >= 25) {
    if (c.religion?.praysFiveTimes && c.religion?.avoidsHaram) {
      reasons.push('নিয়মিত নামাযী ও হারাম বর্জনকারী');
    } else if (c.religion?.praysFiveTimes) {
      reasons.push('নিয়মিত ৫ ওয়াক্ত নামাযী');
    }
    if (c.religion?.madhab === s.religion?.madhab && c.religion?.madhab) {
      reasons.push('একই মাযহাব');
    }
  } else if (breakdown.religious >= 15) {
    reasons.push('ধর্মীয় মানসিকতা মিলেছে');
  }

  // Age reasons
  if (breakdown.age >= 18) {
    if (exp.ageMin || exp.ageMax) {
      reasons.push('পছন্দের বয়সসীমায় আছেন');
    } else {
      reasons.push('বয়সের ব্যবধান উপযুক্ত');
    }
  }

  // Location reasons
  if (breakdown.location >= 13) {
    reasons.push(`একই জেলা (${c.address?.permanentDistrict})`);
  } else if (breakdown.location >= 7) {
    reasons.push(`একই বিভাগ (${c.address?.permanentDivision})`);
  }

  // Education reasons
  if (breakdown.education >= 13) {
    if (exp.education?.includes(c.education?.highestLevel)) {
      reasons.push('পছন্দের শিক্ষাগত যোগ্যতা');
    } else {
      reasons.push('শিক্ষাগত মান মিলেছে');
    }
  }

  // Profession reasons
  if (breakdown.profession >= 9) {
    reasons.push('পছন্দের পেশায় আছেন');
  } else if (STABLE_PROFESSIONS.includes(c.profession?.occupationType)) {
    reasons.push('পেশাগতভাবে সুপ্রতিষ্ঠিত');
  }

  // Family religiousness
  if (c.family?.familyReligiousness === 'very_religious') {
    reasons.push('অত্যন্ত ধার্মিক পরিবার');
  } else if (c.family?.familyReligiousness === 'religious') {
    reasons.push('ধার্মিক পরিবার');
  }

  return reasons.slice(0, 3);
};

/**
 * Get recommended matches sorted by score, with full breakdown + reasons
 */
const getRecommendedMatches = async (userId, limit = 10, page = 1, minScore = 0) => {
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');

  const userBiodata = await Biodata.findOne({ userId, status: 'approved' });

  const targetGender = user.gender === 'male' ? 'female' : 'male';
  const targetUsers = await User.find({
    gender: targetGender,
    isActive: true,
    isBanned: false,
    _id: { $nin: user.shortlistedProfiles || [] },
  }).select('_id');

  const candidateBiodatas = await Biodata.find({
    userId: { $in: targetUsers.map((u) => u._id) },
    status: 'approved',
    isActive: true,
    isMarried: { $ne: true },
  }).populate('userId', 'profilePicture gender isVerified verificationBadge isPremium');

  let scoredProfiles = candidateBiodatas.map((biodata) => {
    let total = 50;
    let breakdown = {};
    let reverseScore = 50;
    let reasons = [];

    if (userBiodata) {
      const result = calculateCompatibilityScore(userBiodata, biodata, user.gender);
      total = result.total;
      breakdown = result.breakdown;
      reverseScore = result.reverseScore;
      reasons = generateMatchReasons(userBiodata, biodata, breakdown, user.gender);
    }

    // Boost score if candidate's profile is more complete (has photo, about self)
    let boost = 0;
    if (biodata.profilePicture) boost += 3;
    if (biodata.lifestyle?.aboutSelf) boost += 2;
    total = Math.min(total + boost, 100);

    return { biodata, total, breakdown, reverseScore, reasons };
  });

  // Filter by minimum score
  if (minScore > 0) {
    scoredProfiles = scoredProfiles.filter((p) => p.total >= minScore);
  }

  // Sort: first by score desc, then premium profiles first within same score tier
  scoredProfiles.sort((a, b) => {
    const scoreDiff = b.total - a.total;
    if (scoreDiff !== 0) return scoreDiff;
    // Same score tier: prefer profiles with photos
    const aHasPhoto = a.biodata.profilePicture ? 1 : 0;
    const bHasPhoto = b.biodata.profilePicture ? 1 : 0;
    return bHasPhoto - aHasPhoto;
  });

  const skip = (page - 1) * limit;
  const paginated = scoredProfiles.slice(skip, skip + limit);

  // Score distribution for UI
  const distribution = {
    excellent: scoredProfiles.filter((p) => p.total >= 80).length,
    good: scoredProfiles.filter((p) => p.total >= 60 && p.total < 80).length,
    average: scoredProfiles.filter((p) => p.total >= 40 && p.total < 60).length,
    low: scoredProfiles.filter((p) => p.total < 40).length,
  };

  return {
    profiles: paginated.map(({ biodata, total, breakdown, reverseScore, reasons }) => ({
      ...sanitizeBiodata(biodata, user),
      compatibilityScore: total,
      scoreBreakdown: breakdown,
      reverseScore,
      matchReasons: reasons,
    })),
    total: scoredProfiles.length,
    page,
    totalPages: Math.ceil(scoredProfiles.length / limit),
    distribution,
  };
};

/**
 * Calculate profile completeness percentage and suggestions
 */
const calculateProfileCompleteness = (biodata, gender) => {
  const sections = [];

  const check = (value) => {
    if (value === undefined || value === null || value === '') return false;
    if (Array.isArray(value) && value.length === 0) return false;
    return true;
  };

  const addSection = (name, label, icon, fields) => {
    let earned = 0;
    const missing = [];
    const max = fields.reduce((s, f) => s + f.pts, 0);
    fields.forEach(({ value, label: fLabel, pts }) => {
      if (check(value)) earned += pts;
      else missing.push({ label: fLabel, pts });
    });
    sections.push({ name, label, icon, earned, max, missing });
  };

  const p = biodata.personal || {};
  const r = biodata.religion || {};
  const e = biodata.education || {};
  const pr = biodata.profession || {};
  const f = biodata.family || {};
  const a = biodata.address || {};
  const l = biodata.lifestyle || {};
  const c = biodata.contact || {};
  const pe = biodata.partnerExpectations || {};

  addSection('photo', 'ছবি', '📷', [
    { value: biodata.profilePicture, label: 'প্রোফাইল ছবি', pts: 10 },
  ]);

  addSection('personal', 'ব্যক্তিগত', '👤', [
    { value: p.fullName, label: 'পুরো নাম', pts: 3 },
    { value: p.dateOfBirth, label: 'জন্ম তারিখ', pts: 3 },
    { value: p.maritalStatus, label: 'বৈবাহিক অবস্থা', pts: 2 },
    { value: p.height, label: 'উচ্চতা', pts: 2 },
    { value: p.complexion, label: 'গায়ের রঙ', pts: 2 },
    { value: p.fatherName, label: 'পিতার নাম', pts: 2 },
    { value: p.motherName, label: 'মাতার নাম', pts: 2 },
    { value: p.weight, label: 'ওজন', pts: 1 },
    { value: p.bloodGroup, label: 'রক্তের গ্রুপ', pts: 1 },
    { value: p.birthPlace, label: 'জন্মস্থান', pts: 1 },
    { value: p.nationality, label: 'জাতীয়তা', pts: 1 },
  ]);

  const religionFields = [
    { value: r.quranRecitation, label: 'কুরআন তিলাওয়াত', pts: 3 },
    { value: r.madhab, label: 'মাযহাব', pts: 2 },
    { value: r.followsSunnahDress, label: 'সুন্নতি পোশাক', pts: 2 },
  ];
  if (gender === 'female') {
    religionFields.push({ value: r.wearsPardah ? 'yes' : null, label: 'পর্দা পালন', pts: 3 });
  } else {
    religionFields.push({ value: r.hasBeard ? 'yes' : null, label: 'দাড়ি', pts: 3 });
  }
  addSection('religion', 'ধর্মীয়', '🕌', religionFields);

  addSection('education', 'শিক্ষা', '🎓', [
    { value: e.highestLevel, label: 'সর্বোচ্চ শিক্ষা', pts: 4 },
    { value: e.degreeName, label: 'ডিগ্রির নাম', pts: 2 },
    { value: e.institution, label: 'প্রতিষ্ঠান', pts: 2 },
    { value: e.subject, label: 'বিষয়', pts: 1 },
    { value: e.passingYear, label: 'পাসের বছর', pts: 1 },
  ]);

  addSection('profession', 'পেশা', '💼', [
    { value: pr.occupationType, label: 'পেশার ধরন', pts: 5 },
    { value: pr.monthlyIncome, label: 'মাসিক আয়', pts: 3 },
    { value: pr.organization, label: 'প্রতিষ্ঠান', pts: 2 },
  ]);

  addSection('family', 'পরিবার', '🏠', [
    { value: f.fatherAlive !== undefined ? String(f.fatherAlive) : null, label: 'পিতার অবস্থা', pts: 2 },
    { value: f.motherAlive !== undefined ? String(f.motherAlive) : null, label: 'মাতার অবস্থা', pts: 2 },
    { value: f.familyType, label: 'পরিবারের ধরন', pts: 2 },
    { value: f.familyStatus, label: 'পারিবারিক অবস্থা', pts: 1 },
    { value: f.familyReligiousness, label: 'পারিবারিক ধার্মিকতা', pts: 1 },
    { value: f.numberOfBrothers !== undefined ? String(f.numberOfBrothers) : null, label: 'ভাইয়ের সংখ্যা', pts: 1 },
    { value: f.numberOfSisters !== undefined ? String(f.numberOfSisters) : null, label: 'বোনের সংখ্যা', pts: 1 },
  ]);

  addSection('address', 'ঠিকানা', '📍', [
    { value: a.permanentDistrict, label: 'স্থায়ী জেলা', pts: 4 },
    { value: a.permanentDivision, label: 'স্থায়ী বিভাগ', pts: 3 },
    { value: a.currentDistrict, label: 'বর্তমান জেলা', pts: 2 },
    { value: a.permanentUpazila, label: 'উপজেলা', pts: 1 },
  ]);

  addSection('lifestyle', 'ব্যক্তিত্ব', '✨', [
    { value: l.aboutSelf, label: 'নিজের সম্পর্কে', pts: 3 },
    { value: l.hobbies?.length > 0 ? l.hobbies : null, label: 'শখ', pts: 2 },
  ]);

  addSection('contact', 'যোগাযোগ', '📞', [
    { value: c.phone, label: 'ফোন নম্বর', pts: 3 },
    { value: c.guardianName, label: 'অভিভাবকের নাম', pts: 1 },
    { value: c.guardianPhone, label: 'অভিভাবকের ফোন', pts: 1 },
  ]);

  addSection('partner', 'প্রত্যাশা', '💑', [
    { value: pe.ageMin || pe.ageMax ? 'set' : null, label: 'বয়সসীমা', pts: 2 },
    { value: pe.education?.length > 0 ? pe.education : null, label: 'শিক্ষার প্রত্যাশা', pts: 1 },
    { value: pe.district?.length > 0 ? pe.district : null, label: 'জেলার প্রত্যাশা', pts: 1 },
    { value: pe.otherExpectations, label: 'অন্যান্য প্রত্যাশা', pts: 1 },
  ]);

  const totalEarned = sections.reduce((s, sec) => s + sec.earned, 0);
  const totalMax = sections.reduce((s, sec) => s + sec.max, 0);
  const percentage = Math.round((totalEarned / totalMax) * 100);

  const allMissing = sections.flatMap((sec) =>
    sec.missing.map((m) => ({ ...m, section: sec.label }))
  );
  allMissing.sort((a, b) => b.pts - a.pts);
  const suggestions = allMissing.slice(0, 5).map((m) => ({
    section: m.section,
    field: m.label,
    pts: m.pts,
  }));

  return { percentage, sections, suggestions, totalEarned, totalMax };
};

/**
 * Sanitize biodata — hide contact unless unlocked, hide female photos from non-admin viewers
 */
const sanitizeBiodata = (biodata, viewer) => {
  const data = biodata.toObject ? biodata.toObject() : { ...biodata };

  const viewerId = viewer?._id?.toString();
  const ownerId = data.userId?._id?.toString() || data.userId?.toString();
  const isAdmin = viewer && viewer.role === 'admin';
  const isOwner = viewerId && viewerId === ownerId;

  // ── Female photo privacy rule ──────────────────────────────────────
  // Female profile pictures are only visible to admin.
  // Everyone else (male users, female users, unauthenticated) sees a hidden placeholder.
  // The owner can still see her own photo (e.g. on her own profile page).
  const profileGender = data.userId?.gender;
  if (profileGender === 'female' && !isAdmin && !isOwner) {
    data.profilePicture = null;
    if (data.userId && typeof data.userId === 'object') {
      data.userId = { ...data.userId, profilePicture: null };
    }
    // Signal to the frontend that the photo exists but is intentionally hidden
    data.photoHidden = true;
  }

  // ── Contact unlock rule ────────────────────────────────────────────
  const hasUnlocked =
    viewer &&
    viewer.unlockedContacts &&
    viewer.unlockedContacts.some(
      (uc) =>
        uc.userId.toString() === ownerId
    );

  if (!hasUnlocked) {
    if (data.contact) {
      data.contact = {
        guardianName: data.contact.guardianName,
        guardianRelation: data.contact.guardianRelation,
      };
    }
    if (data.personal) {
      data.personal = { ...data.personal, nidNumber: undefined };
    }
  }

  return data;
};

module.exports = {
  getRecommendedMatches,
  calculateCompatibilityScore,
  calculateProfileCompleteness,
  generateMatchReasons,
  sanitizeBiodata,
};
