import { analysisAvailability } from '../youscan2/ai/availability.js';
import { telemetryHealth } from './telemetry.js';

export const resolutionReasons = ['investigation_started','retry_succeeded','fix_deployed','document_issue','provider_recovered','no_action_needed','reopened'];
export const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function failureFilter(query) {
  const page = Math.min(10000, Math.max(1, parseInt(query.page, 10) || 1));
  const clauses = ["outcome IN ('failed','rejected')"];
  const values = [];
  const add = (sql, value) => { values.push(value); clauses.push(sql.replace('?', `$${values.length}`)); };
  if (['open','investigating','resolved'].includes(query.resolution)) add('resolution=?', query.resolution);
  if (['availability','upload','pdf_reading','ai_extraction','validation'].includes(query.stage)) add('stage=?', query.stage);
  if (/^V2_[A-Z_]{1,50}$/.test(query.code || '')) add("diagnostics->>'code'=?", query.code);
  if (uuid.test(query.reference || '')) add('id=?::uuid', query.reference);
  for (const [name, comparison] of [['from','>='],['to','<']]) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(query[name] || '') && Number.isFinite(Date.parse(query[name]))) add(`started_at ${comparison} ?::date`, query[name]);
  }
  return { page, where: clauses.join(' AND '), values };
}
export async function listFailures(db, query) {
  const filter = failureFilter(query);
  const count = await db.query(`SELECT count(*)::int AS total FROM processing_attempts WHERE ${filter.where}`, filter.values);
  const result = await db.query(`SELECT id,job_id,started_at,finished_at,stage,outcome,duration_ms,diagnostics,build_id,resolution
    FROM processing_attempts WHERE ${filter.where} ORDER BY started_at DESC,id LIMIT 25 OFFSET $${filter.values.length + 1}`,
    [...filter.values,(filter.page-1)*25]);
  return { items: result.rows, total: count.rows[0].total, page: filter.page, pageSize: 25 };
}
export async function resolveFailure(db, { id, actor, state, reason }) {
  if (!uuid.test(id) || !['open','investigating','resolved'].includes(state) || !resolutionReasons.includes(reason)) return { status: 400, error: 'INVALID_RESOLUTION' };
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const record = await client.query("SELECT resolution FROM processing_attempts WHERE id=$1 AND outcome IN ('failed','rejected') FOR UPDATE", [id]);
    if (!record.rows.length) { await client.query('ROLLBACK'); return { status: 404, error: 'FAILURE_NOT_FOUND' }; }
    if (record.rows[0].resolution !== state) {
      await client.query('INSERT INTO processing_resolution_history(attempt_id,actor_id,previous_state,new_state,reason) VALUES($1,$2,$3,$4,$5)', [id,String(actor),record.rows[0].resolution,state,reason]);
      await client.query('UPDATE processing_attempts SET resolution=$2 WHERE id=$1', [id,state]);
    }
    await client.query('COMMIT');
    return { status: 200, resolution: state };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
export async function operationsOverview(db) {
  const attempts = await db.query(`SELECT
    count(*) FILTER(WHERE outcome='success')::int AS success,
    count(*) FILTER(WHERE outcome='review_required')::int AS review_required,
    count(*) FILTER(WHERE outcome='failed')::int AS failed,
    count(*) FILTER(WHERE outcome='rejected')::int AS rejected,
    count(*) FILTER(WHERE outcome='processing' AND updated_at >= now()-interval '15 minutes')::int AS active,
    count(*) FILTER(WHERE outcome='processing' AND updated_at < now()-interval '15 minutes')::int AS stale,
    count(*) FILTER(WHERE duration_ms>120000)::int AS slow,
    round(avg(duration_ms))::int AS average_duration_ms
    FROM processing_attempts WHERE started_at >= now()-interval '14 days'`);
  const reasons = await db.query(`SELECT diagnostics->>'code' AS code,count(*)::int AS count
    FROM processing_attempts WHERE outcome IN ('failed','rejected') AND started_at >= now()-interval '14 days'
    GROUP BY diagnostics->>'code' ORDER BY count DESC LIMIT 5`);
  const coverage = await db.query('SELECT started_at FROM processing_coverage WHERE singleton=true');
  const unresolved = await db.query("SELECT count(*)::int AS count FROM processing_attempts WHERE outcome IN ('failed','rejected') AND resolution!='resolved'");
  const billing = await db.query(`SELECT
    (SELECT count(*)::int FROM ozow_transactions WHERE status='Complete' AND processed_at IS NOT NULL AND created_at >= now()-interval '14 days') AS confirmed_payments,
    (SELECT count(*)::int FROM users WHERE plan_code IN ('MONTHLY_25','PRO_YEAR_UNLIMITED') AND (renewal_date IS NULL OR renewal_date<=now())) AS expired_subscriptions,
    (SELECT count(*)::int FROM users WHERE plan_code IN ('MONTHLY_25','PRO_YEAR_UNLIMITED') AND renewal_date>now() AND renewal_date<=now()+interval '7 days') AS expiring_subscriptions`);
  const exports = await db.query(`SELECT count(*)::int AS first_exports,
    count(*) FILTER(WHERE plan_code='FREE')::int AS free_allowances,
    count(*) FILTER(WHERE plan_code IN ('PAYG_10','MONTHLY_25'))::int AS paid_credit_exports,
    count(*) FILTER(WHERE plan_code='PRO_YEAR_UNLIMITED')::int AS unlimited_exports
    FROM v2_export_ledger WHERE exported_at >= now()-interval '14 days'`);
  return { checkedAt: new Date().toISOString(), database: 'healthy', telemetry: telemetryHealth(),
    provider: analysisAvailability.getCachedStatus(), build: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0,40) || 'unknown',
    windowDays: 14, coverageStartedAt: coverage.rows[0]?.started_at || null,
    processing: attempts.rows[0], topReasons: reasons.rows, openFailures: unresolved.rows[0].count,
    billing: billing.rows[0], exports: exports.rows[0] };
}
export async function cleanupOperations(db, days = 90) {
  const retention = Number(days);
  if (!Number.isInteger(retention) || retention < 30 || retention > 365) throw new Error('INVALID_RETENTION');
  // Limited batches avoid long locks. Commercial ledgers are separate and never deleted here.
  const result = await db.query(`DELETE FROM processing_attempts WHERE id IN
    (SELECT id FROM processing_attempts WHERE started_at < now()-($1::int * interval '1 day') ORDER BY started_at LIMIT 1000)`, [retention]);
  return { deleted: result.rowCount, retentionDays: retention };
}
