require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');

const createAdmin = async () => {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected!');

    const email = process.env.ADMIN_EMAIL || 'admin@holyrelationship.com';
    const password = process.env.ADMIN_PASSWORD || 'AdminPass@123';

    // Delete existing admin (to reset password if needed)
    await User.deleteOne({ email });
    console.log('Removed old admin (if existed)');

    // Create fresh admin
    const admin = await User.create({
      name: 'Admin',
      email,
      phone: '01700000000',
      password,
      gender: 'male',
      role: 'admin',
      isVerified: true,
      isEmailVerified: true,
      isPhoneVerified: true,
      verificationBadge: true,
      isActive: true,
      isBanned: false,
    });

    // Verify the password hash works correctly
    const saved = await User.findById(admin._id).select('+password');
    const isMatch = await bcrypt.compare(password, saved.password);

    console.log('\n✅ Admin created successfully!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Email   :', email);
    console.log('Password:', password);
    console.log('ID      :', admin._id.toString());
    console.log('Hash OK :', isMatch ? '✅ YES — login will work' : '❌ NO — hash mismatch!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    if (!isMatch) {
      console.error('\n❌ Password hash verification FAILED. Check User.js pre-save hook.');
    }
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
};

createAdmin();
