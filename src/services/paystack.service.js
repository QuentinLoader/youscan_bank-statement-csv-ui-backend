import pool from "../config/db.js";
import { PRICING } from "../config/pricing.js";
import { safePaystackEventSummary } from "../utils/paystackSecurity.js";

const PAYSTACK_API_BASE = "https://api.paystack.co";

export function parseTransactionReference(reference) {
  const value = String(reference || "").trim();
  const firstUnderscore = value.indexOf("_");
  const lastUnderscore = value.lastIndexOf("_");

  if (
    firstUnderscore === -1 ||
    lastUnderscore === -1 ||
    firstUnderscore === lastUnderscore
  ) {
    const error = new Error("INVALID_TRANSACTION_REFERENCE");
    error.status = 400;
    throw error;
  }

  const userId = value.slice(0, firstUnderscore);
  const planCode = value.slice(firstUnderscore + 1, lastUnderscore);
  if (!/^\d+$/.test(userId)) {
    const error = new Error("INVALID_TRANSACTION_REFERENCE_USER");
    error.status = 400;
    throw error;
  }

  return { userId, planCode };
}

export function validatePaystackChargeRules(data, { pricing = PRICING } = {}) {
  if (!data || typeof data !== "object") {
    const error = new Error("PAYSTACK_INVALID_DATA");
    error.status = 400;
    throw error;
  }

  const { userId, planCode } = parseTransactionReference(data.reference);
  const plan = pricing.PLANS?.[planCode];
  if (!plan || Number(plan.price_cents || 0) <= 0) {
    const error = new Error("PAYSTACK_INVALID_PLAN");
    error.status = 400;
    throw error;
  }

  const expectedAmountCents = Number(plan.price_cents);
  const receivedAmountCents = Number(data.amount);
  if (!Number.isInteger(receivedAmountCents) || receivedAmountCents !== expectedAmountCents) {
    const error = new Error("PAYSTACK_AMOUNT_MISMATCH");
    error.status = 400;
    throw error;
  }

  const currency = String(data.currency || "").trim().toUpperCase();
  if (currency !== String(pricing.currency || "ZAR").toUpperCase()) {
    const error = new Error("PAYSTACK_CURRENCY_MISMATCH");
    error.status = 400;
    throw error;
  }

  return { userId, planCode, plan, expectedAmountCents };
}

export async function applyPlanOrCredits(client, userId, planCode) {
  if (planCode === "PAYG_10") {
    await client.query(
      `UPDATE users
       SET plan_code = CASE
             WHEN plan_code = 'PRO_YEAR_UNLIMITED' AND subscription_status = 'active' AND renewal_date > NOW()
             THEN 'PRO_YEAR_UNLIMITED'
             ELSE $2
           END,
           credits_remaining = CASE
             WHEN plan_code = 'PRO_YEAR_UNLIMITED' AND subscription_status = 'active' AND renewal_date > NOW()
             THEN NULL
             ELSE COALESCE(credits_remaining, 0) + 10
           END
       WHERE id = $1`,
      [Number(userId), planCode]
    );
    return;
  }

  if (planCode === "MONTHLY_25") {
    await client.query(
      `UPDATE users
       SET plan_code = $2,
           subscription_status = 'active',
           credits_remaining = 25,
           credits_per_cycle = 25,
           renewal_date = CASE WHEN plan_code = $2 AND renewal_date > NOW()
             THEN renewal_date ELSE NOW() END + INTERVAL '1 month'
       WHERE id = $1`,
      [Number(userId), planCode]
    );
    return;
  }

  if (planCode === "PRO_YEAR_UNLIMITED") {
    await client.query(
      `UPDATE users
       SET plan_code = $2,
           subscription_status = 'active',
           renewal_date = CASE WHEN plan_code = $2 AND renewal_date > NOW()
             THEN renewal_date ELSE NOW() END + INTERVAL '1 year',
           credits_remaining = NULL
       WHERE id = $1`,
      [Number(userId), planCode]
    );
    return;
  }

  throw new Error("PAYSTACK_UNSUPPORTED_PLAN");
}

export async function initializePaystackTransaction({
  email,
  amountCents,
  currency = "ZAR",
  reference,
  callbackUrl,
  metadata = {},
  secretKey = process.env.PAYSTACK_SECRET_KEY,
  fetchImpl = globalThis.fetch,
}) {
  const key = String(secretKey || "").trim();
  if (!key) {
    const error = new Error("PAYSTACK_SECRET_KEY_REQUIRED");
    error.code = "PAYSTACK_SECRET_KEY_REQUIRED";
    throw error;
  }

  const response = await fetchImpl(`${PAYSTACK_API_BASE}/transaction/initialize`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email,
      amount: Number(amountCents),
      currency,
      reference,
      callback_url: callbackUrl,
      metadata,
    }),
  });

  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.status || !body?.data?.authorization_url) {
    const error = new Error(body?.message || `PAYSTACK_INIT_FAILED_${response.status}`);
    error.code = "PAYSTACK_INIT_FAILED";
    error.status = 502;
    throw error;
  }

  return {
    authorizationUrl: body.data.authorization_url,
    accessCode: body.data.access_code || null,
    reference: body.data.reference || reference,
  };
}

