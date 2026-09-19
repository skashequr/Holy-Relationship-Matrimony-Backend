const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

function load(file, mocks) {
  const filename = path.resolve(__dirname, '../src/routes', file);
  const nativeRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, require: id => mocks[id] || nativeRequire(id), Date, console });
  return module.exports;
}
function response() { return { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } }; }
const fail = error => { throw error; };
const auth = { protect() {}, adminOnly() {} };
const { counselingTypes } = require('../src/models/CounselingBooking');

test('all eight counseling types accept future booking requests; client cannot set status or owner', async () => {
  const saved = [];
  const router = load('counseling.js', { '../middleware/auth': auth, '../models/CounselingBooking': {
    counselingTypes, CounselingBooking: { async create(data) { saved.push(data); return data; } },
  } });
  const handler = router.stack.find(l => l.route?.path === '/book').route.stack.at(-1).handle;
  for (const type of counselingTypes) {
    const res = response();
    await handler({ user: { _id: 'owner' }, body: { counselingType: type.value, name: 'Member', phone: '01712345678', preferredDate: '2099-01-01', preferredTime: '14:30', userId: 'other', status: 'confirmed' } }, res, fail);
    assert.equal(res.code, 201);
    assert.equal(saved.at(-1).userId, 'owner');
    assert.equal(saved.at(-1).status, undefined);
  }
  assert.equal(saved.length, 8);
});

test('invalid type, past date, impossible calendar date and malformed fields never create bookings', async () => {
  const router = load('counseling.js', { '../middleware/auth': auth, '../models/CounselingBooking': {
    counselingTypes, CounselingBooking: { create() { assert.fail('must not save'); } },
  } });
  const handler = router.stack.find(l => l.route?.path === '/book').route.stack.at(-1).handle;
  for (const change of [{ counselingType: 'unknown' }, { preferredDate: '2000-01-01' }, { preferredDate: '2099-02-31' }, { name: {} }, { phone: '' }, { preferredTime: '24:30' }]) {
    const res = response();
    await handler({ user: { _id: 'owner' }, body: { counselingType: 'family', name: 'Member', phone: '01712345678', preferredDate: '2099-01-01', preferredTime: '14:30', ...change } }, res, fail);
    assert.equal(res.code, 400);
  }
});

test('booking history is scoped to authenticated member and administration requires admin middleware', async () => {
  let filter;
  const router = load('counseling.js', { '../middleware/auth': auth, '../models/CounselingBooking': {
    counselingTypes, CounselingBooking: { find(f) { filter = f; return { sort: async () => [] }; } },
  } });
  await router.stack.find(l => l.route?.path === '/my-bookings').route.stack.at(-1).handle({ user: { _id: 'owner' } }, response(), fail);
  assert.equal(filter.userId, 'owner');
  for (const layer of router.stack.filter(l => l.route?.path.startsWith('/admin/'))) assert.equal(layer.route.stack[0].handle, auth.adminOnly);
});

test('selfie submission is private and pending, never grants verification, and cleans temporary upload', async () => {
  let update; let removed = false;
  const { submit, router } = load('faceVerification.js', {
    '../middleware/auth': auth,
    fs: { promises: { readFile: async () => Buffer.from([255, 216, 255, 217]), unlink: async () => { removed = true; } } },
    '../models/User': { async findOneAndUpdate(filter, data) { update = data; assert.equal(filter.faceVerificationStatus.$ne, 'pending'); return {}; } },
  });
  const res = response();
  await submit({ user: { _id: 'owner' }, file: { path: 'test-photo' } }, res, fail);
  assert.equal(res.code, 200);
  assert.equal(update.faceVerificationStatus, 'pending');
  assert.equal(update.isFaceVerified, undefined);
  assert.equal(update.verificationBadge, undefined);
  assert.equal(removed, true);
  assert.equal(router.stack[0].handle, auth.protect);
  assert.equal(router.stack[1].handle, auth.adminOnly);
  const User = require('../src/models/User');
  assert.equal(User.schema.path('faceVerificationImage').options.select, false);
});

test('review approves only pending requests and deletes selfie evidence after a decision', async () => {
  let update;
  const { router } = load('faceVerification.js', {
    '../middleware/auth': auth,
    '../models/User': { async findOneAndUpdate(filter, data) { assert.equal(filter.faceVerificationStatus, 'pending'); update = data; return {}; } },
  });
  const handler = router.stack.find(l => l.route?.path === '/:id' && l.route.methods.patch).route.stack.at(-1).handle;
  for (const status of ['approved', 'rejected']) {
    await handler({ params: { id: 'owner' }, body: { status } }, response(), fail);
    assert.equal(update.$set.isFaceVerified, status === 'approved');
    assert.equal(update.$unset.faceVerificationImage, 1);
    assert.equal(update.$set.verificationBadge, status === 'approved' ? true : undefined);
  }
});
