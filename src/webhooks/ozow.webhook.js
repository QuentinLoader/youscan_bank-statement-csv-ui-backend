console.log("🔥🔥🔥 OZOW WEBHOOK FILE LOADED 🔥🔥🔥");

import express from "express";
import crypto from "crypto";

const router = express.Router();

// ✅ Normalize amount (safe to keep)
function normalizeAmount(amount) {
  return parseFloat(amount).toString();
}

// ✅ FINAL CORRECT HASH (FULL FORMAT)
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

  const hashString = parts.map(v => String(v).trim()).join("");

  console.log("HASH PARTS:", parts);
  console.log("WEBHOOK HASH STRING:", JSON.stringify(hashString));

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

      // ✅ Generate hash
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

      // ✅ Only process success
      if (Status !== "Complete") {
        console.log("⏳ Ignoring:", Status);
        return res.status(200).send("Ignored");
      }

      console.log("💰 Payment success:", TransactionReference);

      // 🚀 NEXT: billing logic
      // await applyBilling(TransactionReference, Amount);

      return res.status(200).send("OK");

    } catch (err) {
      console.error("🔥 Ozow Webhook Error:", err);
      return res.status(500).send("Server error");
    }
  }
);

export default router;