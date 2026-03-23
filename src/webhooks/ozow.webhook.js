console.log("🔥🔥🔥 OZOW WEBHOOK: UNIVERSAL SYNC ACTIVE 🔥🔥🔥");

import express from "express";
import crypto from "crypto";
import pool from "../config/db.js";

const router = express.Router();

// ✅ RAW BODY CAPTURE: Essential for maintaining field order
router.use(
  express.urlencoded({
    extended: true,
    verify: (req, res, buf) => {
      req.rawBody = buf.toString();
    },
  })
);

/**
 * ✅ THE "FIX": Dynamic Field Hashing
 * Ozow's Notify Hash is built by concatenating ALL values in the order 
 * they arrive in the body (excluding the Hash key itself).
 */
function buildOzowNotifyHash(rawBody, privateKey) {
  const params = new URLSearchParams(rawBody);
  let hashString = "";

  // 1. Concat all values in order (except the Hash)
  for (const [key, value] of params.entries()) {
    if (key.toLowerCase() === "hash") continue;
    hashString += value;
  }

  // 2. Add PrivateKey at the end
  hashString += privateKey;

  // 3. Lowercase everything and hash SHA512
  const finalString = hashString.toLowerCase();
  
  console.log("DYNAMIC HASH STRING ATTEMPT:", JSON.stringify(finalString));

  return crypto
    .createHash("sha512")
    .update(finalString, "utf-8")
    .digest("hex")
    .toLowerCase();
}

router.post("/", async (req, res) => {
  const client = await pool.connect();

  try {
    console.log("=== OZOW NOTIFY RECEIVED ===");
    const payload = req.body;
    const { Status, TransactionReference, Hash, Amount, TransactionId } = payload;

    // 1. Signature Verification
    const generatedHash = buildOzowNotifyHash(req.rawBody, process.env.OZOW_PRIVATE_KEY);
    const ozowHash = String(Hash).trim().toLowerCase();

    if (generatedHash !== ozowHash) {
      console.error("❌ Hash mismatch!");
      console.error(`Expected: ${ozowHash}`);
      console.error(`Generated: ${generatedHash}`);
      return res.status(400).send("Invalid Signature");
    }

    console.log("✅ Hash verified successfully");

    // 2. Filter for 'Complete' only
    if (Status !== "Complete") {
      console.log(`⏳ Ignoring status: ${Status}`);
      return res.status(200).send("OK");
    }

    // 3. Database Operations (TransactionReference parsing)
    // Ref Format: userId_planCode_timestamp
    const parts = TransactionReference.split("_");
    const userId = parts[0];
    const planCode = parts[1];

    if (!userId || !planCode) {
      console.error("❌ Invalid Reference Format:", TransactionReference);
      return res.status(400).send("Bad Ref");
    }

    // Idempotency check: Don't double-count the same Ozow TransID
    const duplicate = await client.query(
      "SELECT id FROM payments WHERE reference = $1 OR gateway_id = $2",
      [TransactionReference, TransactionId]
    );

    if (duplicate.rowCount > 0) {
      console.log("ℹ️ Transaction already processed.");
      return res.status(200).send("OK");
    }

    await client.query("BEGIN");

    // Map your plans to credits
    let creditsToAdd = 0;
    if (planCode === "PAYG_10") creditsToAdd = 10;
    else if (planCode === "MONTHLY_25") creditsToAdd = 25;
    else if (planCode === "PRO_YEAR_UNLIMITED") creditsToAdd = 999999;

    // Update User
    await client.query(
      `UPDATE users 
       SET credits_remaining = COALESCE(credits_remaining, 0) + $1,
           subscription_status = 'active',
           plan_code = $2
       WHERE id = $3`,
      [creditsToAdd, planCode, userId]
    );

    // Record Payment
    await client.query(
      `INSERT INTO payments (user_id, reference, gateway_id, amount, status, plan_code)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, TransactionReference, TransactionId, Amount, "Complete", planCode]
    );

    await client.query("COMMIT");
    console.log(`💰 SUCCESS: Applied ${creditsToAdd} credits to User ${userId}`);

    return res.status(200).send("OK");

  } catch (err) {
    if (client) await client.query("ROLLBACK");
    console.error("🔥 Webhook Crash:", err);
    return res.status(500).send("Server Error");
  } finally {
    client.release();
  }
});

export default router;