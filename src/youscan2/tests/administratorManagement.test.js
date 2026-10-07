import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { administratorFlags, getAdministratorAccess } from '../../administration/access.js';
import { changeAdministrator, listAdministratorUsers } from '../../administration/service.js';
import { createPlanAccess } from '../../middleware/credits.middleware.js';
import { createRecordExport } from '../../controllers/usage.controller.js';
import { getBillingStatusForUser } from '../../services/billingStatus.service.js';
import { createAdminRouter } from '../../routes/admin.js';

const env = { YOUSCAN_ADMIN_EMAILS:'bootstrap@example.test' };
const user = (id, overrides={}) => ({id,email:`user${id}@example.test`,is_verified:true,plan_code:'FREE',
  lifetime_parses_used:15,credits_remaining:0,subscription_status:'inactive',renewal_date:'2000-01-01',...overrides});

// Synthetic transactional store. The mutex models PostgreSQL's exclusive transaction lock;
// optional PostgreSQL integration tests separately verify the actual lock and migration.
function store(initialUsers, initialGrants=[]) {
  const users=new Map(initialUsers.map(u=>[String(u.id),structuredClone(u)]));
  let grants=new Set(initialGrants.map(String));
  let audit=[]; const ledger=new Map();const usage=[];const calls=[];
  let mutex=Promise.resolve();
  const query=async(sql,args=[])=>{
    const text=String(sql).replace(/\s+/g,' ').trim();calls.push({text,args});
    if (text.startsWith('SELECT user_id FROM administrator_memberships')) return {rows:grants.has(String(args[0]))?[{user_id:args[0]}]:[]};
    if (text.includes('LEFT JOIN administrator_memberships')) return {rows:[...users.values()].map(u=>({...u,managed_admin:grants.has(String(u.id))}))};
    if (text.startsWith('SELECT count(*)::int AS count FROM users')) return {rows:[{count:[...users.values()].filter(u=>u.is_verified&&(args[0].includes(u.email)||grants.has(String(u.id)))).length}]};
    if (text.startsWith('SELECT')&&text.includes('FROM users')) return {rows:users.has(String(args[0]))?[users.get(String(args[0]))]:[]};
    if (text.startsWith('INSERT INTO administrator_memberships')) grants.add(String(args[0]));
    else if (text.startsWith('DELETE FROM administrator_memberships')) grants.delete(String(args[0]));
    else if (text.startsWith('INSERT INTO administrator_privilege_audit')) audit.push({actor_id:args[0],target_id:args[1],action:args[2]});
    else if (text.startsWith('SELECT')&&text.includes('FROM administrator_privilege_audit')) return {rows:audit};
    else if (text.startsWith('SELECT')&&text.includes('FROM v2_export_ledger')) return {rows:ledger.has(args[1])?[ledger.get(args[1])]:[]};
    else if (text.startsWith('INSERT INTO v2_export_ledger')) ledger.set(args[1],{plan_code:args[3],credits_deducted:args[4],entitlement_source:args[5]});
    else if (text.startsWith('INSERT INTO usage_logs')) usage.push({credits_deducted:args[4],entitlement_source:args[5]});
    else if (text.startsWith('UPDATE users')) {
      const u=users.get(String(args[0]));
      if (text.includes('lifetime_parses_used')) {
        if(u.lifetime_parses_used>=15)return {rowCount:0,rows:[]};u.lifetime_parses_used++;
      } else {if(u.credits_remaining<=0)return {rowCount:0,rows:[]};u.credits_remaining--;}
      return {rows:[u],rowCount:1};
    }
    else if (!['BEGIN','COMMIT','ROLLBACK'].includes(text)) throw Error(`Unexpected query: ${text}`);
    return {rows:[],rowCount:1};
  };
  return {users,calls,ledger,usage,get audit(){return audit;},query,
    connect:async()=>{
      let unlock;let snapshot;
      return {release:()=>unlock?.(),query:async(sql,args=[])=>{
        if(sql.includes('pg_advisory_xact_lock')) {
          const prior=mutex;mutex=new Promise(resolve=>{unlock=resolve;});await prior;
          snapshot={grants:new Set(grants),audit:[...audit]};return {rows:[]};
        }
        if(sql==='ROLLBACK'&&snapshot){grants=snapshot.grants;audit=snapshot.audit;}
        return query(sql,args);
      }};
    }};
}
function response() {return {statusCode:200,status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}};}
async function access(db,id=2) {const res=response();let next=false;await createPlanAccess({dbPool:db,env})({user:{userId:id,is_admin:true}},res,()=>{next=true;});return {res,next};}
async function exportJob(db,id=2,jobId='synthetic-job') {const res=response();await createRecordExport({dbPool:db,env})({user:{userId:id,is_admin:true},body:{jobId},ip:'127.0.0.1'},res);return res;}

