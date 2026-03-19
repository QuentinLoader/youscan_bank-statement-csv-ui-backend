console.log("🔥🔥🔥 OZOW WEBHOOK FILE LOADED 🔥🔥🔥");

import express from "express";
import crypto from "crypto";

const router = express.Router();

// ✅ Generate Ozow Webhook Hash (STRICT + EXPLICIT ORDER)
function generateOzowWebhookHash(data, privateKey) {
  const hashParts = [
    data.SiteCode,
    data.TransactionId,
    data.TransactionReference,
    data.Amount,
    data.Status,

    // ✅ MUST be included EVEN if empty
    data.Optional1 || "",
    data.Optional2 || "",
    data.Optional3 || "",
    data.Optional4 || "",
    data.Optional5 || "",

    data.CurrencyCode,
    data.IsTest,

    privateKey
  ];

  // ✅ Force exact formatting
  const hashString = hashParts.map(v => String(v).trim()).join("");

  console.log("HASH PARTS:", hashParts);
  console.log("WEBHOOK HASH STRING:", hashString);

  return crypto
    .createHash("sha512")
    .update(hashString, "utf-8")
    .digest("hex")
    .toLowerCase();
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

      const ozowHash = String(Hash).trim().toLowerCase();

      console.log("GENERATED HASH:", generatedHash);
      console.log("OZOW HASH:", ozowHash);

      if (generatedHash !== ozowHash) {
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
      // ✅ 4. BILLING PLACEHOLDER
      // =========================
      // 🔜 Next step:
      // await applyBilling(TransactionReference, Amount);

      return res.status(200).send("OK");

    } catch (err) {
      console.error("🔥 Ozow Webhook Error:", err);
      return res.status(500).send("Server error");
    }
  }
);

export default router;