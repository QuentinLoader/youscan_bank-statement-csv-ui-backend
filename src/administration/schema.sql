-- Effective bootstrap authority remains in configuration, never imported as a revocable grant.
CREATE TABLE IF NOT EXISTS administrator_memberships (
  user_id bigint PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by bigint REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS administrator_memberships_granter_idx ON administrator_memberships(granted_by);
CREATE TABLE IF NOT EXISTS administrator_privilege_audit (
  id bigserial PRIMARY KEY,
  actor_id text NOT NULL,
  target_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('grant','revoke')),
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS administrator_privilege_audit_time_idx
  ON administrator_privilege_audit(changed_at DESC,id);
ALTER TABLE v2_export_ledger ADD COLUMN IF NOT EXISTS entitlement_source text NOT NULL DEFAULT 'commercial'
  CHECK (entitlement_source IN ('commercial','administrator'));
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS entitlement_source text NOT NULL DEFAULT 'commercial'
  CHECK (entitlement_source IN ('commercial','administrator'));
