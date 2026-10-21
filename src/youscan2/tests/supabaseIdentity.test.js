import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { createSupabaseAuthenticator } from '../../services/supabaseIdentity.service.js';

const id = '11111111-1111-4111-8111-111111111111';
const env = { SUPABASE_URL: 'https://cluster.example.invalid', SUPABASE_PUBLISHABLE_KEY: 'synthetic-public-key' };
const claims = { sub: id, role: 'authenticated', aud: 'authenticated', iss: env.SUPABASE_URL + '/auth/v1', exp: 2000000000 };
const identity = { id, email: 'person@example.invalid', email_confirmed_at: '2026-01-01T00:00:00Z', user_metadata: { role: 'admin' } };
const local = { id: 42, email: identity.email, is_verified: true };
const token = (overrides = {}) => jwt.sign({ ...claims, ...overrides }, 'synthetic-signature-only');
function fixture({ remote = identity, status = 200, rows = [local], failFetch = false, failDb = false } = {}) {
  const calls = [];
  return { calls, authenticate: createSupabaseAuthenticator({ env, now: () => 1800000000000,
    fetchImpl: async (url, options) => { calls.push({ url, options }); if (failFetch) throw Error('network'); return { status, ok: status === 200, json: async () => remote }; },
    dbPool: { query: async (sql, params) => { if (failDb) throw Error('db'); calls.push({ sql, params }); return { rows }; } },
  }) };
}
test('verified cluster subject maps to the existing local ID and ignores shared admin metadata', async () => {
  const f = fixture();
  assert.deepEqual(await f.authenticate(token()), { userId: 42, supabaseUserId: id });
  assert.equal(f.calls[0].url, env.SUPABASE_URL + '/auth/v1/user');
  assert.deepEqual(f.calls[1].params, [id]);
  assert.ok(!f.calls[1].sql.includes('INSERT'));
});
test('invalid signature response cannot be replaced by decoded JWT metadata or a local email match', async () => {
  const f = fixture({ status: 401 });
  await assert.rejects(f.authenticate(token()), e => e.status === 401);
  assert.equal(f.calls.length, 1);
});
test('wrong issuer/audience, expired tokens and service-role tokens fail before network or database access', async () => {
  for (const patch of [{ iss: 'https://other.supabase.co/auth/v1' }, { aud: 'other-app' }, { exp: 1700000000 }, { role: 'service_role' }, { sub: '42' }, { nbf: 1900000000 }]) {
    const f = fixture();
    await assert.rejects(f.authenticate(token(patch)), e => e.status === 401);
    assert.equal(f.calls.length, 0);
  }
});
test('shared users without an explicit app mapping cannot create accounts or receive allowance', async () => {
  const f = fixture({ rows: [] });
  await assert.rejects(f.authenticate(token()), e => e.status === 403 && e.code === 'ACCOUNT_NOT_LINKED');
  assert.equal(f.calls.length, 2);
});
test('unverified, banned, mismatched subjects and changed account emails cannot gain app access', async () => {
  for (const remote of [{ ...identity, email_confirmed_at: null }, { ...identity, banned_until: '2040-01-01' }, { ...identity, factors: [{ status: 'verified' }] }, { ...identity, id: '22222222-2222-4222-8222-222222222222' }, { ...identity, email: 'other@example.invalid' }]) {
    await assert.rejects(fixture({ remote }).authenticate(token()), e => [401, 403].includes(e.status));
  }
});
test('identity provider/database outages return temporary failures without legacy-token fallback', async () => {
  for (const options of [{ failFetch: true }, { status: 500 }, { failDb: true }]) {
    await assert.rejects(fixture(options).authenticate(token()), e => e.status === 503);
  }
});
test('missing or invalid shared-auth configuration fails closed', async () => {
  const authenticate = createSupabaseAuthenticator({ env: {}, dbPool: { query: () => assert.fail('must not query') } });
  await assert.rejects(authenticate(token()), e => e.status === 503);
});
