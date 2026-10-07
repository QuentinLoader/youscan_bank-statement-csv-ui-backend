import pool from '../config/db.js';
import { isAdminEmail } from '../utils/adminAccess.js';

// Role mutations take the exclusive transaction lock. Exports take its shared counterpart
// before locking the user, so revocation and a first export have one clear serial order.
export const ADMINISTRATOR_LOCK = 791023;
export function administratorFlags(user, managed = false, env = process.env) {
  const bootstrap = isAdminEmail(user?.email, env);
  const effective = user?.is_verified === true && (bootstrap || managed);
  return { is_admin: effective, admin_source: effective ? bootstrap ? 'bootstrap' : 'database' : null,
    admin_unlimited: effective, bootstrap_admin: bootstrap };
}
export async function getAdministratorAccess({ userId, user, dbPool = pool, env = process.env } = {}) {
  if (!user) {
    const result = await dbPool.query('SELECT id, email, is_verified FROM users WHERE id=$1 LIMIT 1', [userId]);
    user = result.rows[0];
  }
  if (!user?.is_verified || isAdminEmail(user.email, env)) return administratorFlags(user, false, env);
  const grant = await dbPool.query('SELECT user_id FROM administrator_memberships WHERE user_id=$1', [user.id || userId]);
  return administratorFlags(user, grant.rows.length > 0, env);
}
