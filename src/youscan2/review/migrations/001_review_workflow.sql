-- YouScan V2 Batch 16
-- Persistent AI review workflow.
--
-- user_id is TEXT deliberately: the existing V1 repository does not ship a
-- database schema/migration history proving the concrete type of users.id.
-- Ownership is enforced by authenticated application queries.

CREATE TABLE IF NOT EXISTS youscan_v2_review_cases (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL,
  parse_job_id TEXT NULL,
  status TEXT NOT NULL,
  decision_risk TEXT NULL,
  decision_outcome TEXT NULL,
  deterministic_fingerprint TEXT NOT NULL,
  safe_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  encrypted_payload TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_youscan_v2_review_cases_user_created
  ON youscan_v2_review_cases (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_youscan_v2_review_cases_user_status_created
  ON youscan_v2_review_cases (user_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS youscan_v2_review_audit (
  id UUID PRIMARY KEY,
  review_case_id UUID NOT NULL REFERENCES youscan_v2_review_cases(id) ON DELETE CASCADE,
  actor_user_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  safe_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_youscan_v2_review_audit_case_created
  ON youscan_v2_review_audit (review_case_id, created_at ASC);
