import { IdentityError } from './supabaseIdentity.service.js';

// Explicit opt-in enrolment, never implicit provisioning during sign-in.
// The supplied identity must come from createSupabaseIdentityVerifier, not body/JWT metadata.
export async function enrolVerifiedIdentity(pool, identity) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Serialize concurrent joins by subject. Normalized-email checks also prevent
    // claiming legacy accounts; migration of those accounts is operator reviewed.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [identity.id]);
    const existing = await client.query('SELECT id, email FROM users WHERE supabase_user_id=$1', [identity.id]);
    if (existing.rows[0]) {
      if (existing.rows[0].email.trim().toLowerCase() !== identity.email) throw new IdentityError(409, 'ACCOUNT_CONFLICT', 'Please contact support to review your YouScan account.');
      await client.query('COMMIT');
      return { id: existing.rows[0].id, created: false };
    }
    // Prevent races with another enrolment using the same normalized email.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [identity.email]);
    const email = await client.query('SELECT id FROM users WHERE lower(trim(email))=$1 LIMIT 1', [identity.email]);
    if (email.rows.length) throw new IdentityError(409, 'ACCOUNT_CONFLICT', 'Please contact support to link your existing YouScan account.');
    const result = await client.query(`INSERT INTO users
      (email,password_hash,supabase_user_id,is_verified,plan_code,credits_remaining,lifetime_parses_used,subscription_status)
      VALUES($1,NULL,$2,true,'FREE',0,0,'inactive') RETURNING id`, [identity.email, identity.id]);
    await client.query('COMMIT');
    return { id: result.rows[0].id, created: true };
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') throw new IdentityError(409, 'ACCOUNT_CONFLICT', 'Please contact support to review your YouScan account.');
    throw error;
  } finally { client.release(); }
}
