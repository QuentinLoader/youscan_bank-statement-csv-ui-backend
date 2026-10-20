import test from 'node:test';
import assert from 'node:assert/strict';
import { enrolVerifiedIdentity } from '../../services/sharedEnrolment.service.js';
const identity = { id: '11111111-1111-4111-8111-111111111111', email: 'new@example.invalid' };
function fixture({ linked = [], legacy = [], insertError } = {}) {
  const calls = [];
  const client = { query: async (sql, values) => {
    calls.push({ sql, values });
    if (sql.includes('WHERE supabase_user_id')) return { rows: linked };
    if (sql.includes('WHERE lower')) return { rows: legacy };
    if (sql.startsWith('INSERT')) { if (insertError) throw insertError; return { rows: [{ id: 23 }] }; }
    return { rows: [] };
  }, release: () => calls.push({ sql: 'RELEASE' }) };
  return { calls, pool: { connect: async () => client } };
}
test('explicit verified enrolment creates only a free account, with no local password or admin grant', async () => {
  const f = fixture();
  assert.deepEqual(await enrolVerifiedIdentity(f.pool, identity), { id: 23, created: true });
  const insert = f.calls.find(call => call.sql.startsWith('INSERT'));
  assert.deepEqual(insert.values, [identity.email, identity.id]);
  assert.match(insert.sql, /NULL,\$2,true,'FREE',0,0,'inactive'/);
  assert.equal(f.calls.at(-2).sql, 'COMMIT');
});
test('repeat join preserves an existing account and never resets allowance', async () => {
  const f = fixture({ linked: [{ id: 15, email: identity.email }] });
  assert.deepEqual(await enrolVerifiedIdentity(f.pool, identity), { id: 15, created: false });
  assert.equal(f.calls.some(call => /INSERT|UPDATE/.test(call.sql)), false);
});
test('existing legacy email, mismatched identity email and uniqueness races do not claim or overwrite accounts', async () => {
  for (const options of [{ legacy: [{ id: 15 }] }, { linked: [{ id: 15, email: 'other@example.invalid' }] },
    { insertError: { code: '23505' } }]) {
    const f = fixture(options);
    await assert.rejects(enrolVerifiedIdentity(f.pool, identity), error => error.status === 409);
    assert.equal(f.calls.at(-2).sql, 'ROLLBACK');
    assert.equal(f.calls.some(call => call.sql.startsWith('UPDATE')), false);
  }
});
