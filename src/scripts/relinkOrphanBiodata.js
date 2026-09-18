require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const mongoose = require('mongoose');
const crypto = require('crypto');
const User = require('../models/User');
const Biodata = require('../models/Biodata');

const genderByBiodataNumber = {
  BD000002: 'male',
  BD000003: 'male',
  BD000004: 'male',
  BD000005: 'male',
  BD000006: 'female',
  BD000007: 'female',
  BD000008: 'female',
  BD000009: 'female',
  BD000010: 'female',
};

const validEmail = (email) => /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/.test(email || '');
const validPhone = (phone) => /^(\+880|880|0)?1[3-9]\d{8}$/.test(phone || '');

const relink = async () => {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  const biodatas = await Biodata.find({ status: 'approved' }).lean();
  let relinked = 0;
  let skipped = 0;

  for (const biodata of biodatas) {
    const existingUser = await User.findById(biodata.userId).select('_id');
    if (existingUser) continue;

    const gender = genderByBiodataNumber[biodata.biodataNumber];
    if (!gender) {
      skipped += 1;
      console.warn(`Skipped ${biodata.biodataNumber}: gender mapping is missing`);
      continue;
    }

    const email = validEmail(biodata.contact?.email)
      ? biodata.contact.email.toLowerCase()
      : `relinked-${biodata._id}@invalid.loc`;
    const phone = validPhone(biodata.contact?.phone) ? biodata.contact.phone : undefined;
    const user = await User.create({
      name: biodata.personal.fullName,
      email,
      phone,
      password: crypto.randomBytes(24).toString('hex'),
      gender,
      isActive: true,
      isEmailVerified: false,
      isPhoneVerified: false,
      biodataId: biodata._id,
    });

    await Biodata.updateOne({ _id: biodata._id }, { $set: { userId: user._id } });
    relinked += 1;
    console.log(`Relinked ${biodata.biodataNumber} -> ${user._id}`);
  }

  console.log(JSON.stringify({ relinked, skipped }));
  await mongoose.disconnect();
};

relink().catch(async (error) => {
  console.error(error.message);
  await mongoose.disconnect();
  process.exit(1);
});