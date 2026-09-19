const crypto = require('crypto');
const User = require('../models/User');
const Biodata = require('../models/Biodata');
const { sendEmail } = require('./notificationService');

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fields = {
  personal: ['fullName', 'fatherName', 'motherName', 'dateOfBirth', 'maritalStatus', 'height', 'weight'],
  education: ['highestLevel', 'degreeName', 'institution', 'subject'],
  profession: ['occupationType', 'designation', 'organization', 'monthlyIncome'],
  address: ['permanentDivision', 'permanentDistrict', 'permanentUpazila', 'currentDistrict'],
  lifestyle: ['aboutSelf'],
  contact: ['phone', 'email', 'guardianName', 'guardianPhone', 'guardianRelation'],
};
function biodataPayload(input, user) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('বায়োডাটার তথ্য সঠিকভাবে দিন।');
  const data = { userId: user._id, status: 'approved', biodataNumber: `BD${crypto.randomBytes(6).toString('hex').toUpperCase()}` };
  for (const [section, keys] of Object.entries(fields)) {
    data[section] = {};
    for (const key of keys) {
      const value = input[section]?.[key];
      if (value !== undefined && value !== '') {
        if (!['string', 'number'].includes(typeof value)) throw fail('বায়োডাটার তথ্য সঠিকভাবে দিন।');
        data[section][key] = typeof value === 'string' ? value.trim() : value;
      }
    }
  }
  data.personal.fullName ||= user.name;
  const dob = new Date(data.personal.dateOfBirth);
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  if (today.getMonth() < dob.getMonth() || (today.getMonth() === dob.getMonth() && today.getDate() < dob.getDate())) age--;
  if (!Number.isFinite(dob.getTime()) || age < 18 || age > 100) throw fail('জন্মতারিখ দিন। সদস্যের বয়স ১৮–১০০ বছরের মধ্যে হতে হবে।');
  return data;
}
async function sendLoginEmail(user, password) {
  const base = (process.env.FRONTEND_URL || 'http://localhost:3000').split(',')[0].trim().replace(/\/$/, '');
  const login = `${base}/login`;
  const recovery = `${base}/forgot-password`;
  const details = password ? `প্রাথমিক পাসওয়ার্ড: ${password}\nলগইনের পর সেটিংস থেকে পাসওয়ার্ড পরিবর্তন করুন।` : `পাসওয়ার্ড সেট করতে ইমেইলে OTP নিন: ${recovery}`;
  try {
    const result = await sendEmail({ to: user.email, subject: 'Holy Matrimony — আপনার অ্যাকাউন্টের লগইন তথ্য',
      text: `প্রিয় ${user.name},\nআপনার অ্যাকাউন্ট প্রস্তুত।\nইমেইল: ${user.email}\n${details}\nলগইন: ${login}`,
      html: `<div style="max-width:560px;margin:auto;background:#fbf8f1;font-family:Arial;padding:32px;color:#342b22"><h2 style="color:#89652e">Holy Matrimony</h2><p>প্রিয় ${escape(user.name)}, আপনার অ্যাকাউন্ট প্রস্তুত।</p><p>ইমেইল: <strong>${escape(user.email)}</strong></p>${password ? `<p>প্রাথমিক পাসওয়ার্ড: <strong>${escape(password)}</strong></p><p>লগইনের পর সেটিংস থেকে পাসওয়ার্ড পরিবর্তন করুন।</p>` : `<p><a href="${escape(recovery)}">ইমেইলে OTP নিয়ে পাসওয়ার্ড সেট করুন</a></p>`}<a style="display:inline-block;padding:12px 24px;background:#705531;color:white;border-radius:8px" href="${escape(login)}">লগইন করুন</a></div>` });
    return result.success === true;
  } catch { return false; }
}
async function createMember(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('সদস্যের তথ্য সঠিকভাবে দিন।');
  for (const key of ['name', 'email', 'gender']) if (typeof input[key] !== 'string' || !input[key].trim()) throw fail('নাম, ইমেইল ও লিঙ্গ দিন।');
  if (input.phone != null && typeof input.phone !== 'string') throw fail('সঠিক ফোন নম্বর দিন।');
  const password = crypto.randomBytes(12).toString('base64url');
  const user = new User({ name: input.name.trim(), email: input.email.trim().toLowerCase(), phone: input.phone?.trim() || undefined, gender: input.gender, password, role: 'user', isVerified: true, isEmailVerified: true });
  const biodata = input.biodata ? new Biodata(biodataPayload(input.biodata, user)) : null;
  if (biodata) user.biodataId = biodata._id;
  await user.validate();
  if (biodata) await biodata.validate();
  await user.save();
  try { if (biodata) await biodata.save(); }
  catch (error) { await User.deleteOne({ _id: user._id }); throw error; }
  const emailSent = await sendLoginEmail(user, password);
  return { user: { _id: user._id, name: user.name, email: user.email }, biodata: biodata ? { _id: biodata._id, status: biodata.status } : null, emailSent };
}
async function createMemberBiodata(id, input) {
  const user = await User.findById(id);
  if (!user) throw fail('সদস্য পাওয়া যায়নি।', 404);
  if (user.biodataId || await Biodata.exists({ userId: id })) throw fail('এই সদস্যের বায়োডাটা ইতিমধ্যে আছে।', 409);
  const biodata = new Biodata(biodataPayload(input, user));
  await biodata.save();
  try { user.biodataId = biodata._id; await user.save(); }
  catch (error) { await Biodata.deleteOne({ _id: biodata._id }); throw error; }
  return { _id: biodata._id, status: biodata.status };
}
module.exports = { createMember, createMemberBiodata, sendLoginEmail, biodataPayload };
