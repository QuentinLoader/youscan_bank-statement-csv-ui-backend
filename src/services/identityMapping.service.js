// Operator-only primitive. The caller owns a transaction and must independently
// verify each shared identity before supplying this reviewed mapping manifest.
// This is deliberately not exposed through an HTTP route or email auto-linking.
export async function applyReviewedIdentityMappings(client, mappings) {
  if (!Array.isArray(mappings) || mappings.length === 0) throw new Error('Empty identity mapping manifest');
  const localIds = new Set();
  const subjects = new Set();
  const emails = new Set();
  const normalized = mappings.map(mapping => {
    const email = String(mapping.email || '').trim().toLowerCase();
    const subject = String(mapping.supabaseUserId || '').toLowerCase();
    if (!Number.isSafeInteger(mapping.localId) || mapping.localId <= 0 || !email.includes('@') ||
        !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(subject) ||
        localIds.has(mapping.localId) || subjects.has(subject) || emails.has(email)) {
      throw new Error('Invalid or duplicate identity mapping');
    }
    localIds.add(mapping.localId); subjects.add(subject); emails.add(email);
    return { ...mapping, email, supabaseUserId: subject };
  }).sort((a, b) => a.localId - b.localId);

  // Validate the whole manifest before changing even one row. Stable lock order
  // avoids deadlocks; the database's unique subject index handles concurrent use.
  const { rows } = await client.query(
    'SELECT id, email, is_verified, supabase_user_id FROM users WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE',
    [normalized.map(mapping => mapping.localId)],
  );
  for (const mapping of normalized) {
    const row = rows.find(user => user.id === mapping.localId);
    if (!row || !row.is_verified || String(row.email).trim().toLowerCase() !== mapping.email ||
        (row.supabase_user_id && row.supabase_user_id !== mapping.supabaseUserId)) {
      throw new Error('Identity mapping no longer matches the reviewed account');
    }
  }
  for (const mapping of normalized) {
    const result = await client.query('UPDATE users SET supabase_user_id=$1 WHERE id=$2 RETURNING id',
      [mapping.supabaseUserId, mapping.localId]);
    if (result.rows.length !== 1) throw new Error('Identity mapping update failed');
  }
  return { mapped: normalized.length };
}
