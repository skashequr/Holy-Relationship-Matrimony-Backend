const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    value: { type: mongoose.Schema.Types.Mixed, required: true },
    description: { type: String },
  },
  { timestamps: true }
);

const Settings = mongoose.model('Settings', settingsSchema);

// Helper to get a setting value (with fallback)
Settings.get = async function (key, fallback = null) {
  const setting = await this.findOne({ key });
  return setting ? setting.value : fallback;
};

// Helper to set a setting value
Settings.set = async function (key, value) {
  return this.findOneAndUpdate({ key }, { value }, { upsert: true, new: true });
};

module.exports = Settings;
