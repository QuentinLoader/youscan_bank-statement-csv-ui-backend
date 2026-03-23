import express from "express";
import crypto from "crypto";
import pool from "../config/db.js";
import { PRICING } from "../config/pricing.js";

const router = express.Router();

function normalizeAmount(amount) {
  return parseFloat(amount).toFixed(2);
}

function generateOzowWebhookHash(data, privateKey) {
  const parts = [
    data.SiteCode,
    data.TransactionId,
    data.TransactionReference,
    data.BankReference ?? "", // critical
    normalizeAmount(data.Amount),
    data.Status,
    data.Optional1 ?? "",
    data.Optional2 ?? "",
    data.Optional3 ?? "",
    data.Optional4 ?? "",
    data.Optional5 ?? "",
    data.CurrencyCode,
    data.IsTest,
    privateKey
  ];

  const rawString = parts
    .map(v => (v === undefined || v === null ? "" : String(v)))
    .join("");

  const hashString = rawString.toLowerCase();

  console.log("WEBHOOK RAW STRING:", JSON.stringify(rawString));
  console.log("WEBHOOK HASH STRING:", JSON.stringify(hashString));

  return crypto
    .createHash("sha512")
    .update(hashString, "utf-8")
    .digest("hex")
    .toLowerCase();
}

function parseTransactionReference(reference) {
  // expected shape: `${userId}_${planCode}_${timestamp}`
  const firstUnderscore = reference.indexOf("_");
  const lastUnderscore = reference.lastIndexOf("_");

  if (firstUnderscore === -1 || lastUnderscore === -1 || firstUnderscore === lastUnderscore) {
    throw new Error(`Invalid TransactionReference format: ${reference}`);
  }

  const userId = reference.slice(0, firstUnderscore);
  const planCode = reference.slice(firstUnderscore + 1, lastUnderscore);
  const timestamp = reference.slice(lastUnderscore + 1);

  return { userId, planCode, timestamp };
}

async function applyPlanOrCredits(client, userId, planCode) {
  if (planCode === "PAYG_10") {
    await client.query(
      `
      UPDATE users
      SET
        plan_code = $2,
        credits_remaining = COALESCE(credits_remaining, 0) + 10
      WHERE id = $1
      `,
      [userId, planCode]
    );
    return;
  }

  if (planCode === "MONTHLY_25") {
    await client.query(
      `
      UPDATE users
      SET
        plan_code = $2,
        credits_remaining = 25
      WHERE id = $1
      `,
      [userId, planCode]
    );
    return;
  }

  if (planCode === "PRO_YEAR_UNLIMITED") {
    await client.query(
      `
      UPDATE users
      SET
        plan_code = $2
      WHERE id = $1
      `,
      [userId, planCode]
    );
    return;
  }

  throw new Error(`Unsupported planCode: ${planCode}`);
}

