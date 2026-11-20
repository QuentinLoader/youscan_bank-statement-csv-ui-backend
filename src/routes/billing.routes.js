import express from "express";
import pool from "../config/db.js";
import { authenticateUser } from "../middleware/auth.middleware.js";
import { PRICING } from "../config/pricing.js";
import {
  BillingStatusError,
  getBillingStatusForUser,
  getPaymentConfirmation,
} from "../services/billingStatus.service.js";
import {
  finalizePaystackPayment,
  initializePaystackTransaction,
  verifyPaystackTransaction,
} from "../services/paystack.service.js";

function buildCallbackUrl(env = process.env) {
  const base = String(env.APP_URL || "https://youscan.addvision.co.za").trim().replace(/\/+$/, "");
  return `${base}/payment-return`;
}

export function createBillingRouter({
  dbPool = pool,
  pricing = PRICING,
  env = process.env,
  authenticate = authenticateUser,
  initializeTransaction = initializePaystackTransaction,
  verifyTransaction = verifyPaystackTransaction,
  logger = console,
} = {}) {
  const router = express.Router();

  router.get("/payment-status", authenticate, async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const reference = req.query.reference;
      let confirmation = await getPaymentConfirmation({
        userId: req.user.userId,
        reference,
        dbPool,
      });

      // If the user already returned from Paystack before the webhook arrived,
      // safely verify once server-side using the same idempotent fulfillment path.
      if (!confirmation.confirmed && confirmation.status === "pending" && env.PAYSTACK_SECRET_KEY) {
        try {
          const verifiedData = await verifyTransaction({
            reference: String(reference),
            secretKey: env.PAYSTACK_SECRET_KEY,
          });
          if (String(verifiedData?.status || "").toLowerCase() === "success") {
            await finalizePaystackPayment({
              paystackData: verifiedData,
              rawPayload: { event: "verify.fallback", data: verifiedData },
              dbPool,
              pricing,
              env,
              logger,
            });
            confirmation = await getPaymentConfirmation({
              userId: req.user.userId,
              reference,
              dbPool,
            });
          }
        } catch (verifyErr) {
          logger.warn("Paystack verify fallback skipped", {
            reference: String(reference || ""),
            reason: verifyErr?.message || "VERIFY_FAILED",
          });
        }
      }

      return res.json({
        confirmed: confirmation.confirmed,
        plan_code: confirmation.plan_code,
      });
    } catch (error) {
      return res.status(error instanceof BillingStatusError ? error.status : 500).json({
        code: error instanceof BillingStatusError ? error.code : "PAYMENT_STATUS_FAILED",
      });
    }
  });

  router.get("/status", authenticate, async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const status = await getBillingStatusForUser({ userId: req.user.userId, dbPool, env });
      return res.json(status);
    } catch (err) {
      if (err instanceof BillingStatusError) {
        return res.status(err.status).json({ code: err.code, message: err.message });
      }
      logger.error("BILLING STATUS ERROR:", err?.code || err?.message || "unknown");
      return res.status(500).json({ code: "BILLING_STATUS_FAILED" });
    }
  });

  router.post("/create-payment", authenticate, async (req, res) => {
    try {
      const { planCode } = req.body || {};
      if (!planCode) {
        return res.status(400).json({ error: "Plan code required" });
      }

      const plan = pricing.PLANS[planCode];
      if (!plan || Number(plan.price_cents || 0) <= 0) {
        return res.status(400).json({ error: "Invalid plan" });
      }

      const user = req.user;
      if (!user || !user.userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const secretKey = String(env.PAYSTACK_SECRET_KEY || "").trim();
      if (!secretKey) {
        return res.status(500).json({ error: "Payment configuration error" });
      }

      const userResult = await dbPool.query(
        `SELECT id, email FROM users WHERE id = $1 LIMIT 1`,
        [user.userId]
      );
      const dbUser = userResult.rows[0];
      if (!dbUser?.email) {
        return res.status(404).json({ error: "User email not found" });
      }

      /*
       * Supersede any prior uncompleted pending transactions for this user so
       * switching plans or navigating back never locks checkout. If a superseded
       * transaction is still completed in another tab, the signed Paystack webhook
       * will still honor a genuine charge.success event.
       */
      await dbPool.query(
        `UPDATE payment_transactions
         SET status = CASE
               WHEN created_at <= NOW() - INTERVAL '15 minutes' THEN 'expired'
               ELSE 'cancelled'
             END,
             processed_at = NOW(),
             updated_at = NOW()
         WHERE user_id = $1
           AND status = 'pending'
           AND processed_at IS NULL`,
        [user.userId]
      );

      const amountCents = Number(plan.price_cents);
      const currency = String(pricing.currency || "ZAR").trim().toUpperCase();
      const nowMs = Date.now();
      const transactionReference = `${user.userId}_${planCode}_${nowMs}`;
      const callbackUrl = buildCallbackUrl(env);

      const initialized = await initializeTransaction({
        email: dbUser.email,
        amountCents,
        currency,
        reference: transactionReference,
        callbackUrl,
        metadata: {
          user_id: user.userId,
          plan_code: planCode,
          plan_name: plan.name,
        },
        secretKey,
      });

      logger.info("Paystack payment initiated", {
        transactionReference: initialized.reference,
        planCode,
        userId: user.userId,
      });

      await dbPool.query(
        `INSERT INTO payment_transactions (
           provider, transaction_reference, access_code, user_id, plan_code,
           amount_cents, currency_code, customer_email, status, raw_payload,
           created_at, updated_at
         )
         VALUES ('paystack', $1, $2, $3, $4, $5, $6, $7, 'pending', $8::jsonb, NOW(), NOW())`,
        [
          initialized.reference,
          initialized.accessCode,
          user.userId,
          planCode,
          amountCents,
          currency,
          dbUser.email,
          JSON.stringify({
            reference: initialized.reference,
            access_code: initialized.accessCode,
            plan_code: planCode,
            amount_cents: amountCents,
            currency,
          }),
        ]
      );

      return res.json({
        authorization_url: initialized.authorizationUrl,
        reference: initialized.reference,
        access_code: initialized.accessCode,
      });
    } catch (err) {
      logger.error("CREATE PAYSTACK PAYMENT ERROR:", err?.code || err?.message || "unknown");
      return res.status(err?.status || 500).json({ error: "Failed to create payment" });
    }
  });

  return router;
}

export default createBillingRouter();
