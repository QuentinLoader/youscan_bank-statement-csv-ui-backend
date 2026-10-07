import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { safeDiagnostic, safeExtractionAudit } from '../../operations/diagnostics.js';
import { createTelemetry } from '../../operations/telemetry.js';
import { failureFilter, resolveFailure, cleanupOperations, operationsOverview } from '../../operations/adminOperations.js';
import { createAdminRouter } from '../../routes/admin.js';
import { createV2ParseRouter } from '../api/parse.routes.js';
import { createAnalysisAvailability } from '../ai/availability.js';
import { V2_RECOGNIZED_BANK_SUBTYPES } from '../registry/bankSupport.js';

const id = '11111111-1111-4111-8111-111111111111';
test('diagnostics exclude arbitrary messages, values, secrets and provider strings', () => {
  const diagnostic = safeDiagnostic({ code: 'V2_AI_PROVIDER_FAILED', message: 'PRIVATE VALUE',
    details: { status: 429, providerCode: 'insufficient_quota', requestId:'req-synthetic',
      issues:['data.transactions[3].amount.value must be a finite number.', 'PRIVATE SECRET'], body:'PRIVATE' } });
  assert.equal(diagnostic.reason, 'insufficient_quota');
  assert.equal(diagnostic.providerRequestId, 'req-synthetic');
  assert.equal(diagnostic.fields[0].field, 'data.transactions[3].amount.value');
  assert.equal(JSON.stringify(diagnostic).includes('PRIVATE'),false);
  assert.equal(safeDiagnostic({code:'PRIVATE',details:{providerCode:'PRIVATE',requestId:'PRIVATE'}}).code,'V2_PARSE_FAILED');
  assert.equal(safeDiagnostic({providerFailure:{code:'V2_AI_TIMEOUT'}}).code,'V2_AI_TIMEOUT');
  assert.equal(safeDiagnostic({code:'V2_AI_PROVIDER_FAILED',details:{status:401}}).reason,'authentication_error');
});
test('safe audit retains warning/confidence metadata without monetary data or field evidence', () => {
  const result = safeExtractionAudit({ aiExtraction:{confidence:0.9}, classification:{documentSubtype:'fnb_statement',confidence:0.8},
    result:{issues:[{issueType:'low_field_confidence',fieldPath:'transactions[2].amount',confidence:0.7,value:999, evidence:'PRIVATE',message:'PRIVATE'}]} }, {pages:3});
  assert.equal(result.warnings[0].confidence,0.7); assert.equal(result.pageCount,3);
  assert.equal(JSON.stringify(result).includes('PRIVATE'),false); assert.equal(JSON.stringify(result).includes('999'),false);
});
test('audit uses the supported bank registry including Nedbank without retaining unknown identity text', () => {
  for (const documentSubtype of V2_RECOGNIZED_BANK_SUBTYPES) {
    assert.equal(safeExtractionAudit({ classification: { documentSubtype } }).bank, documentSubtype);
  }
  assert.equal(safeExtractionAudit({ classification: { documentSubtype: 'PRIVATE' } }).bank, 'unknown');
});
test('telemetry records stages and one terminal outcome without filenames or documents', async () => {
  const calls=[];let clock=1000;
  const telemetry=createTelemetry({enabled:true,db:{query:async (sql,params)=>calls.push({sql,params})},now:()=>clock});
  const attempt=await telemetry.start(); await telemetry.stage(attempt,'pdf_reading');clock=1200;
  await telemetry.finish(attempt,{error:{code:'V2_AI_TIMEOUT',message:'PRIVATE'},jobId:id});
  await telemetry.finish(attempt,{outcome:'success'});
  assert.equal(calls.length,3);assert.equal(calls[2].params[4],200);
  assert.equal(calls[2].params[3],id);assert.equal(JSON.stringify(calls).includes('PRIVATE'),false);
});
test('store outages fall back safely and never throw into parsing', async () => {
  const logs=[];const telemetry=createTelemetry({enabled:true,db:{query:async()=>{throw Error('PRIVATE')}},logger:(...args)=>logs.push(args)});
  const attempt=await telemetry.start('pdf_reading');await telemetry.finish(attempt,{error:{code:'V2_AI_TIMEOUT',message:'PRIVATE'}});
  assert.equal(logs.length,2);assert.equal(JSON.stringify(logs).includes('PRIVATE'),false);
});
test('filters are allowlisted, parameterised and pagination bounded', () => {
  const filter=failureFilter({resolution:'resolved',stage:'validation',reference:id,from:'2026-10-01',page:'999999',code:'V2_AI_TIMEOUT'});
  assert.equal(filter.page,10000);assert.equal(filter.values.length,5);assert.ok(!filter.where.includes(id));
  assert.equal(failureFilter({resolution:"';DROP TABLE users",stage:'private',reference:'bad'}).values.length,0);
});
test('resolution changes only support status with immutable audit history and no commercial update', async () => {
  const calls=[];const client={query:async (sql,args)=>{calls.push({sql,args});return {rows:sql.startsWith('SELECT')?[{resolution:'open'}]:[]}},release:()=>{}};
  const result=await resolveFailure({connect:async()=>client},{id,actor:'admin-1',state:'resolved',reason:'fix_deployed'});
  assert.equal(result.status,200); assert.ok(calls.some(call=>call.sql.includes('processing_resolution_history')));
  assert.ok(!JSON.stringify(calls).includes('UPDATE users'));assert.ok(calls.some(call=>call.sql==='COMMIT'));
  assert.equal((await resolveFailure({}, {id,state:'resolved',reason:'PRIVATE'})).status,400);
});
test('retention deletes only bounded operational records, not commercial history', async () => {
  let statement;const db={query:async(sql,args)=>{statement=sql;assert.equal(args[0],90);return {rowCount:5}}};
  assert.deepEqual(await cleanupOperations(db),{deleted:5,retentionDays:90});
  assert.ok(statement.includes('LIMIT 1000'));assert.ok(!statement.includes('usage_logs'));
  await assert.rejects(()=>cleanupOperations(db,2));
});
test('overview counts terminal file outcomes and unique ledgers rather than HTTP checks', async () => {
  const statements=[];const db={query:async sql=>{statements.push(sql);return {rows:[{count:0,started_at:'2026-10-07T00:00:00Z'}]}}};
  const result=await operationsOverview(db);assert.equal(result.database,'healthy');
  assert.ok(statements.some(sql=>sql.includes("outcome='review_required'")));
  assert.ok(statements.some(sql=>sql.includes('v2_export_ledger')));
  assert.ok(statements.some(sql=>sql.includes('processed_at IS NOT NULL')));
  assert.ok(!statements.some(sql=>sql.includes('file_name')));
});
async function serve(router, action) {
  const app=express();app.use(router);const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  try { await action(`http://127.0.0.1:${server.address().port}`); }
  finally { server.closeAllConnections();await new Promise(resolve=>server.close(resolve)); }
}
test('every operational endpoint enforces server-side administrator permission', async () => {
  const router=createAdminRouter({dbPool:{query:async()=>({rows:[{email:'member@example.test'}]})},env:{YOUSCAN_ADMIN_EMAILS:'admin@example.test'},authenticate:(req,_res,next)=>{req.user={userId:1};next()}});
  await serve(router,async url=>{for(const path of ['/operations','/failures',`/failures/${id}`]) assert.equal((await fetch(url+path)).status,403);
    assert.equal((await fetch(`${url}/failures/${id}/resolution`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({state:'resolved',reason:'fix_deployed'})})).status,403);
    assert.equal((await fetch(`${url}/operations/cleanup`,{method:'POST'})).status,403);
  });
});
for (const scenario of ['pdf_reading','validation','availability','upload']) {
  test(`parse persists ${scenario} failure before returning unchanged customer response`, async () => {
    const calls=[];const telemetry=createTelemetry({enabled:true,db:{query:async (sql,params)=>calls.push({sql,params})}});
    const availability=createAnalysisAvailability({probe:async()=>{if(scenario==='availability')throw Object.assign(Error('PRIVATE'),{code:'V2_AI_PROVIDER_FAILED',details:{status:429,providerCode:'insufficient_quota'}})},logger:()=>{}});
    const router=createV2ParseRouter({telemetry,availability,authenticate:(req,_res,next)=>{req.user={userId:1};next()},checkAccess:(_req,_res,next)=>next(),limiter:(_req,_res,next)=>next(),
      extractText:async()=>{if(scenario==='pdf_reading')throw Object.assign(Error('PRIVATE'),{code:'V2_AI_TIMEOUT'});return {text:'synthetic',meta:{}}},
      runJob:async ({onStage})=>{await onStage('validation');return {status:'failed',error:{code:'V2_AI_INVALID_RESPONSE',message:'Please retry'},diagnostic:safeDiagnostic({code:'V2_AI_INVALID_RESPONSE',details:{issues:['data.transactions[1].date is required.']}})}} });
    await serve(router,async url=>{const form=new FormData();if(scenario!=='upload')form.append('files',new Blob(['synthetic'],{type:'application/pdf'}),'PRIVATE.pdf');
      const response=await fetch(url,{method:'POST',body:form});assert.ok(response.status>=400);
      assert.equal(calls.filter(call=>call.sql.includes('finished_at=now()')).length,1);
      assert.equal(JSON.stringify(calls).includes('PRIVATE'),false);
      if(scenario==='availability')assert.ok(JSON.stringify(calls).includes('insufficient_quota'));
    });
  });
}
test('administrator cached availability never probes AI', () => {
  let probes=0;const availability=createAnalysisAvailability({probe:async()=>probes++});
  assert.equal(availability.getCachedStatus().checkedAt,null);assert.equal(probes,0);
});