router.post(
  "/webhook",
  express.urlencoded({ extended: true }),
  async (req, res) => {
    const client = await pool.connect();

    try {
      console.log("=== OZOW WEBHOOK RECEIVED ===");
      console.log("BODY:", req.body);

      const payload = req.body;
      const privateKey = process.env.OZOW_PRIVATE_KEY;

      if (!privateKey) {
        console.error("Missing OZOW_PRIVATE_KEY");
        return res.status(500).send("CONFIG_ERROR");
      }

      const expectedHash = generateOzowWebhookHash(payload, privateKey);
      const receivedHash = String(payload.Hash || "").toLowerCase();

      console.log("EXPECTED HASH:", expectedHash);
      console.log("RECEIVED HASH:", receivedHash);

      if (expectedHash !== receivedHash) {
        console.error("Invalid webhook hash");
        return res.status(400).send("INVALID_HASH");
      }

      const {
        SiteCode,
        TransactionId,
        TransactionReference,
        BankReference,
        Amount,
        Status,
        CurrencyCode,
        IsTest,
        StatusMessage,
        BankName
      } = payload;

      const { userId, planCode } = parseTransactionReference(TransactionReference);

      await client.query("BEGIN");

      // 1) Ensure idempotency record exists
      // Recommended table:
      // CREATE TABLE billing_transactions (
      //   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      //   provider TEXT NOT NULL,
      //   transaction_id TEXT NOT NULL UNIQUE,
      //   transaction_reference TEXT NOT NULL,
      //   user_id TEXT NOT NULL,
      //   plan_code TEXT NOT NULL,
      //   amount NUMERIC(12,2) NOT NULL,
      //   currency_code TEXT NOT NULL,
      //   status TEXT NOT NULL,
      //   bank_reference TEXT,
      //   bank_name TEXT,
      //   raw_payload JSONB NOT NULL,
      //   processed_at TIMESTAMPTZ,
      //   created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      //   updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      // );

      const existingTx = await client.query(
        `
        SELECT id, status, processed_at
        FROM billing_transactions
        WHERE transaction_id = $1
        FOR UPDATE
        `,
        [TransactionId]
      );

      if (existingTx.rowCount === 0) {
        await client.query(
          `
          INSERT INTO billing_transactions (
            provider,
            transaction_id,
            transaction_reference,
            user_id,
            plan_code,
            amount,
            currency_code,
            status,
            bank_reference,
            bank_name,
            raw_payload
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
          `,
          [
            "ozow",
            TransactionId,
            TransactionReference,
            String(userId),
            planCode,
            normalizeAmount(Amount),
            CurrencyCode,
            Status,
            BankReference ?? null,
            BankName ?? null,
            JSON.stringify(payload)
          ]
        );
      } else {
        await client.query(
          `
          UPDATE billing_transactions
          SET
            status = $2,
            bank_reference = $3,
            bank_name = $4,
            raw_payload = $5::jsonb,
            updated_at = NOW()
          WHERE transaction_id = $1
          `,
          [
            TransactionId,
            Status,
            BankReference ?? null,
            BankName ?? null,
            JSON.stringify(payload)
          ]
        );
      }

      // 2) Ignore non-complete states safely
      if (Status !== "Complete") {
        console.log("Webhook received but payment not complete:", Status, StatusMessage || "");
        await client.query("COMMIT");
        return res.status(200).send("IGNORED");
      }

      // 3) Check if already processed
      const processedCheck = await client.query(
        `
        SELECT processed_at
        FROM billing_transactions
        WHERE transaction_id = $1
        `,
        [TransactionId]
      );

      if (processedCheck.rows[0]?.processed_at) {
        console.log("Transaction already processed:", TransactionId);
        await client.query("COMMIT");
        return res.status(200).send("OK");
      }

      // 4) Validate plan exists
      const plan = PRICING.PLANS?.[planCode];
      if (!plan) {
        throw new Error(`Unknown plan code from TransactionReference: ${planCode}`);
      }

      // 5) Apply billing update
      await applyPlanOrCredits(client, userId, planCode);

      // 6) Optional audit log
      await client.query(
        `
        INSERT INTO usage_logs
        (user_id, action, plan_code, credits_deducted)
        VALUES ($1, $2, $3, $4)
        `,
        [userId, "ozow_payment_completed", planCode, 0]
      );

      // 7) Mark processed
      await client.query(
        `
        UPDATE billing_transactions
        SET
          processed_at = NOW(),
          updated_at = NOW()
        WHERE transaction_id = $1
        `,
        [TransactionId]
      );

      await client.query("COMMIT");

      console.log("Ozow payment processed successfully:", {
        transactionId: TransactionId,
        userId,
        planCode,
        amount: Amount,
        status: Status
      });

      return res.status(200).send("OK");
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("OZOW WEBHOOK ERROR:", err);
      return res.status(500).send("ERROR");
    } finally {
      client.release();
    }
  }
);

export default router;