console.log("🔥🔥🔥 OZOW WEBHOOK FILE LOADED 🔥🔥🔥");

import express from "express";
import crypto from "crypto";

const router = express.Router();

// ✅ CORRECT Ozow webhook hash (FINAL)
function generateOzowWebhookHash(data, privateKey) {
  const hashString =
    String(data.SiteCode).trim() +
    String(data.TransactionId).trim() +
    String(data.TransactionReference).trim() +
    String(data.Amount).trim() +
    String(data.Status).trim() +
    String(privateKey).trim();

  console.log("WEBHOOK HASH STRING:", hashString);

  return crypto
    .createHash("sha512")
    .update(hashString, "utf-8")
    .digest("hex")
    .toLowerCase();
}

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

      // ✅ Validate site
      if (SiteCode !== process.env.OZOW_SITE_CODE) {
        console.error("❌ Invalid SiteCode");
        return res.status(400).send("Invalid site");
      }

      if (!Hash) {
        console.error("❌ Missing Hash");
        return res.status(400).send("Missing hash");
      }

      // ✅ Verify hash
      const generatedHash = generateOzowWebhookHash(
        payload,
        process.env.OZOW_PRIVATE_KEY
      );

      const ozowHash = String(Hash).trim().toLowerCase();

      console.log("GENERATED HASH:", generatedHash);
      console.log("OZOW HASH:", ozowHash);

      if (generatedHash !== ozowHash) {
        console.error("❌ Hash mismatch");
        return res.status(400).send("Invalid signature");
      }

      console.log("✅ Hash verified");

      // ✅ Only process successful payments
      if (Status !== "Complete") {
        console.log("⏳ Ignoring:", Status);
        return res.status(200).send("Ignored");
      }

      console.log("💰 Payment success:", TransactionReference);

      // 🚀 NEXT STEP: billing logic
      // await applyBilling(TransactionReference, Amount);

      return res.status(200).send("OK");

    } catch (err) {
      console.error("🔥 Ozow Webhook Error:", err);
      return res.status(500).send("Server error");
    }
  }
);

export default router;