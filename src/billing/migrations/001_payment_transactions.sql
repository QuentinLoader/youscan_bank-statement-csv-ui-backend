-- YouScan Paystack payment transactions table.
-- Non-destructive: leaves historical ozow_transactions intact for audit history.

CREATE TABLE IF NOT EXISTS payment_transactions (
  id BIGSERIAL PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'paystack',
  transaction_reference TEXT NOT NULL UNIQUE,
  provider_transaction_id TEXT,
  access_code TEXT,
  authorization_code TEXT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  plan_code TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency_code TEXT NOT NULL DEFAULT 'ZAR',
  channel TEXT,
  customer_email TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  raw_payload JSONB,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_transactions_user_status
  ON payment_transactions (user_id, status);

CREATE INDEX IF NOT EXISTS idx_payment_transactions_created_at
  ON payment_transactions (created_at DESC);