test('only verified bootstrap/database members receive effective admin privileges',async()=>{
  assert.equal(administratorFlags(user(1,{email:' BOOTSTRAP@EXAMPLE.TEST '}),false,env).admin_source,'bootstrap');
  for(const managed of [true,false])assert.equal(administratorFlags(user(1,{is_verified:false,email:'bootstrap@example.test'}),managed,env).is_admin,false);
  const db=store([user(2)],[2]);assert.equal((await getAdministratorAccess({userId:2,dbPool:db,env})).admin_source,'database');
  assert.equal((await getAdministratorAccess({userId:999,dbPool:db,env})).is_admin,false);
});
test('bootstrap authority survives an unavailable grant store; other users fail closed',async()=>{
  const broken={query:async()=>{throw Error('grant store unavailable');}};
  assert.equal((await getAdministratorAccess({user:user(1,{email:'bootstrap@example.test'}),dbPool:broken,env})).is_admin,true);
  await assert.rejects(getAdministratorAccess({user:user(2),dbPool:broken,env}));
});
test('grants/revocations audit actor and target, preserve the stored plan, and are idempotent',async()=>{
  const db=store([user(1,{email:'bootstrap@example.test'}),user(2,{plan_code:'PAYG_10',credits_remaining:7})]);
  const before=structuredClone(db.users.get('2'));
  const change=action=>changeAdministrator({dbPool:db,env,actorId:1,targetId:2,action});
  assert.equal((await change('grant')).is_admin,true);assert.equal((await change('grant')).changed,false);
  assert.equal((await change('revoke')).is_admin,false);assert.equal((await change('revoke')).changed,false);
  assert.deepEqual(db.users.get('2'),before);assert.deepEqual(db.audit,[{actor_id:'1',target_id:'2',action:'grant'},{actor_id:'1',target_id:'2',action:'revoke'}]);
});
test('unverified, bootstrap, invalid and unauthorized privilege changes are rejected without audit writes',async()=>{
  const db=store([user(1,{email:'bootstrap@example.test'}),user(2,{is_verified:false}),user(3)]);
  for(const [actorId,targetId,action,code] of [[1,2,'grant','USER_NOT_VERIFIED'],[1,1,'revoke','BOOTSTRAP_ADMIN_PROTECTED'],[1,1,'grant','BOOTSTRAP_ADMIN_PROTECTED'],[3,2,'grant','FORBIDDEN'],[1,999,'grant','USER_NOT_FOUND'],[1,'2; DROP TABLE users','grant','INVALID_PRIVILEGE_CHANGE'],[1,2,'delete','INVALID_PRIVILEGE_CHANGE']]) {
    await assert.rejects(changeAdministrator({dbPool:db,env,actorId,targetId,action}),e=>e.code===code);
  }assert.equal(db.audit.length,0);
});
test('the final verified administrator cannot revoke themselves',async()=>{
  const db=store([user(2)],[2]);
  await assert.rejects(changeAdministrator({dbPool:db,env,actorId:2,targetId:2,action:'revoke'}),e=>e.code==='FINAL_ADMIN_PROTECTED');
  assert.equal((await getAdministratorAccess({userId:2,dbPool:db,env})).is_admin,true);
});
test('concurrent self-revocations leave one administrator; concurrent actor revocation prevents a stale grant',async()=>{
  const db=store([user(2),user(3),user(4)],[2,3]);
  const outcomes=await Promise.allSettled([2,3].map(id=>changeAdministrator({dbPool:db,env,actorId:id,targetId:id,action:'revoke'})));
  assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
  assert.equal((await listAdministratorUsers(db,env)).effective_admin_count,1);
  assert.equal(db.audit.length,1);
  const db2=store([user(1,{email:'bootstrap@example.test'}),user(2),user(3)],[2]);
  const results=await Promise.allSettled([
    changeAdministrator({dbPool:db2,env,actorId:1,targetId:2,action:'revoke'}),
    changeAdministrator({dbPool:db2,env,actorId:2,targetId:3,action:'grant'}),
  ]);
  assert.equal(results[1].reason.code,'FORBIDDEN');assert.equal(db2.audit.length,1);
});
test('audit failure rolls back the membership change',async()=>{
  const db=store([user(1,{email:'bootstrap@example.test'}),user(2)]);
  const connect=db.connect;db.connect=async()=>{const c=await connect();const query=c.query;c.query=(sql,args)=>sql.startsWith('INSERT INTO administrator_privilege_audit')?Promise.reject(Error('audit unavailable')):query(sql,args);return c;};
  await assert.rejects(changeAdministrator({dbPool:db,env,actorId:1,targetId:2,action:'grant'}));
  assert.equal((await getAdministratorAccess({userId:2,dbPool:db,env})).is_admin,false);
});
for(const plan_code of ['FREE','PAYG_10','MONTHLY_25','PRO_YEAR_UNLIMITED']) {
  test(`${plan_code} admins bypass exhaustion/expiry with no mutation and separate usage`,async()=>{
    const db=store([user(2,{plan_code})],[2]);const before=structuredClone(db.users.get('2'));
    assert.equal((await access(db)).next,true);
    const status=await getBillingStatusForUser({userId:2,dbPool:db,env});assert.equal(status.admin_unlimited,true);assert.equal(status.plan_code,plan_code);
    const result=await exportJob(db);assert.equal(result.statusCode,200);assert.equal(result.body.credits_deducted,0);assert.equal(result.body.allowance_consumed,false);
    assert.equal(result.body.entitlement_source,'administrator');assert.equal(result.body.plan_code,plan_code);
    assert.deepEqual(db.users.get('2'),before);assert.equal(db.usage[0].entitlement_source,'administrator');
    assert.equal((await exportJob(db)).body.first_export,false);assert.equal(db.usage.length,1);
  });
}
test('revocation immediately restores expired-plan enforcement even with a stale admin JWT claim',async()=>{
  const db=store([user(1,{email:'bootstrap@example.test'}),user(2,{plan_code:'MONTHLY_25',credits_remaining:9})],[2]);
  await exportJob(db);await changeAdministrator({dbPool:db,env,actorId:1,targetId:2,action:'revoke'});
  const check=await access(db);assert.equal(check.next,false);assert.equal(check.res.body.code,'SUBSCRIPTION_EXPIRED');
  assert.equal((await exportJob(db,2,'new-job')).body.error,'SUBSCRIPTION_EXPIRED');
  assert.equal((await exportJob(db)).body.first_export,false);assert.equal(db.users.get('2').credits_remaining,9);
  assert.equal(db.ledger.get('synthetic-job').entitlement_source,'administrator');
});
test('revocation restores FREE/PAYG credit consumption without granting a new allowance',async()=>{
  for(const plan_code of ['FREE','PAYG_10']) {
    const db=store([user(1,{email:'bootstrap@example.test'}),user(2,{plan_code,lifetime_parses_used:14,credits_remaining:1})],[2]);
    await changeAdministrator({dbPool:db,env,actorId:1,targetId:2,action:'revoke'});
    assert.equal((await access(db)).next,true);const result=await exportJob(db);
    assert.equal(result.body.entitlement_source,'commercial');assert.equal(result.body.allowance_consumed,true);
    assert.equal((await access(db)).next,false);
  }
});
test('an unverified managed administrator cannot parse or authorize a new export',async()=>{
  const db=store([user(2,{is_verified:false})],[2]);assert.equal((await access(db)).res.body.code,'EMAIL_NOT_VERIFIED');
  assert.equal((await exportJob(db)).body.error,'EMAIL_NOT_VERIFIED');assert.equal(db.usage.length,0);
});
test('management HTTP endpoints authenticate and recheck the actor; audit is private',async()=>{
  const db=store([user(1,{email:'bootstrap@example.test'}),user(2)],[2]);
  const app=express();app.use('/api/admin',createAdminRouter({dbPool:db,env,authenticate:(req,res,next)=>{
    const id=req.get('x-test-user');if(!id)return res.status(401).json({error:'UNAUTHORIZED'});req.user={userId:id,is_admin:true};next();
  }}));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const url=`http://127.0.0.1:${server.address().port}/api/admin`;
  try {
    assert.equal((await fetch(url+'/privilege-audit')).status,401);
    const headers={'x-test-user':'1','content-type':'application/json'};
    assert.equal((await fetch(url+'/users/2/administrator',{method:'POST',headers,body:JSON.stringify({action:'revoke'})})).status,200);
    assert.equal((await fetch(url+'/users/1/administrator',{method:'POST',headers:{...headers,'x-test-user':'2'},body:JSON.stringify({action:'grant'})})).status,403);
    assert.equal((await fetch(url+'/privilege-audit',{headers:{'x-test-user':'2'}})).status,403);
    const audit=await fetch(url+'/privilege-audit',{headers});assert.equal(audit.headers.get('cache-control'),'no-store');assert.equal((await audit.json()).items.length,1);
  } finally {server.closeAllConnections();await new Promise(r=>server.close(r));}
});
