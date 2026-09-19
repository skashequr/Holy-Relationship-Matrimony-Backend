const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');
const id = '111111111111111111111111';
const other = '222222222222222222222222';
const convId = '333333333333333333333333';
function load(relative, mocks) {
  const filename = path.resolve(__dirname, '..', relative);
  const native = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, require: key => mocks[key] || native(key), process, console, Date });
  return module.exports;
}
function query(data) { return { populate() { return this; }, select() { return this; }, sort() { return this; }, skip() { return this; }, limit() { return this; }, then(resolve, reject) { return Promise.resolve(data).then(resolve, reject); } }; }
function response() { return { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } }; }
function route(router, path, method) { return router.stack.find(l => l.route?.path === path && l.route.methods[method]).route.stack.at(-1).handle; }

test('message route rejects invalid text and IDs before touching storage', async () => {
  const router = load('src/routes/message.js', { '../models/Conversation': { findById() { assert.fail('invalid input reached storage'); } } });
  for (const body of [{ conversationId: convId, text: {} }, { conversationId: convId, text: ' '.repeat(10) }, { conversationId: convId, text: 'a'.repeat(2001) }, { conversationId: 'bad', text: 'hello' }]) {
    const res = response(); await route(router, '/', 'post')({ body }, res); assert.equal(res.code, 400);
  }
});
test('outsiders cannot fetch chat history', async () => {
  const router = load('src/routes/message.js', { '../models/Conversation': { findById() { return query({ participants: [{ _id: other }] }); } } });
  const res = response();
  await route(router, '/:conversationId', 'get')({ params: { conversationId: convId }, user: { _id: id }, query: {} }, res);
  assert.equal(res.code, 403);
});
test('history returns safe participants, a stable older cursor and marks only fetched messages read', async () => {
  let readFilter; let findFilter; let participantFields;
  const router = load('src/routes/message.js', {
    '../models/Conversation': { findById() { const q = query({ _id: convId, participants: [{ _id: id }] }); q.populate = (key, fields) => { participantFields = fields; return q; }; return q; } },
    '../models/Message': {
      find(filter) { findFilter = filter; return query([{ _id: 'b', conversationId: convId }, { _id: 'a', conversationId: convId }]); },
      async updateMany(filter) { readFilter = filter; },
    },
  });
  const res = response();
  await route(router, '/:conversationId', 'get')({ params: { conversationId: convId }, user: { _id: id }, query: { before: other, limit: 1 } }, res);
  assert.equal(res.code, 200); assert.equal(res.body.pagination.hasMore, true);
  assert.equal(res.body.messages.length, 1); assert.equal(readFilter._id.$in[0], 'b');
  assert.equal(findFilter._id.$lt, other); assert.equal(participantFields, 'name gender profilePicture');
});
test('successful send reaches both participants as well as the conversation room', async () => {
  let rooms;
  const participants = [{ _id: id, isPremium: true }, { _id: other, isActive: true }];
  const router = load('src/routes/message.js', {
    '../models/Conversation': { findById() { return query({ participants }); }, async findByIdAndUpdate() {} },
    '../models/Message': { async create(data) { return { ...data, _id: 'message' }; } },
  });
  const res = response();
  await route(router, '/', 'post')({ user: participants[0], body: { conversationId: convId, text: ' hello ' }, app: { get() { return { to(value) { rooms = value; return { emit() {} }; } }; } } }, res);
  assert.equal(res.code, 201); assert.equal(res.body.message.text, 'hello');
  assert.equal(rooms.join(','), [convId, id, other].join(','));
});
test('socket membership is checked and spoofed typing identities are never relayed', async () => {
  let connected; let membership = false; const joined = []; const emitted = []; const events = {};
  const io = { use() {}, on(event, fn) { connected = fn; } };
  const { setupMessageSocket } = load('src/services/messageSocket.js', {
    '../models/User': { findById() { return query({ isActive: true }); } },
    '../models/Conversation': { async exists(filter) { assert.equal(filter.participants, id); return membership; } },
  });
  setupMessageSocket(io);
  connected({ userId: id, join(room) { joined.push(room); }, leave() {}, on(event, fn) { events[event] = fn; }, to(room) { return { emit(event, payload) { emitted.push({ room, event, payload }); } }; } });
  await events.joinConversation(convId); assert.equal(joined.length, 1);
  await events.typing({ conversationId: convId, userId: other }); assert.equal(emitted.length, 0);
  membership = true;
  await events.joinConversation(convId); assert.equal(joined[1], convId);
  await events.typing({ conversationId: convId, userId: other });
  assert.equal(emitted[0].payload.userId, id); assert.equal(emitted[0].payload.conversationId, convId);
  await events.typing(null);
  assert.equal(events.messageRead, undefined);
});
