console.log("🔥🔥🔥 OZOW WEBHOOK FILE LOADED 🔥🔥🔥");

import express from "express";
import crypto from "crypto";

const router = express.Router();

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

      // ✅ Basic validation
      if (SiteCode !== process.env.OZOW_SITE_CODE) {
        console.error("Invalid SiteCode");
        return res.status(400).send("Invalid site");
      }

      // ✅ FORCE STRING CONSISTENCY (critical)
      const stringToHash =
        String(SiteCode).trim() +
        String(TransactionId).trim() +
        String(TransactionReference).trim() +
        String(Amount).trim() +
        String(Status).trim() +
        String(payload.IsTest).trim() +   // 🔥 CRITICAL FIX
        String(process.env.OZOW_PRIVATE_KEY).trim();

      console.log("WEBHOOK HASH STRING:", stringToHash);

      const generatedHash = crypto
        .createHash("sha512")
        .update(stringToHash, "utf-8")
        .digest("hex");

      console.log("GENERATED HASH:", generatedHash);
      console.log("OZOW HASH:", Hash);

      // ✅ Verify signature
      if (generatedHash !== Hash) {
        console.error("Hash mismatch ❌");
        return res.status(400).send("Invalid signature");
      }

      console.log("Hash verified ✅");

      // ✅ Only process successful payments
      if (Status !== "Complete") {
        console.log("Ignoring non-complete status:", Status);
        return res.status(200).send("Ignored");
      }

      console.log("Payment successful for:", TransactionReference);

      // 🚀 TODO: update user / credits here

      return res.status(200).send("OK");

    } catch (err) {
      console.error("Ozow Webhook Error:", err);
      return res.status(500).send("Server error");
    }
  }
);

export default router;