export async function verifyPaystackTransaction({
  reference,
  secretKey = process.env.PAYSTACK_SECRET_KEY,
  fetchImpl = globalThis.fetch,
}) {
  const key = String(secretKey || "").trim();
  if (!key) {
    const error = new Error("PAYSTACK_SECRET_KEY_REQUIRED");
    error.code = "PAYSTACK_SECRET_KEY_REQUIRED";
    throw error;
  }

  const response = await fetchImpl(
    `${PAYSTACK_API_BASE}/transaction/verify/${encodeURIComponent(reference)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${key}`,
      },
    }
  );

  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.status || !body?.data) {
    const error = new Error(body?.message || `PAYSTACK_VERIFY_FAILED_${response.status}`);
    error.code = "PAYSTACK_VERIFY_FAILED";
    error.status = 502;
    throw error;
  }

  return body.data;
}

/**
 * Idempotent transactional fulfillment shared by Paystack webhooks and
 * server-side /transaction/verify fallback.
 */
export async function finalizePaystackPayment({
  paystackData,
  rawPayload = paystackData,
  dbPool = pool,
  pricing = PRICING,
  env = process.env,
  logger = console,
}) {
  const business = validatePaystackChargeRules(paystackData, { pricing });

  const isTest = String(paystackData.domain || "").toLowerCase() === "test";
  if (isTest && String(env.PAYSTACK_ALLOW_TEST_PAYMENTS || "").toLowerCase() !== "true") {
    logger.info("Paystack test event verified and ignored", safePaystackEventSummary(rawPayload));
    return { applied: false, status: "test_ignored", planCode: business.planCode };
  }

  const reference = String(paystackData.reference);
  const providerTransactionId = paystackData.id != null ? String(paystackData.id) : null;
  const status = String(paystackData.status || "").toLowerCase();
  const currency = String(paystackData.currency || pricing.currency || "ZAR").toUpperCase();
  const channel = paystackData.channel ? String(paystackData.channel) : null;
  const authorizationCode = paystackData.authorization?.authorization_code
    ? String(paystackData.authorization.authorization_code)
    : null;
  const customerEmail = paystackData.customer?.email
    ? String(paystackData.customer.email)
    : null;
  const terminalStatuses = new Set(["success", "failed", "abandoned", "reversed"]);

  const { userId, planCode, expectedAmountCents } = business;
  const client = await dbPool.connect();

  try {
    await client.query("BEGIN");

    const existingTx = await client.query(
      `SELECT id, processed_at, status, user_id, plan_code, amount_cents, currency_code
       FROM payment_transactions
       WHERE transaction_reference = $1
       ORDER BY created_at ASC
       LIMIT 1
       FOR UPDATE`,
      [reference]
    );

    if (existingTx.rowCount === 0) {
      await client.query(
        `INSERT INTO payment_transactions (
           provider, transaction_reference, provider_transaction_id, authorization_code,
           user_id, plan_code, amount_cents, currency_code, channel, customer_email,
           status, raw_payload, processed_at, created_at, updated_at
         )
         VALUES ('paystack', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, NOW(), NOW())`,
        [
          reference,
          providerTransactionId,
          authorizationCode,
          Number(userId),
          planCode,
          expectedAmountCents,
          currency,
          channel,
          customerEmail,
          status || "pending",
          JSON.stringify(rawPayload),
          terminalStatuses.has(status) ? new Date() : null,
        ]
      );
    } else {
      const existing = existingTx.rows[0];
      const identityMatches =
        String(existing.user_id) === String(userId) &&
        existing.plan_code === planCode &&
        Number(existing.amount_cents) === expectedAmountCents &&
        String(existing.currency_code || "").toUpperCase() === currency;

      if (!identityMatches) {
        const error = new Error("PAYSTACK_PENDING_TRANSACTION_MISMATCH");
        error.status = 409;
        throw error;
      }

      // Never downgrade or double-apply a confirmed payment on replayed webhooks or concurrent verify polls.
      if (existing.processed_at && existing.status === "success") {
        await client.query("COMMIT");
        return { applied: false, alreadyProcessed: true, status: "success", planCode };
      }

      await client.query(
        `UPDATE payment_transactions
         SET provider_transaction_id = COALESCE($2, provider_transaction_id),
             authorization_code = COALESCE($3, authorization_code),
             status = $4,
             amount_cents = $5,
             currency_code = $6,
             channel = COALESCE($7, channel),
             customer_email = COALESCE($8, customer_email),
             raw_payload = $9::jsonb,
             processed_at = CASE
               WHEN $4 IN ('success', 'failed', 'abandoned', 'reversed') THEN COALESCE(processed_at, NOW())
               ELSE processed_at
             END,
             updated_at = NOW()
         WHERE transaction_reference = $1`,
        [
          reference,
          providerTransactionId,
          authorizationCode,
          status || existing.status,
          expectedAmountCents,
          currency,
          channel,
          customerEmail,
          JSON.stringify(rawPayload),
        ]
      );
    }

    if (status !== "success") {
      await client.query("COMMIT");
      logger.info("Paystack non-success status recorded", safePaystackEventSummary(rawPayload));
      return { applied: false, status: status || "ignored", planCode };
    }

    await applyPlanOrCredits(client, userId, planCode);
    await client.query(
      `UPDATE payment_transactions
       SET processed_at = COALESCE(processed_at, NOW()), updated_at = NOW()
       WHERE transaction_reference = $1`,
      [reference]
    );

    await client.query("COMMIT");
    logger.info("Paystack payment applied", safePaystackEventSummary(rawPayload));
    return { applied: true, status: "success", planCode };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve original error.
    }
    throw error;
  } finally {
    client.release();
  }
}
