import test from 'node:test';
import assert from 'node:assert/strict';
import { applyReviewedIdentityMappings } from '../../services/identityMapping.service.js';

const mapping = { localId: 11, email: ' Person@example.invalid ', supabaseUserId: '11111111-1111-4111-8111-111111111111' };
const account = { id: 11, email: 'person@example.invalid', is_verified: true, supabase_user_id: null };
function fixture(rows = [account]) {
  const calls = [];
  return { calls, client: { query: async (sql, values) => {
    calls.push({ sql, values });
    return sql.startsWith('SELECT') ? { rows } : { rows: [{ id: values[1] }] };
  } } };
}
test('reviewed mappings only update the UUID column, retaining local ID and commercial fields', async () => {
  const f = fixture();
  assert.deepEqual(await applyReviewedIdentityMappings(f.client, [mapping]), { mapped: 1 });
  assert.match(f.calls[0].sql, /FOR UPDATE$/);
  assert.equal(f.calls[1].sql, 'UPDATE users SET supabase_user_id=$1 WHERE id=$2 RETURNING id');
  assert.deepEqual(f.calls[1].values, [mapping.supabaseUserId, 11]);
});
test('a repeated reviewed mapping is idempotent', async () => {
  assert.deepEqual(await applyReviewedIdentityMappings(fixture([{ ...account, supabase_user_id: mapping.supabaseUserId }]).client, [mapping]), { mapped: 1 });
});
test('missing, unverified, renamed and conflicting accounts reject before any write', async () => {
  for (const rows of [[], [{ ...account, is_verified: false }], [{ ...account, email: 'changed@example.invalid' }],
    [{ ...account, supabase_user_id: '22222222-2222-4222-8222-222222222222' }]]) {
    const f = fixture(rows);
    await assert.rejects(applyReviewedIdentityMappings(f.client, [mapping]));
    assert.equal(f.calls.length, 1);
  }
});
test('duplicate local IDs, subjects, emails and malformed IDs fail before querying', async () => {
  for (const manifest of [[], [mapping, mapping], [mapping, { ...mapping, localId: 12, email: 'other@example.invalid' }],
    [mapping, { ...mapping, localId: 12, supabaseUserId: '22222222-2222-4222-8222-222222222222' }],
    [{ ...mapping, localId: '11' }], [{ ...mapping, supabaseUserId: 'bad' }]]) {
    const f = fixture();
    await assert.rejects(applyReviewedIdentityMappings(f.client, manifest));
    assert.equal(f.calls.length, 0);
  }
});
test('the complete manifest is checked before updates start', async () => {
  const f = fixture();
  await assert.rejects(applyReviewedIdentityMappings(f.client, [mapping, { localId: 12, email: 'other@example.invalid', supabaseUserId: '22222222-2222-4222-8222-222222222222' }]));
  assert.equal(f.calls.length, 1);
});
