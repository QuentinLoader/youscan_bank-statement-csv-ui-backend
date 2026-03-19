console.log("🔥🔥🔥 OZOW WEBHOOK FILE LOADED 🔥🔥🔥");

import express from "express";
import crypto from "crypto";

const router = express.Router();

// ✅ Helper: Safe string (handles undefined/null EXACTLY like Ozow expects)
function safe(val) {
  return val === undefined || val === null ? "" : String(val).trim();
}

// ✅ Generate Ozow Webhook Hash (CORRECT ORDER)
function generateOzowWebhookHash(data, privateKey) {
  const hashString =
    safe(data.SiteCode) +
    safe(data.TransactionId) +
    safe(data.TransactionReference) +
    safe(data.Amount) +
    safe(data.Status) +
    safe(data.Optional1) +
    safe(data.Optional2) +
    safe(data.Optional3) +
    safe(data.Optional4) +
    safe(data.Optional5) +
    safe(data.CurrencyCode) +
    safe(data.IsTest) +
    safe(privateKey);

  console.log("WEBHOOK HASH STRING:", hashString);

  return crypto
    .createHash("sha512")
    .update(hashString, "utf-8")
    .digest("hex")
    .toLowerCase(); // ✅ normalize
}

// ✅ Use URL-encoded parser (Ozow format)
router.post(
  "/",
  express.urlencoded({ extended: true }),
  async (req, res) => {
    try {
      console.log("=== OZOW WEBHOOK RECEIVED ===");

      const payload = req.body;
      console.log("WEBHOOK DATA:", payload);

      const {
        SiteCode,
        TransactionId,
        TransactionReference,
        Amount,
        Status,
        Hash
      } = payload;

      // =========================
      // ✅ 1. BASIC VALIDATION
      // =========================
      if (SiteCode !== process.env.OZOW_SITE_CODE) {
        console.error("❌ Invalid SiteCode");
        return res.status(400).send("Invalid site");
      }

      if (!Hash) {
        console.error("❌ Missing Hash");
        return res.status(400).send("Missing hash");
      }

      // =========================
      // ✅ 2. HASH VERIFICATION
      // =========================
      const generatedHash = generateOzowWebhookHash(
        payload,
        process.env.OZOW_PRIVATE_KEY
      );

      console.log("GENERATED HASH:", generatedHash);
      console.log("OZOW HASH:", String(Hash).toLowerCase());

      if (generatedHash !== String(Hash).toLowerCase()) {
        console.error("❌ Hash mismatch");
        return res.status(400).send("Invalid signature");
      }

      console.log("✅ Hash verified");

      // =========================
      // ✅ 3. ONLY PROCESS SUCCESS
      // =========================
      if (Status !== "Complete") {
        console.log("⏳ Ignoring non-complete status:", Status);
        return res.status(200).send("Ignored");
      }

      console.log("💰 Payment successful:", TransactionReference);

      // =========================
      // ✅ 4. TODO: BILLING LOGIC
      // =========================
      // Example placeholder:
      // await applyBilling(TransactionReference, Amount);

      return res.status(200).send("OK");

    } catch (err) {
      console.error("🔥 Ozow Webhook Error:", err);
      return res.status(500).send("Server error");
    }
  }
);

export default router;