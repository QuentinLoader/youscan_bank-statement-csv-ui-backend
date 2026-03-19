console.log("🔥🔥🔥 OZOW WEBHOOK FILE LOADED 🔥🔥🔥");

import express from "express";
import crypto from "crypto";

const router = express.Router();

// ✅ Capture RAW BODY (CRITICAL)
router.use(
  express.urlencoded({
    extended: true,
    verify: (req, res, buf) => {
      req.rawBody = buf.toString();
    }
  })
);

// ✅ Extract values in original order from raw body
function buildHashFromRawBody(rawBody, privateKey) {
  const params = new URLSearchParams(rawBody);

  let hashString = "";

  for (const [key, value] of params.entries()) {
    if (key === "Hash") continue; // ❌ exclude hash itself
    hashString += value;
  }

  hashString += privateKey;

  console.log("RAW HASH STRING:", JSON.stringify(hashString));

  return crypto
    .createHash("sha512")
    .update(hashString, "utf-8")
    .digest("hex")
    .toLowerCase();
}

router.post("/", async (req, res) => {
  try {
    console.log("=== OZOW WEBHOOK RECEIVED ===");

    const payload = req.body;
    console.log("WEBHOOK DATA:", payload);

    const { SiteCode, Status, TransactionReference, Hash } = payload;

    // ✅ Validate site
    if (SiteCode !== process.env.OZOW_SITE_CODE) {
      console.error("❌ Invalid SiteCode");
      return res.status(400).send("Invalid site");
    }

    if (!Hash) {
      console.error("❌ Missing Hash");
      return res.status(400).send("Missing hash");
    }

    // ✅ Generate hash from RAW body
    const generatedHash = buildHashFromRawBody(
      req.rawBody,
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

    // 🚀 NEXT STEP
    // await applyBilling(TransactionReference);

    return res.status(200).send("OK");

  } catch (err) {
    console.error("🔥 Ozow Webhook Error:", err);
    return res.status(500).send("Server error");
  }
});

export default router;