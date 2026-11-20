import express from "express";
import pool from "../config/db.js";
import { PRICING } from "../config/pricing.js";
import {
  safePaystackEventSummary,
  verifyPaystackWebhookSignature,
} from "../utils/paystackSecurity.js";
import { finalizePaystackPayment } from "../services/paystack.service.js";

export function createPaystackWebhookRouter({
  dbPool = pool,
  pricing = PRICING,
  env = process.env,
  logger = console,
} = {}) {
  const router = express.Router();

  router.post(
    "/webhook",
    express.raw({ type: "application/json", limit: "256kb" }),
    async (req, res) => {
      const secretKey = env.PAYSTACK_SECRET_KEY;
      if (!secretKey) {
        logger.error("Paystack webhook configuration missing");
        return res.status(500).send("CONFIG_ERROR");
      }

      const rawBody = Buffer.isBuffer(req.body)
        ? req.body
        : Buffer.from(typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {}), "utf8");
      const signature = req.get("x-paystack-signature");

      if (!verifyPaystackWebhookSignature(rawBody, signature, secretKey)) {
        logger.warn("Paystack webhook rejected: invalid signature");
        return res.status(401).send("INVALID_SIGNATURE");
      }

      let payload;
      try {
        payload = JSON.parse(rawBody.toString("utf8"));
      } catch {
        logger.warn("Paystack webhook rejected: invalid JSON");
        return res.status(400).send("INVALID_JSON");
      }

      if (payload?.event !== "charge.success") {
        logger.info("Paystack non-charge.success event ignored", safePaystackEventSummary(payload));
        return res.status(200).send("IGNORED");
      }

      try {
        const result = await finalizePaystackPayment({
          paystackData: payload.data,
          rawPayload: payload,
          dbPool,
          pricing,
          env,
          logger,
        });

        if (result.status === "test_ignored") {
          return res.status(200).send("TEST_IGNORED");
        }
        return res.status(200).send(result.applied || result.alreadyProcessed ? "OK" : "IGNORED");
      } catch (error) {
        logger.error("Paystack webhook processing failed", {
          ...safePaystackEventSummary(payload),
          reason: error?.message || "UNKNOWN",
        });
        return res.status(error?.status || 500).send(error?.status ? "REJECTED" : "ERROR");
      }
    }
  );

  return router;
}

export default createPaystackWebhookRouter();
