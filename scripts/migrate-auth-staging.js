import 'dotenv/config';
import pool from '../src/config/db.js';

// This rehearsal script must never modify the production Railway database.
if (process.env.RAILWAY_PROJECT_ID !== '7d51152d-da81-41e9-8cb9-0b9f95913ebb' ||
    process.env.RAILWAY_ENVIRONMENT_ID !== '4d84a73b-0bbe-4abd-bbbf-6d84484b9573') {
  throw new Error('This migration is restricted to the isolated YouScan staging database');
}
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout='5s'");
  await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS supabase_user_id uuid');
  await client.query('ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL');
  await client.query('CREATE UNIQUE INDEX IF NOT EXISTS users_supabase_identity_unique ON users(supabase_user_id) WHERE supabase_user_id IS NOT NULL');
  await client.query('COMMIT');
  console.log('Additive staging identity mapping prepared; existing IDs and entitlements preserved');
} catch (error) { await client.query('ROLLBACK'); throw error; }
finally { client.release(); await pool.end(); }
