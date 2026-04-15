require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Biodata = require('../models/Biodata');
const connectDB = require('../config/db');

const seed = async () => {
  await connectDB();
  console.log('🌱 Seeding database...');

  // Clear existing data (dev only)
  await User.deleteMany({ role: { $ne: 'admin' } });
  await Biodata.deleteMany({});
  console.log('✓ Cleared existing users & biodatas');

  // Create admin
  const adminExists = await User.findOne({ email: process.env.ADMIN_EMAIL });
  if (!adminExists) {
    await User.create({
      name: 'Admin',
      email: process.env.ADMIN_EMAIL || 'admin@holyrelationship.com',
      phone: '01700000000',
      password: process.env.ADMIN_PASSWORD || 'AdminPass@123',
      gender: 'male',
      role: 'admin',
      isVerified: true,
      isEmailVerified: true,
      verificationBadge: true,
    });
    console.log('✓ Admin created:', process.env.ADMIN_EMAIL);
  }

  // Create sample male users
  const maleData = [
    { name: 'আহমেদ হাসান', email: 'ahmed@test.com', phone: '01711111111', district: 'Dhaka', education: 'honours', profession: 'engineer', age: 28 },
    { name: 'মোহাম্মদ রাহিম', email: 'rahim@test.com', phone: '01722222222', district: 'Chittagong', education: 'masters', profession: 'doctor', age: 32 },
    { name: 'আব্দুল্লাহ খান', email: 'khan@test.com', phone: '01733333333', district: 'Rajshahi', education: 'hsc', profession: 'business', age: 26 },
    { name: 'মাহমুদ হোসেন', email: 'mahmud@test.com', phone: '01744444444', district: 'Sylhet', education: 'honours', profession: 'teacher', age: 30 },
    { name: 'ইব্রাহিম মোল্লা', email: 'ibrahim@test.com', phone: '01755555555', district: 'Khulna', education: 'masters', profession: 'service_holder', age: 27 },
  ];

  const femaleData = [
    { name: 'ফাতেমা বেগম', email: 'fatema@test.com', phone: '01811111111', district: 'Dhaka', education: 'honours', profession: 'teacher', age: 24 },
    { name: 'আয়েশা সিদ্দিকা', email: 'aisha@test.com', phone: '01822222222', district: 'Chittagong', education: 'masters', profession: 'doctor', age: 26 },
    { name: 'মারিয়াম আক্তার', email: 'mariam@test.com', phone: '01833333333', district: 'Rajshahi', education: 'hsc', profession: 'student', age: 22 },
    { name: 'সুমাইয়া খাতুন', email: 'sumaiya@test.com', phone: '01844444444', district: 'Sylhet', education: 'honours', profession: 'service_holder', age: 25 },
    { name: 'নূর জাহান', email: 'noor@test.com', phone: '01855555555', district: 'Mymensingh', education: 'masters', profession: 'teacher', age: 28 },
  ];

  for (const m of maleData) {
    const user = await User.create({
      name: m.name, email: m.email, phone: m.phone,
      password: 'Test@1234', gender: 'male',
      isVerified: true, isEmailVerified: true, verificationBadge: Math.random() > 0.5,
    });

    await Biodata.create({
      userId: user._id,
      status: 'approved',
      personal: {
        fullName: m.name, fatherName: 'মোঃ আব্দুল হক', motherName: 'রাহেলা বেগম',
        dateOfBirth: new Date(new Date().getFullYear() - m.age, 0, 1),
        birthPlace: m.district, maritalStatus: 'single', nationality: 'Bangladeshi',
        height: 165 + Math.floor(Math.random() * 15),
        weight: 60 + Math.floor(Math.random() * 20),
        complexion: ['fair', 'wheatish', 'brown'][Math.floor(Math.random() * 3)],
        bloodGroup: ['A+', 'B+', 'O+', 'AB+'][Math.floor(Math.random() * 4)],
        physicalDisability: 'None',
      },
      religion: {
        madhab: 'hanafi',
        praysFiveTimes: Math.random() > 0.3,
        hasBeard: Math.random() > 0.5,
        avoidsHaram: Math.random() > 0.4,
        quranRecitation: ['complete', 'partial', 'learning'][Math.floor(Math.random() * 3)],
      },
      education: {
        highestLevel: m.education, degreeName: 'B.Sc Engineering',
        institution: 'BUET / CUET', passingYear: 2018 + Math.floor(Math.random() * 5), subject: 'Engineering',
      },
      profession: {
        occupationType: m.profession, designation: 'Engineer / Officer',
        organization: 'ABC Ltd', monthlyIncome: '25k_50k',
      },
      family: {
        fatherAlive: true, fatherOccupation: 'Business',
        motherAlive: true, motherOccupation: 'Housewife',
        numberOfBrothers: 2, numberOfSisters: 1,
        familyType: 'nuclear', familyStatus: 'middle', familyReligiousness: 'religious',
      },
      address: {
        permanentDivision: 'Dhaka', permanentDistrict: m.district, permanentUpazila: 'Central',
        currentDivision: 'Dhaka', currentDistrict: 'Dhaka', currentUpazila: 'Mirpur',
        grewUpIn: 'city',
      },
      lifestyle: { aboutSelf: 'আমি একজন সাধারণ ধার্মিক মানুষ। ইসলামিক মূল্যবোধ মেনে জীবনযাপন করি।' },
      contact: { phone: m.phone, email: m.email, guardianName: 'মোঃ আব্দুল হক', guardianPhone: '01600000000', guardianRelation: 'পিতা' },
      partnerExpectations: { ageMin: 20, ageMax: 30, otherExpectations: 'ধার্মিক এবং পরিবারকে সম্মান করেন এমন মেয়ে চাই।' },
    });
    await User.findByIdAndUpdate(user._id, { biodataId: (await Biodata.findOne({ userId: user._id }))._id });
  }

  for (const f of femaleData) {
    const user = await User.create({
      name: f.name, email: f.email, phone: f.phone,
      password: 'Test@1234', gender: 'female',
      isVerified: true, isEmailVerified: true, verificationBadge: Math.random() > 0.5,
    });

    await Biodata.create({
      userId: user._id,
      status: 'approved',
      personal: {
        fullName: f.name, fatherName: 'মোঃ আবু বকর', motherName: 'হাফসা বেগম',
        dateOfBirth: new Date(new Date().getFullYear() - f.age, 0, 1),
        birthPlace: f.district, maritalStatus: 'single', nationality: 'Bangladeshi',
        height: 152 + Math.floor(Math.random() * 12),
        weight: 48 + Math.floor(Math.random() * 15),
        complexion: ['very_fair', 'fair', 'wheatish'][Math.floor(Math.random() * 3)],
        bloodGroup: ['A+', 'B+', 'O+', 'AB+'][Math.floor(Math.random() * 4)],
        physicalDisability: 'None',
      },
      religion: {
        madhab: 'hanafi',
        praysFiveTimes: Math.random() > 0.2,
        wearsPardah: Math.random() > 0.4,
        avoidsHaram: Math.random() > 0.3,
        quranRecitation: ['complete', 'partial'][Math.floor(Math.random() * 2)],
      },
      education: {
        highestLevel: f.education, degreeName: 'B.A. / B.Sc',
        institution: 'DU / JU', passingYear: 2019 + Math.floor(Math.random() * 4), subject: 'Arts / Science',
      },
      profession: {
        occupationType: f.profession, designation: 'Teacher / Officer',
        organization: 'School / Office', monthlyIncome: '10k_25k',
      },
      family: {
        fatherAlive: true, fatherOccupation: 'Service',
        motherAlive: true, motherOccupation: 'Housewife',
        numberOfBrothers: 1, numberOfSisters: 2,
        familyType: 'nuclear', familyStatus: 'middle', familyReligiousness: 'religious',
      },
      address: {
        permanentDivision: 'Dhaka', permanentDistrict: f.district, permanentUpazila: 'Central',
        currentDivision: 'Dhaka', currentDistrict: 'Dhaka', currentUpazila: 'Dhanmondi',
        grewUpIn: 'city',
      },
      lifestyle: {
        aboutSelf: 'আমি একজন শিক্ষিত মেয়ে। ইসলামিক মূল্যবোধ মেনে সংসার করতে চাই।',
        hobbies: ['রান্না করা', 'কুরআন পড়া', 'বই পড়া'],
      },
      contact: { phone: f.phone, email: f.email, guardianName: 'মোঃ আবু বকর', guardianPhone: '01600000001', guardianRelation: 'পিতা' },
      partnerExpectations: { ageMin: 25, ageMax: 35, otherExpectations: 'ধার্মিক, শিক্ষিত এবং পরিবারকে সম্মান করেন এমন ছেলে চাই।' },
    });
    await User.findByIdAndUpdate(user._id, { biodataId: (await Biodata.findOne({ userId: user._id }))._id });
  }

  console.log('✓ Created 5 male + 5 female sample users with approved biodatas');
  console.log('\n🎉 Seeding complete!\n');
  console.log('Test accounts (password: Test@1234):');
  maleData.forEach((m) => console.log(` 👨 ${m.email}`));
  femaleData.forEach((f) => console.log(` 👩 ${f.email}`));
  console.log(`\n👑 Admin: ${process.env.ADMIN_EMAIL || 'admin@holyrelationship.com'} / ${process.env.ADMIN_PASSWORD || 'AdminPass@123'}`);

  process.exit(0);
};

seed().catch((err) => { console.error('Seed error:', err); process.exit(1); });
