const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const User = require('../src/models/User');
const Biodata = require('../src/models/Biodata');

function setup(options = {}) {
  const calls = { users: [], biodatas: [], deletedUsers: [], deletedBiodatas: [], emails: [] };
  class TestUser extends User {
    async save() { if (options.userSaveError) throw options.userSaveError; calls.users.push(this); return this; }
    static async findById() { return options.existingUser || null; }
    static async deleteOne(filter) { calls.deletedUsers.push(filter); }
  }
  class TestBiodata extends Biodata {
    async save() { await this.validate(); if (options.biodataError) throw options.biodataError; calls.biodatas.push(this); return this; }
    static async exists() { return options.biodataExists || false; }
    static async deleteOne(filter) { calls.deletedBiodatas.push(filter); }
  }
  const mocks = { '../models/User': TestUser, '../models/Biodata': TestBiodata, './notificationService': {
    async sendEmail(mail) { calls.emails.push(mail); if (options.emailThrows) throw new Error('SMTP unavailable'); return { success: options.emailSent !== false }; },
  } };
  const filename = path.resolve(__dirname, '../src/services/adminMemberService.js');
  const nativeRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, require: id => mocks[id] || nativeRequire(id), process: { env: { FRONTEND_URL: 'https://matrimony.example,https://other.example' } }, console, Date });
  return { service: module.exports, calls, TestUser };
}
const account = { name: 'Test Member', email: ' MEMBER@example.com ', gender: 'male' };
const bio = { personal: { dateOfBirth: '1995-04-12', maritalStatus: 'single' }, education: { highestLevel: 'masters' } };

test('creates member and linked published biodata, emails unique initial password without returning it', async () => {
  const { service, calls } = setup();
  const result = await service.createMember({ ...account, biodata: { ...bio, status: 'draft', userId: 'attacker', views: 100 } });
  assert.equal(result.emailSent, true);
  assert.equal(calls.users[0].email, 'member@example.com');
  assert.equal(calls.biodatas[0].status, 'approved');
  assert.equal(calls.biodatas[0].views, 0);
  assert.equal(String(calls.users[0].biodataId), String(calls.biodatas[0]._id));
  assert.equal(String(calls.biodatas[0].userId), String(calls.users[0]._id));
  const password = calls.users[0].password;
  assert.ok(password.length >= 16);
  assert.ok(calls.emails[0].text.includes(password));
  assert.ok(calls.emails[0].html.includes('https://matrimony.example/login'));
  assert.ok(!JSON.stringify(result).includes(password));
  await service.createMember(account);
  assert.notEqual(calls.users[1].password, password);
});
test('invalid biodata is rejected before any account is saved or email sent', async () => {
  const { service, calls } = setup();
  await assert.rejects(service.createMember({ ...account, biodata: { personal: { dateOfBirth: '2020-01-01', maritalStatus: 'single' } } }));
  await assert.rejects(service.createMember({ ...account, biodata: { personal: { dateOfBirth: '1995-01-01', maritalStatus: 'invalid' } } }));
  assert.equal(calls.users.length, 0); assert.equal(calls.emails.length, 0);
});
test('rejects invalid account types and email before writes', async () => {
  const { service, calls } = setup();
  for (const input of [null, [], 'invalid']) await assert.rejects(service.createMember(input), error => error.status === 400);
  for (const change of [{ email: {} }, { name: '  ' }, { gender: 'other' }, { phone: {} }, { email: 'invalid' }]) await assert.rejects(service.createMember({ ...account, ...change }));
  assert.equal(calls.users.length, 0);
});
test('rolls back only the newly created account when biodata save fails; sends no email', async () => {
  const { service, calls } = setup({ biodataError: new Error('write failed') });
  await assert.rejects(service.createMember({ ...account, biodata: bio }), /write failed/);
  assert.equal(String(calls.deletedUsers[0]._id), String(calls.users[0]._id));
  assert.equal(calls.emails.length, 0);
});
test('email transport failure preserves account and reports failure separately', async () => {
  for (const options of [{ emailSent: false }, { emailThrows: true }]) {
    const { service, calls } = setup(options);
    const result = await service.createMember(account);
    assert.equal(result.emailSent, false); assert.equal(calls.users.length, 1); assert.equal(calls.deletedUsers.length, 0);
  }
});
test('email escapes untrusted names and resend uses OTP instructions without rotating credentials', async () => {
  const { service, calls } = setup();
  await service.sendLoginEmail({ name: '<img src=x onerror=alert(1)>', email: 'member@example.com' });
  assert.ok(calls.emails[0].html.includes('&lt;img'));
  assert.ok(!calls.emails[0].html.includes('<img'));
  assert.ok(calls.emails[0].text.includes('/forgot-password'));
  assert.equal(calls.users.length, 0);
});
test('existing member can receive a published biodata; duplicate biodata is rejected', async () => {
  const existingUser = new User(account); existingUser.save = async () => existingUser;
  const { service, calls } = setup({ existingUser });
  const result = await service.createMemberBiodata(existingUser._id, bio);
  assert.equal(result.status, 'approved'); assert.equal(String(existingUser.biodataId), String(result._id));
  await assert.rejects(service.createMemberBiodata(existingUser._id, bio), error => error.status === 409);
  assert.equal(calls.biodatas.length, 1);
});
test('existing member link failure removes only the new biodata', async () => {
  const existingUser = new User(account); existingUser.save = async () => { throw new Error('link failed'); };
  const { service, calls } = setup({ existingUser });
  await assert.rejects(service.createMemberBiodata(existingUser._id, bio), /link failed/);
  assert.equal(String(calls.deletedBiodatas[0]._id), String(calls.biodatas[0]._id));
  assert.equal(calls.deletedUsers.length, 0);
});
