import express from "express";
import pool from "../config/db.js";
import { PRICING } from "../config/pricing.js";
import {
  normalizeOzowAmount,
  safeOzowEventSummary,
  verifyOzowWebhookHash,
} from "../utils/ozowSecurity.js";

function parseTransactionReference(reference) {
  const value = String(reference || "");
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

function validateWebhookBusinessRules(payload, { siteCode, pricing }) {
  if (String(payload.SiteCode || "").trim() !== String(siteCode || "").trim()) {
    const error = new Error("OZOW_SITE_CODE_MISMATCH");
    error.status = 400;
    throw error;
  }

  const { userId, planCode } = parseTransactionReference(payload.TransactionReference);
  const plan = pricing.PLANS?.[planCode];
  if (!plan || Number(plan.price_cents || 0) <= 0) {
    const error = new Error("OZOW_INVALID_PLAN");
    error.status = 400;
    throw error;
  }

  const expectedAmount = (Number(plan.price_cents) / 100).toFixed(2);
  if (normalizeOzowAmount(payload.Amount) !== expectedAmount) {
    const error = new Error("OZOW_AMOUNT_MISMATCH");
    error.status = 400;
    throw error;
  }

  if (String(payload.CurrencyCode || "").trim().toUpperCase() !== String(pricing.currency).toUpperCase()) {
    const error = new Error("OZOW_CURRENCY_MISMATCH");
    error.status = 400;
    throw error;
  }

  return { userId, planCode, plan, expectedAmount };
}

async function applyPlanOrCredits(client, userId, planCode) {
  if (planCode === "PAYG_10") {
    await client.query(
      `UPDATE users
       SET plan_code = $2, credits_remaining = COALESCE(credits_remaining, 0) + 10
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
           renewal_date = NOW() + INTERVAL '1 month'
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
           renewal_date = NOW() + INTERVAL '1 year',
           credits_remaining = NULL
       WHERE id = $1`,
      [Number(userId), planCode]
    );
    return;
  }

  throw new Error("OZOW_UNSUPPORTED_PLAN");
}

export function createOzowWebhookRouter({
  dbPool = pool,
  pricing = PRICING,
  env = process.env,
  logger = console,
} = {}) {
  const router = express.Router();

  router.post("/webhook", express.urlencoded({ extended: true }), async (req, res) => {
    const payload = req.body || {};
    const privateKey = env.OZOW_PRIVATE_KEY;
    const siteCode = env.OZOW_SITE_CODE;

    if (!privateKey || !siteCode) {
      logger.error("Ozow webhook configuration missing");
      return res.status(500).send("CONFIG_ERROR");
    }

    let business;
    try {
      if (!verifyOzowWebhookHash(payload, privateKey)) {
        logger.warn("Ozow webhook rejected: invalid hash", safeOzowEventSummary(payload));
        return res.status(400).send("INVALID_HASH");
      }

      business = validateWebhookBusinessRules(payload, { siteCode, pricing });
    } catch (error) {
      logger.warn("Ozow webhook rejected", {
        ...safeOzowEventSummary(payload),
        reason: error?.message || "INVALID_PAYLOAD",
      });
      return res.status(error?.status || 400).send("INVALID_PAYLOAD");
    }

    // Production payment creation always uses IsTest=false. A valid test
    // callback may be acknowledged for integration diagnostics, but it must
    // never activate a paid plan in production by default.
    const isTest = String(payload.IsTest || "").toLowerCase() === "true";
    if (isTest && String(env.OZOW_ALLOW_TEST_PAYMENTS || "").toLowerCase() !== "true") {
      logger.info("Ozow test callback verified and ignored", safeOzowEventSummary(payload));
      return res.status(200).send("TEST_IGNORED");
    }

    const {
      TransactionId,
      TransactionReference,
      BankReference,
      Amount,
      Status,
      CurrencyCode,
      BankName,
    } = payload;

    const { userId, planCode } = business;
    const client = await dbPool.connect();

    try {
      await client.query("BEGIN");

      const existingTx = await client.query(
        `SELECT id, processed_at, status, user_id, plan_code, amount, currency_code
         FROM ozow_transactions
         WHERE transaction_reference = $1
         ORDER BY created_at ASC
         LIMIT 1
         FOR UPDATE`,
        [TransactionReference]
      );

      if (existingTx.rowCount === 0) {
        await client.query(
          `INSERT INTO ozow_transactions (
             transaction_id, transaction_reference, user_id, plan_code, amount,
             currency_code, status, bank_reference, bank_name, raw_payload,
             processed_at, created_at, updated_at
           )
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,NOW(),NOW())`,
          [
            TransactionId || TransactionReference,
            TransactionReference,
            Number(userId),
            planCode,
            normalizeOzowAmount(Amount),
            CurrencyCode || "ZAR",
            Status,
            BankReference ?? null,
            BankName ?? null,
            JSON.stringify(payload),
            ["Complete", "Cancelled", "Failed", "Error"].includes(Status) ? new Date() : null,
          ]
        );
      } else {
        const existing = existingTx.rows[0];
        const identityMatches =
          String(existing.user_id) === String(userId) &&
          existing.plan_code === planCode &&
          normalizeOzowAmount(existing.amount) === business.expectedAmount &&
          String(existing.currency_code || "").toUpperCase() === String(pricing.currency).toUpperCase();

        if (!identityMatches) {
          const error = new Error("OZOW_PENDING_TRANSACTION_MISMATCH");
          error.status = 409;
          throw error;
        }

        if (existing.processed_at && existing.status === "Complete" && Status === "Complete") {
          await client.query("COMMIT");
          return res.status(200).send("OK");
        }

        await client.query(
          `UPDATE ozow_transactions
           SET transaction_id = $2,
               status = $3,
               amount = $4,
               currency_code = $5,
               bank_reference = $6,
               bank_name = $7,
               raw_payload = $8::jsonb,
               processed_at = CASE
                 WHEN $3 IN ('Complete', 'Cancelled', 'Failed', 'Error') THEN COALESCE(processed_at, NOW())
                 ELSE processed_at
               END,
               updated_at = NOW()
           WHERE transaction_reference = $1`,
          [
            TransactionReference,
            TransactionId || TransactionReference,
            Status,
            normalizeOzowAmount(Amount),
            CurrencyCode || "ZAR",
            BankReference ?? null,
            BankName ?? null,
            JSON.stringify(payload),
          ]
        );
      }

      if (Status !== "Complete") {
        await client.query("COMMIT");
        logger.info("Ozow callback recorded", safeOzowEventSummary(payload));
        return res.status(200).send("IGNORED");
      }

      await applyPlanOrCredits(client, userId, planCode);
      await client.query(
        `UPDATE ozow_transactions
         SET processed_at = COALESCE(processed_at, NOW()), updated_at = NOW()
         WHERE transaction_reference = $1`,
        [TransactionReference]
      );

      await client.query("COMMIT");
      logger.info("Ozow payment applied", safeOzowEventSummary(payload));
      return res.status(200).send("OK");
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve original error.
      }
      logger.error("Ozow webhook processing failed", {
        ...safeOzowEventSummary(payload),
        reason: error?.message || "UNKNOWN",
      });
      return res.status(error?.status || 500).send(error?.status ? "REJECTED" : "ERROR");
    } finally {
      client.release();
    }
  });

  return router;
}

export { parseTransactionReference, validateWebhookBusinessRules };
export default createOzowWebhookRouter();
