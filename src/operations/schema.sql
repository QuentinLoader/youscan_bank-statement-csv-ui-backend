CREATE TABLE IF NOT EXISTS processing_attempts (
  id uuid PRIMARY KEY,
  job_id uuid,
  started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  stage text NOT NULL,
  outcome text NOT NULL DEFAULT 'processing',
  duration_ms integer,
  diagnostics jsonb NOT NULL DEFAULT '{}',
  build_id text,
  resolution text NOT NULL DEFAULT 'open' CHECK (resolution IN ('open','investigating','resolved'))
);
CREATE INDEX IF NOT EXISTS processing_attempts_started_idx ON processing_attempts(started_at DESC, id);
CREATE INDEX IF NOT EXISTS processing_attempts_failure_idx ON processing_attempts(resolution, started_at DESC)
  WHERE outcome IN ('failed','rejected');
CREATE TABLE IF NOT EXISTS processing_resolution_history (
  id bigserial PRIMARY KEY,
  attempt_id uuid NOT NULL REFERENCES processing_attempts(id) ON DELETE CASCADE,
  actor_id text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  previous_state text NOT NULL,
  new_state text NOT NULL,
  reason text NOT NULL
);
CREATE TABLE IF NOT EXISTS processing_coverage (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  started_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO processing_coverage(singleton) VALUES(true) ON CONFLICT DO NOTHING;
