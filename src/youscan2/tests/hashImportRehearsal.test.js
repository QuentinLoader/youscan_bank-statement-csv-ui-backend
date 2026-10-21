import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import { rehearseHashImport } from '../../../scripts/rehearse-supabase-import.js';
const id = '11111111-1111-4111-8111-111111111111';
const config = { url: 'https://nysyurwlggaklhskmzma.supabase.co', adminKey: 'synthetic-server-only-key', email: 'loaderquentin+youscan-import-synthetic@gmail.com' };

test('invalid target, email or public key stops before any identity request without exposing supplied values', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; throw new Error('No network request is allowed'); };
  for (const [override, message] of [
    [{ url: 'https://unapproved.example.invalid' }, /target is not the approved/],
    [{ email: 'existing-owner@example.invalid' }, /synthetic email format/],
    [{ adminKey: ' ' }, /administrator key was empty/],
    [{ adminKey: ' sb_publishable_synthetic-do-not-disclose ' }, /publishable key supplied/],
  ]) {
    await assert.rejects(rehearseHashImport({ ...config, ...override, fetchImpl }), error => {
      assert.match(error.message, message);
      assert.ok(!error.message.includes('synthetic-do-not-disclose'));
      return true;
    });
  }
  assert.equal(calls, 0);
});
test('synthetic hash import uses the supported create API, verifies bcrypt and removes only its created identity', async () => {
  const calls = []; let hash; let attempts = 0;
  const result = await rehearseHashImport({ ...config, fetchImpl: async (url, options) => {
    calls.push({ url, method: options.method });
    const body = options.body ? JSON.parse(options.body) : null;
    if (url.endsWith('/admin/users')) { hash = body.password_hash; assert.equal(body.password, undefined); return { ok: true, status: 200, json: async () => ({ id }) }; }
    if (url.includes('/token?')) {
      attempts++;
      assert.equal(await bcrypt.compare(body.password, hash), attempts === 1);
      return attempts === 1 ? { ok: true, status: 200, json: async () => ({ access_token: 'synthetic-session', user: { id } }) } : { ok: false, status: 400 };
    }
    return { ok: true, status: 204 };
  } });
  assert.equal(result.importedPasswordWorks, true);
  assert.equal(calls.at(-1).url, `${config.url}/auth/v1/admin/users/${id}`);
  assert.equal(calls.at(-1).method, 'DELETE');
});
test('a create conflict cannot update or delete an existing identity', async () => {
  const calls = [];
  await assert.rejects(rehearseHashImport({ ...config, fetchImpl: async (url, options) => { calls.push({ url, method: options.method }); return { ok: false, status: 422 }; } }));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
});
