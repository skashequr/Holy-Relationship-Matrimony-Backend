const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function load(relative, mocks) {
  const filename = path.resolve(__dirname, '..', relative);
  const nativeRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    require: id => Object.hasOwn(mocks, id) ? mocks[id] : nativeRequire(id),
    module, exports: module.exports, console, URLSearchParams, process: { env: {} },
  }, { filename });
  return module.exports;
}
function query(value) {
  return { select() { return this; }, populate() { return this; }, sort() { return this; }, skip() { return this; }, limit() { return this; }, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } };
}
async function invoke(router, route, request) {
  const layer = router.stack.find(item => item.route?.path === route);
  assert.ok(layer, `Route ${route} exists`);
  const handler = layer.route.stack.at(-1).handle;
  const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(data) { this.data = data; return this; } };
  await handler(request, response);
  return response;
}
const auth = { protect() {}, optionalAuth() {} };

test('dashboard counts only the authenticated user and received unread messages', async () => {
  const calls = {};
  const service = load('src/services/dashboardService.js', {
    '../models/Biodata': { findOne(filter) { calls.biodata = filter; return query({ views: 17, status: 'pending' }); } },
    '../models/Interest': { countDocuments(filter) { calls.interest = filter; return 2; } },
    '../models/Notification': { countDocuments(filter) { calls.notification = filter; return 3; } },
    '../models/Conversation': { find(filter) { calls.conversation = filter; return query([{ _id: 'own-conversation' }]); } },
    '../models/Message': { countDocuments(filter) { calls.message = filter; return 4; } },
  });
  const result = await service.getDashboardSummary({ _id: 'member-a', shortlistedProfiles: ['b', 'c'] });
  assert.equal(result.stats.profileViews, 17);
  assert.equal(result.stats.shortlisted, 2);
  assert.equal(calls.interest.receiverId, 'member-a');
  assert.equal(calls.interest.status, 'pending');
  assert.equal(calls.biodata.userId, 'member-a');
  assert.equal(calls.notification.userId, 'member-a');
  assert.equal(calls.conversation.participants, 'member-a');
  assert.equal(calls.message.senderId.$ne, 'member-a');
  assert.equal(calls.message.conversationId.$in.join(','), 'own-conversation');
  assert.equal(calls.message.isRead, false);
});

test('new members receive a real empty summary without invented activity', async () => {
  const service = load('src/services/dashboardService.js', {
    '../models/Biodata': { findOne: () => query(null) },
    '../models/Interest': { countDocuments: () => 0 },
    '../models/Notification': { countDocuments: () => 0 },
    '../models/Conversation': { find: () => query([]) },
    '../models/Message': { countDocuments: () => 0 },
  });
  const result = await service.getDashboardSummary({ _id: 'new-member' });
  assert.equal(result.biodata, null);
  assert.ok(Object.values(result.stats).every(value => value === 0));
});

function searchRouter(calls) {
  return load('src/routes/search.js', {
    '../models/User': { find(filter) { calls.owner = filter; return query([{ _id: 'allowed-owner' }]); } },
    '../models/Biodata': { find(filter) { calls.biodata = filter; return query([]); }, countDocuments: () => 0 },
    '../middleware/auth': auth,
    '../middleware/rateLimiter': { searchLimiter() {} },
    '../services/matchService': { sanitizeBiodata: value => value },
  });
}
for (const params of [{}, { biodataNumber: 'HMM123' }]) {
  test(`guest search hides banned, inactive and married profiles (${JSON.stringify(params)})`, async () => {
    const calls = {};
    const response = await invoke(searchRouter(calls), '/', { query: params });
    assert.equal(response.statusCode, 200);
    assert.equal(calls.owner.isActive, true);
    assert.equal(calls.owner.isBanned, false);
    assert.equal(calls.biodata.userId.$in[0], 'allowed-owner');
    assert.equal(calls.biodata.isMarried.$ne, true);
  });
}
for (const params of [{ ageMin: '17' }, { ageMax: '101' }, { ageMin: 'hello' }, { ageMin: '22.5' }, { ageMin: '35', ageMax: '25' }]) {
  test(`invalid age filters return 400 (${JSON.stringify(params)})`, async () => {
    const response = await invoke(searchRouter({}), '/', { query: params });
    assert.equal(response.statusCode, 400);
  });
}
test('valid age filters reach the database query', async () => {
  const calls = {};
  const response = await invoke(searchRouter(calls), '/', { query: { ageMin: '25', ageMax: '35' } });
  assert.equal(response.statusCode, 200);
  assert.equal(calls.biodata['personal.age'].$gte, 25);
  assert.equal(calls.biodata['personal.age'].$lte, 35);
});

