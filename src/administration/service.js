import { ADMINISTRATOR_LOCK, administratorFlags, getAdministratorAccess } from './access.js';
import { configuredAdminEmails, isAdminEmail } from '../utils/adminAccess.js';

export class AdministratorError extends Error {
  constructor(code, status = 409) { super(code); this.code = code; this.status = status; }
}
export async function changeAdministrator({ dbPool, env = process.env, actorId, targetId, action }) {
  if (!/^[1-9]\d{0,18}$/.test(String(targetId)) || !['grant','revoke'].includes(action)) throw new AdministratorError('INVALID_PRIVILEGE_CHANGE',400);
  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [ADMINISTRATOR_LOCK]);
    // Recheck the actor inside the role-change transaction, never trust JWT/browser role claims.
    if (!(await getAdministratorAccess({userId:actorId,dbPool:client,env})).is_admin) throw new AdministratorError('FORBIDDEN',403);
    const result = await client.query('SELECT id,email,is_verified FROM users WHERE id=$1 FOR UPDATE', [targetId]);
    const target = result.rows[0];
    if (!target) throw new AdministratorError('USER_NOT_FOUND',404);
    if (isAdminEmail(target.email,env)) throw new AdministratorError('BOOTSTRAP_ADMIN_PROTECTED');
    if (action === 'grant' && !target.is_verified) throw new AdministratorError('USER_NOT_VERIFIED');
    const existing = await client.query('SELECT user_id FROM administrator_memberships WHERE user_id=$1', [target.id]);
    if ((action==='grant') === Boolean(existing.rows.length)) {
      await client.query('COMMIT');return { changed:false, ...administratorFlags(target,Boolean(existing.rows.length),env) };
    }
    if (action === 'revoke') {
      const count = await client.query(`SELECT count(*)::int AS count FROM users u WHERE u.is_verified=true AND
        (lower(btrim(u.email))=ANY($1::text[]) OR EXISTS(SELECT 1 FROM administrator_memberships a WHERE a.user_id=u.id))`, [[...configuredAdminEmails(env)]]);
      if (target.is_verified && count.rows[0].count <= 1) throw new AdministratorError('FINAL_ADMIN_PROTECTED');
      await client.query('DELETE FROM administrator_memberships WHERE user_id=$1',[target.id]);
    } else {
      await client.query('INSERT INTO administrator_memberships(user_id,granted_by) VALUES($1,$2)',[target.id,actorId]);
    }
    await client.query('INSERT INTO administrator_privilege_audit(actor_id,target_id,action) VALUES($1,$2,$3)',[String(actorId),String(target.id),action]);
    await client.query('COMMIT');
    return { changed:true, ...administratorFlags(target,action==='grant',env) };
  } catch (error) { await client.query('ROLLBACK');throw error; }
  finally { client.release(); }
}
export async function listAdministratorUsers(dbPool, env) {
  const result=await dbPool.query(`SELECT u.id,u.email,u.is_verified,u.plan_code,
    a.user_id IS NOT NULL AS managed_admin FROM users u
    LEFT JOIN administrator_memberships a ON a.user_id=u.id
    WHERE u.email IS NOT NULL AND btrim(u.email)<>'' ORDER BY lower(u.email),u.id`);
  const count=result.rows.filter(user=>administratorFlags(user,user.managed_admin,env).is_admin).length;
  return { users:result.rows.map(user=>({ id:user.id,email:user.email,is_verified:user.is_verified,plan_code:user.plan_code,
    ...administratorFlags(user,user.managed_admin,env), has_admin_grant:user.managed_admin,
    can_grant:user.is_verified && !user.managed_admin && !isAdminEmail(user.email,env),
    can_revoke:user.managed_admin && !isAdminEmail(user.email,env) && (!user.is_verified || count>1) })), effective_admin_count:count };
}
