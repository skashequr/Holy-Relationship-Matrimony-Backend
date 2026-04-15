const mongoose = require('mongoose');

const biodataSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    biodataNumber: {
      type: String,
      unique: true,
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'draft'],
      default: 'pending',
    },
    rejectionReason: {
      type: String,
    },

    // Personal Information
    personal: {
      fullName: { type: String, required: true, trim: true },
      fatherName: { type: String, trim: true },
      motherName: { type: String, trim: true },
      dateOfBirth: { type: Date, required: true },
      age: { type: Number },
      birthPlace: { type: String },
      nationality: { type: String, default: 'Bangladeshi' },
      nidNumber: { type: String },
      maritalStatus: {
        type: String,
        enum: ['single', 'divorced', 'widowed', 'masna', 'rubaa', 'sulasa'],
        required: true,
      },
      numberOfChildren: { type: Number, default: 0 },
      height: { type: Number }, // in cm
      weight: { type: Number }, // in kg
      complexion: {
        type: String,
        enum: ['very_fair', 'fair', 'wheatish', 'brown', 'dark'],
      },
      bloodGroup: {
        type: String,
        enum: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'],
      },
      physicalDisability: { type: String, default: 'None' },
    },

    // Religious Information
    religion: {
      madhab: {
        type: String,
        enum: ['hanafi', 'maliki', 'shafi', 'hanbali', 'other'],
        default: 'hanafi',
      },
      praysFiveTimes: { type: Boolean, default: false },
      wearsPardah: { type: Boolean, default: false }, // for females
      hasBeard: { type: Boolean, default: false }, // for males
      followsSunnahDress: { type: Boolean, default: false },
      avoidsHaram: { type: Boolean, default: false },
      quranRecitation: {
        type: String,
        enum: ['complete', 'partial', 'learning', 'none'],
      },
    },

    // Educational Qualification
    education: {
      highestLevel: {
        type: String,
        enum: [
          'no_education',
          'psc',
          'jsc',
          'ssc',
          'hsc',
          'honours',
          'masters',
          'phd',
          'madrasa_dakhil',
          'madrasa_alim',
          'madrasa_fazil',
          'madrasa_kamil',
          'qawmi',
          'english_medium',
          'vocational',
          'others',
        ],
      },
      degreeName: { type: String },
      institution: { type: String },
      passingYear: { type: Number },
      subject: { type: String },
    },

    // Professional Information
    profession: {
      occupationType: {
        type: String,
        enum: [
          'student',
          'service_holder',
          'business',
          'doctor',
          'engineer',
          'teacher',
          'lawyer',
          'farmer',
          'housewife',
          'unemployed',
          'other',
        ],
      },
      designation: { type: String },
      organization: { type: String },
      monthlyIncome: {
        type: String,
        enum: [
          'no_income',
          'below_10k',
          '10k_25k',
          '25k_50k',
          '50k_100k',
          'above_100k',
        ],
      },
    },

    // Family Details
    family: {
      fatherAlive: { type: Boolean },
      fatherOccupation: { type: String },
      motherAlive: { type: Boolean },
      motherOccupation: { type: String },
      numberOfBrothers: { type: Number, default: 0 },
      numberOfSisters: { type: Number, default: 0 },
      familyType: {
        type: String,
        enum: ['nuclear', 'joint'],
      },
      familyStatus: {
        type: String,
        enum: ['lower', 'lower_middle', 'middle', 'upper_middle', 'upper'],
      },
      familyReligiousness: {
        type: String,
        enum: ['moderate', 'religious', 'very_religious'],
      },
    },

    // Address / Location
    address: {
      permanentDivision: { type: String },
      permanentDistrict: { type: String },
      permanentUpazila: { type: String },
      currentDivision: { type: String },
      currentDistrict: { type: String },
      currentUpazila: { type: String },
      grewUpIn: {
        type: String,
        enum: ['village', 'town', 'city'],
      },
    },

    // Lifestyle & Personality
    lifestyle: {
      hobbies: [{ type: String }],
      specialQualities: { type: String },
      aboutSelf: { type: String, maxlength: 1000 },
    },

    // Contact Information
    contact: {
      phone: { type: String },
      alternatePhone: { type: String },
      email: { type: String },
      guardianName: { type: String },
      guardianPhone: { type: String },
      guardianRelation: { type: String },
    },

    // Partner Expectations
    partnerExpectations: {
      ageMin: { type: Number },
      ageMax: { type: Number },
      heightMin: { type: Number },
      heightMax: { type: Number },
      complexion: [{ type: String }],
      education: [{ type: String }],
      profession: [{ type: String }],
      financialStatus: { type: String },
      district: [{ type: String }],
      maritalStatus: [{ type: String }],
      religiousness: { type: String },
      otherExpectations: { type: String, maxlength: 500 },
    },

    // Profile pictures
    profilePicture: {
      type: String,
      default: null,
    },
    additionalPhotos: [{ type: String }],

    // Visibility settings
    visibility: {
      showPhone: { type: Boolean, default: false },
      showEmail: { type: Boolean, default: false },
      profileVisibility: {
        type: String,
        enum: ['public', 'members_only', 'hidden'],
        default: 'members_only',
      },
    },

    // Married tracking
    isMarried: { type: Boolean, default: false },
    marriedAt: { type: Date, default: null },
    marriedVia: {
      type: String,
      enum: ['এই সাইটের মাধ্যমে', 'অন্যভাবে'],
      default: null,
    },

    // Stats
    views: { type: Number, default: 0 },
    shortlistCount: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: true,
  }
);

// Auto-generate biodata number before saving
biodataSchema.pre('save', async function (next) {
  if (!this.biodataNumber) {
    const count = await mongoose.model('Biodata').countDocuments();
    this.biodataNumber = `BD${String(count + 1).padStart(6, '0')}`;
  }

  // Auto-calculate age
  if (this.personal && this.personal.dateOfBirth) {
    const today = new Date();
    const dob = new Date(this.personal.dateOfBirth);
    let age = today.getFullYear() - dob.getFullYear();
    const monthDiff = today.getMonth() - dob.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
      age--;
    }
    this.personal.age = age;
  }

  next();
});

// Compound indexes for the most common query patterns
biodataSchema.index({ status: 1, isActive: 1 });               // search base filter
biodataSchema.index({ userId: 1, status: 1 });                 // profile lookup
biodataSchema.index({ status: 1, isActive: 1, isMarried: 1 }); // match suggestions
biodataSchema.index({ 'personal.age': 1 });
biodataSchema.index({ 'address.permanentDistrict': 1 });
biodataSchema.index({ 'address.permanentDivision': 1 });
biodataSchema.index({ 'education.highestLevel': 1 });
biodataSchema.index({ 'profession.occupationType': 1 });
biodataSchema.index({ createdAt: -1 });                        // default sort

module.exports = mongoose.model('Biodata', biodataSchema);
