import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { safeDiagnostic, stages } from './diagnostics.js';

let defaultPool;
let lastWrite = null;
let lastFailure = null;
const buildId = /^[a-f0-9]{7,40}$/i.test(process.env.RAILWAY_GIT_COMMIT_SHA || '') ? process.env.RAILWAY_GIT_COMMIT_SHA : null;
export function telemetryHealth() { return { lastWrite, lastFailure, state: lastFailure && (!lastWrite || lastFailure > lastWrite) ? 'degraded' : lastWrite ? 'healthy' : 'unknown' }; }
export function createTelemetry({ db = null, enabled = Boolean(process.env.DATABASE_URL), logger = console.error, now = Date.now } = {}) {
  async function write(sql, values, fallback) {
    if (!enabled) return;
    try {
      if (!db && !defaultPool) {
        defaultPool = new pg.Pool({ connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }, max: 2, connectionTimeoutMillis: 750,
        query_timeout: 750, statement_timeout: 750, idleTimeoutMillis: 10000 });
        defaultPool.on("error", () => { lastFailure = new Date(now()).toISOString(); logger("V2 OPERATIONS STORE UNAVAILABLE"); });
      }
      await (db || defaultPool).query(sql, values);
      lastWrite = new Date(now()).toISOString();
    } catch {
      lastFailure = new Date(now()).toISOString();
      logger('V2 OPERATIONS STORE UNAVAILABLE:', JSON.stringify(fallback));
    }
  }
  return {
    async start(stage = 'upload') {
      const attempt = { id: randomUUID(), start: now(), stage: stages.has(stage) ? stage : 'upload' };
      await write('INSERT INTO processing_attempts(id,stage,build_id) VALUES($1,$2,$3)', [attempt.id, attempt.stage, buildId], { id: attempt.id, stage: attempt.stage, outcome: 'processing' });
      return attempt;
    },
    async stage(attempt, stage) {
      if (!attempt || !stages.has(stage)) return;
      attempt.stage = stage;
      await write('UPDATE processing_attempts SET stage=$2,updated_at=now() WHERE id=$1 AND finished_at IS NULL', [attempt.id, stage], { id: attempt.id, stage });
    },
    async finish(attempt, { outcome = 'failed', error, diagnostic, jobId = null } = {}) {
      if (!attempt || attempt.finished) return;
      attempt.finished = true;
      const diagnostics = diagnostic || safeDiagnostic(error);
      const duration = Math.min(2147483647, Math.max(0, now() - attempt.start));
      const safeOutcome = ['success','review_required','failed','rejected'].includes(outcome) ? outcome : 'failed';
      await write('UPDATE processing_attempts SET outcome=$2,diagnostics=$3,job_id=$4,duration_ms=$5,finished_at=now(),updated_at=now() WHERE id=$1 AND finished_at IS NULL',
        [attempt.id,safeOutcome,JSON.stringify(diagnostics), /^[a-f0-9-]{36}$/i.test(jobId || '') ? jobId : null,duration],
        { id: attempt.id, stage: attempt.stage, outcome: safeOutcome, diagnostics });
    },
  };
}
export const processingTelemetry = createTelemetry();
