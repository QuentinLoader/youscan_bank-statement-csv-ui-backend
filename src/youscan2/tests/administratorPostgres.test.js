import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { changeAdministrator } from '../../administration/service.js';
import { getAdministratorAccess } from '../../administration/access.js';
import { createRecordExport } from '../../controllers/usage.controller.js';
import { operationsOverview } from '../../operations/adminOperations.js';

const connectionString=process.env.ADMIN_TEST_DATABASE_URL;
test('PostgreSQL migration, concurrent lockout, revocation and separate export accounting',{
  skip:!connectionString && 'Set ADMIN_TEST_DATABASE_URL to an isolated local PostgreSQL test database; CI supplies one.',
},async()=>{
  // Never allow this destructive fixture setup against a production/remote connection.
  const url=new URL(connectionString);
  assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname),'Test database must be local/isolated');
  const schema='admin_test_'+randomUUID().replaceAll('-','');
  const root=new pg.Pool({connectionString,ssl:false});
  let db;
  try {
    await root.query(`CREATE SCHEMA ${schema}`);
    db=new pg.Pool({connectionString,ssl:false,options:`-c search_path=${schema}`});
    await db.query(`CREATE TABLE users(id serial PRIMARY KEY,email text,is_verified boolean,plan_code text,
      credits_remaining integer,lifetime_parses_used integer,subscription_status text,renewal_date timestamptz,created_at timestamptz DEFAULT now());
      CREATE TABLE v2_export_ledger(id bigserial PRIMARY KEY,user_id integer REFERENCES users(id),job_id text,file_name text,
        plan_code text,credits_deducted integer,exported_at timestamptz DEFAULT now(),UNIQUE(user_id,job_id));
      CREATE TABLE usage_logs(id bigserial PRIMARY KEY,user_id integer REFERENCES users(id),action text,ip_address text,plan_code text,credits_deducted integer);
      CREATE TABLE ozow_transactions(id serial PRIMARY KEY,status text,processed_at timestamptz,created_at timestamptz DEFAULT now());
      INSERT INTO users(id,email,is_verified,plan_code,credits_remaining,lifetime_parses_used,subscription_status,renewal_date) VALUES
        (1,'bootstrap@example.test',true,'FREE',0,15,'inactive',null),
        (2,'managed@example.test',true,'MONTHLY_25',7,15,'active','2000-01-01'),
        (3,'other@example.test',true,'FREE',0,15,'inactive',null);`);
    const operations=await readFile(new URL('../../operations/schema.sql',import.meta.url),'utf8');
    const migration=await readFile(new URL('../../administration/schema.sql',import.meta.url),'utf8');
    for(let i=0;i<2;i++){await db.query(operations);await db.query(migration);}
    const env={YOUSCAN_ADMIN_EMAILS:'bootstrap@example.test'};
    await changeAdministrator({dbPool:db,env,actorId:1,targetId:2,action:'grant'});
    const res={statusCode:200,status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}};
    await createRecordExport({dbPool:db,env})({user:{userId:2},body:{jobId:'admin-job'},ip:'127.0.0.1'},res);
    assert.equal(res.body.entitlement_source,'administrator');
    assert.equal((await db.query('SELECT credits_remaining FROM users WHERE id=2')).rows[0].credits_remaining,7);
    const overview=await operationsOverview(db);
    assert.equal(overview.exports.administrator_exports,1);assert.equal(overview.exports.paid_credit_exports,0);assert.equal(overview.exports.unlimited_exports,0);assert.equal(overview.billing.confirmed_payments,0);
    await changeAdministrator({dbPool:db,env,actorId:1,targetId:2,action:'revoke'});
    await createRecordExport({dbPool:db,env})({user:{userId:2,is_admin:true},body:{jobId:'after-revocation'}},res);
    assert.equal(res.statusCode,403);assert.equal(res.body.error,'SUBSCRIPTION_EXPIRED');
    assert.equal((await db.query('SELECT count(*)::int AS count FROM administrator_privilege_audit')).rows[0].count,2);
    await db.query('INSERT INTO administrator_memberships(user_id) VALUES(2),(3)');
    const noBootstrap={YOUSCAN_ADMIN_EMAILS:'absent@example.test'};
    const result=await Promise.allSettled([2,3].map(id=>changeAdministrator({dbPool:db,env:noBootstrap,actorId:id,targetId:id,action:'revoke'})));
    assert.equal(result.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(result.find(r=>r.status==='rejected').reason.code,'FINAL_ADMIN_PROTECTED');
    const remaining=await Promise.all([2,3].map(userId=>getAdministratorAccess({userId,dbPool:db,env:noBootstrap})));
    assert.equal(remaining.filter(r=>r.is_admin).length,1);
    // Immutable usage classification survives later revocation.
    assert.equal((await db.query('SELECT entitlement_source FROM usage_logs')).rows[0].entitlement_source,'administrator');
  } finally {
    if(db)await db.end();
    await root.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await root.end();
  }
});