test('new profiles explicitly exclude married biodatas', async () => {
  let filter;
  const router = load('src/routes/match.js', {
    '../models/User': { find: () => query([{ _id: 'candidate' }]), findById: () => ({ _id: 'member' }) },
    '../models/Biodata': { find(value) { filter = value; return query([]); } },
    '../middleware/auth': auth,
    '../services/dashboardService': {},
    '../services/matchService': { sanitizeBiodata: value => value },
  });
  const response = await invoke(router, '/new-profiles', { user: { _id: 'member', gender: 'male' } });
  assert.equal(response.statusCode, 200);
  assert.equal(filter.isMarried.$ne, true);
});

test('completeness includes actual visibility and review state', async () => {
  const router = load('src/routes/match.js', {
    '../models/User': {},
    '../models/Biodata': { findOne: () => ({ _id: 'bio', status: 'rejected', isActive: false, isMarried: true }) },
    '../middleware/auth': auth,
    '../services/dashboardService': {},
    '../services/matchService': { calculateProfileCompleteness: () => ({ percentage: 80 }) },
  });
  const response = await invoke(router, '/profile-completeness', { user: { _id: 'member' } });
  assert.equal(response.data.biodata.status, 'rejected');
  assert.equal(response.data.biodata.isMarried, true);
  assert.equal(response.data.biodata.isActive, false);
});

function biodataRouter(models, service = {}) {
  return load('src/routes/biodata.js', {
    '../models/User': models.User || {},
    '../models/Biodata': models.Biodata || {},
    '../middleware/auth': auth,
    '../middleware/upload': { single: () => () => {} },
    '../services/notificationService': { createNotification: async () => {}, sendBiodataStatusEmail: async () => {} },
    '../services/matchService': { sanitizeBiodata: value => value, ...service },
    cloudinary: { v2: { config() {} } },
  });
}

test('suggested route is not swallowed by the dynamic id route and sanitizes every result', async () => {
  let sanitized = 0;
  const router = biodataRouter({
    User: { find: () => query([{ _id: 'candidate' }]) },
    Biodata: { findOne: () => null, find: () => query([{ _id: 'sample', contact: { phone: 'private' } }]) },
  }, { sanitizeBiodata(value, viewer) { sanitized++; assert.equal(viewer._id, 'viewer'); return { _id: value._id }; } });
  const paths = router.stack.filter(item => item.route).map(item => item.route.path);
  assert.ok(paths.indexOf('/suggested') < paths.indexOf('/:id'));
  const response = await invoke(router, '/suggested', { user: { _id: 'viewer', gender: 'male' } });
  assert.equal(response.statusCode, 200);
  assert.equal(sanitized, 1);
  assert.equal(response.data.profiles[0].contact, undefined);
});

for (const ownProfile of [false, true]) {
  test(`profile views use the biodata id and exclude self views (owner=${ownProfile})`, async () => {
    let updated;
    const biodata = { _id: 'biodata-id', status: 'approved', userId: { _id: 'owner-id', gender: 'female' } };
    const viewer = { _id: ownProfile ? 'owner-id' : 'viewer-id', gender: ownProfile ? 'female' : 'male', hasUnlockedContact: () => false };
    const router = biodataRouter({
      User: { findById: async () => viewer },
      Biodata: {
        findById: () => ({ populate: () => Promise.resolve(null) }),
        findOne: () => query(biodata),
        findByIdAndUpdate: async id => { updated = id; },
      },
    });
    const response = await invoke(router, '/:id', { params: { id: 'owner-id' }, user: viewer });
    assert.equal(response.statusCode, 200);
    assert.equal(updated, ownProfile ? undefined : 'biodata-id');
  });
}
