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

  const normalizedParts = parts.map((v) =>
    v === undefined || v === null ? "" : String(v)
  );

  const rawString = normalizedParts.join("");
  const hashString = rawString;

  console.log("WEBHOOK HASH PARTS:");
  normalizedParts.forEach((p, i) => {
    console.log(`${i}: "${p}"`);
  });

  console.log("WEBHOOK RAW STRING:", JSON.stringify(rawString));
  console.log("WEBHOOK HASH STRING:", JSON.stringify(hashString));

  return crypto
    .createHash("sha512")
    .update(hashString, "utf-8")
    .digest("hex")
    .toLowerCase();
}

function parseTransactionReference(reference) {
  const firstUnderscore = reference.indexOf("_");
  const lastUnderscore = reference.lastIndexOf("_");

  if (
    firstUnderscore === -1 ||
    lastUnderscore === -1 ||
    firstUnderscore === lastUnderscore
  ) {
    throw new Error(`Invalid TransactionReference format: ${reference}`);
  }

  const userId = reference.slice(0, firstUnderscore);
  const planCode = reference.slice(firstUnderscore + 1, lastUnderscore);

  return { userId, planCode };
}

async function applyPlanOrCredits(client, userId, planCode) {
  if (planCode === "PAYG_10") {
    await client.query(
      `
      UPDATE users
      SET plan_code = $2,
          credits_remaining = COALESCE(credits_remaining, 0) + 10
      WHERE id = $1
      `,
      [Number(userId), planCode]
    );
    return;
  }

  if (planCode === "MONTHLY_25") {
    await client.query(
      `
      UPDATE users
      SET plan_code = $2,
          credits_remaining = 25
      WHERE id = $1
      `,
      [Number(userId), planCode]
    );
    return;
  }

  if (planCode === "PRO_YEAR_UNLIMITED") {
    await client.query(
      `
      UPDATE users
      SET plan_code = $2,
          credits_remaining = NULL
      WHERE id = $1
      `,
      [Number(userId), planCode]
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

      const isTest = String(payload.IsTest || "").toLowerCase() === "true";

      const expectedHash = generateOzowWebhookHash(payload, privateKey);
      const receivedHash = String(payload.Hash || "").toLowerCase();

      console.log("EXPECTED HASH:", expectedHash);
      console.log("RECEIVED HASH:", receivedHash);

      if (!isTest) {
        if (expectedHash !== receivedHash) {
          console.error("⚠️ Hash mismatch (LIVE) — continuing processing");
        }
      } else {
        console.log("Sandbox callback — skipping strict hash enforcement");
        if (expectedHash !== receivedHash) {
          console.warn("SANDBOX HASH MISMATCH DETECTED");
        } else {
          console.log("Sandbox hash verified successfully");
        }
      }

      const {
        TransactionId,
        TransactionReference,
        BankReference,
        Amount,
        Status,
        CurrencyCode,
        BankName
      } = payload;

      if (!TransactionReference) {
        console.error("Missing TransactionReference");
        return res.status(400).send("MISSING_TRANSACTION_REFERENCE");
      }

      const { userId, planCode } = parseTransactionReference(TransactionReference);

      await client.query("BEGIN");

      // Lock by OUR stable key: transaction_reference
      const existingTx = await client.query(
        `
        SELECT id, processed_at, status
        FROM ozow_transactions
        WHERE transaction_reference = $1
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE
        `,
        [TransactionReference]
      );

      if (existingTx.rowCount === 0) {
        // Fallback only if the create-payment row somehow never got inserted
        await client.query(
          `
          INSERT INTO ozow_transactions (
            transaction_id,
            transaction_reference,
            user_id,
            plan_code,
            amount,
            currency_code,
            status,
            bank_reference,
            bank_name,
            raw_payload,
            processed_at,
            created_at,
            updated_at
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,NOW(),NOW())
          `,
          [
            TransactionId || TransactionReference,
            TransactionReference,
            Number(userId),
            planCode,
            normalizeAmount(Amount),
            CurrencyCode || "ZAR",
            Status,
            BankReference ?? null,
            BankName ?? null,
            JSON.stringify(payload),
            Status === "Complete" || Status === "Cancelled" || Status === "Failed"
              ? new Date()
              : null
          ]
        );
      } else {
        if (existingTx.rows[0].processed_at && Status === "Complete") {
          console.log("Already processed — skipping");
          await client.query("COMMIT");
          return res.status(200).send("OK");
        }

        await client.query(
          `
          UPDATE ozow_transactions
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
          WHERE transaction_reference = $1
          `,
          [
            TransactionReference,
            TransactionId || TransactionReference,
            Status,
            normalizeAmount(Amount),
            CurrencyCode || "ZAR",
            BankReference ?? null,
            BankName ?? null,
            JSON.stringify(payload)
          ]
        );
      }

      if (Status !== "Complete") {
        console.log("Not complete:", Status);
        await client.query("COMMIT");
        return res.status(200).send("IGNORED");
      }

      const plan = PRICING.PLANS?.[planCode];
      if (!plan) {
        throw new Error(`Invalid plan: ${planCode}`);
      }

      await applyPlanOrCredits(client, userId, planCode);

      await client.query(
        `
        UPDATE ozow_transactions
        SET processed_at = COALESCE(processed_at, NOW()),
            updated_at = NOW()
        WHERE transaction_reference = $1
        `,
        [TransactionReference]
      );

      await client.query("COMMIT");

      console.log("✅ Payment applied:", TransactionReference);

      return res.status(200).send("OK");
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("WEBHOOK ERROR:", err);
      return res.status(500).send("ERROR");
    } finally {
      client.release();
    }
  }
);

export default router;