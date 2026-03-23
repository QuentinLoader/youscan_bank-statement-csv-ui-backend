console.log("🔥🔥🔥 OZOW WEBHOOK FILE LOADED 🔥🔥🔥");

import express from "express";
import crypto from "crypto";
import pool from "../config/db.js";

const router = express.Router();

// ✅ Capture RAW BODY (Required for signature integrity)
router.use(
  express.urlencoded({
    extended: true,
    verify: (req, res, buf) => {
      req.rawBody = buf.toString();
    },
  })
);

/**
 * ✅ FIXED: Global Lowercase Notify Signature Verification
 * Ozow Notify signatures require the concatenation of specific fields, 
 * which must then be entirely lowercased before hashing.
 */
function buildNotifyHash(payload, privateKey) {
  const {
    SiteCode,
    TransactionId,
    TransactionReference,
    Status,
    Amount,
    IsTest
  } = payload;

  // The order is critical: SiteCode + TransId + TransRef + Status + Amount + IsTest + PrivateKey
  const parts = [
    SiteCode,
    TransactionId,
    TransactionReference,
    Status,
    Amount,
    IsTest,
    privateKey
  ];

  // Join original strings first, then lowercase the ENTIRE result
  const hashString = parts
    .map(v => (v === undefined || v === null ? "" : String(v)))
    .join("");

  const lowerCaseHashString = hashString.toLowerCase();

  console.log("FINAL ATTEMPT HASH STRING:", JSON.stringify(lowerCaseHashString));

  return crypto
    .createHash("sha512")
    .update(lowerCaseHashString, "utf-8")
    .digest("hex")
    .toLowerCase();
}

router.post("/", async (req, res) => {
  const client = await pool.connect();

  try {
    console.log("=== OZOW WEBHOOK RECEIVED ===");

    const payload = req.body;
    const { SiteCode, Status, TransactionReference, Hash, Amount } = payload;

    // 1. SiteCode Validation
    if (SiteCode !== process.env.OZOW_SITE_CODE) {
      console.error("❌ Invalid SiteCode");
      return res.status(400).send("Invalid site");
    }

    // 2. Verified Hash Check
    const generatedHash = buildNotifyHash(
      payload, 
      process.env.OZOW_PRIVATE_KEY
    );

    const ozowHash = String(Hash).trim().toLowerCase();

    if (generatedHash !== ozowHash) {
      console.error("❌ Hash mismatch on callback");
      console.error("Generated:", generatedHash);
      console.error("Expected: ", ozowHash);
      return res.status(400).send("Invalid signature");
    }

    console.log("✅ Hash verified");

    // 3. Status Handling (Only process 'Complete')
    if (Status !== "Complete") {
      console.log("⏳ Status is:", Status, "- No credits applied.");
      return res.status(200).send("OK");
    }

    console.log("💰 Payment success detected:", TransactionReference);

    // 4. Database Operations
    const parts = TransactionReference.split("_");
    const userId = parts[0];
    const planCode = parts[1];

    if (!userId || !planCode) {
      console.error("❌ Malformed TransactionReference:", TransactionReference);
      return res.status(400).send("Invalid reference format");
    }

    // Idempotency check: Don't process twice
    const existingPayment = await client.query(
      "SELECT id FROM payments WHERE reference = $1",
      [TransactionReference]
    );

    if (existingPayment.rowCount > 0) {
      console.log("ℹ️ Payment already processed:", TransactionReference);
      return res.status(200).send("OK");
    }

    await client.query("BEGIN");

    // Credit logic mapping
    let creditsToAdd = 0;
    if (planCode === "PAYG_10") creditsToAdd = 10;
    else if (planCode === "MONTHLY_25") creditsToAdd = 25;
    else if (planCode === "PRO_YEAR_UNLIMITED") creditsToAdd = 999999; 
    
    const userUpdate = await client.query(
      `UPDATE users 
       SET plan_code = $1, 
           credits_remaining = COALESCE(credits_remaining, 0) + $2,
           subscription_status = 'active'
       WHERE id = $3
       RETURNING id`,
      [planCode, creditsToAdd, userId]
    );

    if (userUpdate.rowCount === 0) {
      throw new Error(`User ${userId} not found during credit application`);
    }

    await client.query(
      `INSERT INTO payments (user_id, reference, plan_code, amount, status)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, TransactionReference, planCode, Amount, "Complete"]
    );

    await client.query("COMMIT");
    console.log(`✅ Success: ${creditsToAdd} credits applied to User ${userId}`);

    return res.status(200).send("OK");

  } catch (err) {
    if (client) await client.query("ROLLBACK");
    console.error("🔥 Ozow Webhook Error:", err);
    return res.status(500).send("Internal Server Error");
  } finally {
    client.release();
  }
});

export default router;