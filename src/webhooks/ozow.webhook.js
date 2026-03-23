import express from "express";
import { authenticateUser } from "../middleware/auth.middleware.js";
import { PRICING } from "../config/pricing.js";
import crypto from "crypto";

const router = express.Router();

// ✅ STRICT Ozow payment request hash (CORRECT ORDER)
function generateOzowRequestHash(data, privateKey) {
  const parts = [
    data.SiteCode,
    data.CountryCode,
    data.CurrencyCode,
    data.Amount,
    data.TransactionReference,
    data.BankReference,
    data.CancelURL,
    data.ErrorURL,
    data.SuccessURL,
    data.NotifyURL,
    data.IsTest,
    privateKey
  ];

  const hashString = parts
    .map(v => (v === undefined || v === null ? "" : String(v)))
    .join("");

  // 🔴 THE FIX: Convert the entire string to lowercase BEFORE hashing
  const lowerCaseHashString = hashString.toLowerCase();

  console.log("REQUEST HASH STRING (LOWERCASED):", JSON.stringify(lowerCaseHashString));

  return crypto
    .createHash("sha512")
    .update(lowerCaseHashString, "utf-8")
    .digest("hex")
    .toLowerCase();
}

router.post(
  "/create-ozow-payment",
  authenticateUser,
  async (req, res) => {
    try {
      const { planCode } = req.body;

      if (!planCode) {
        return res.status(400).json({ error: "Plan code required" });
      }

      const plan = PRICING.PLANS[planCode];

      if (!plan) {
        return res.status(400).json({ error: "Invalid plan" });
      }

      const user = req.user;

      if (!user || !user.userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const siteCode = process.env.OZOW_SITE_CODE;
      const privateKey = process.env.OZOW_PRIVATE_KEY;

      if (!siteCode || !privateKey) {
        return res.status(500).json({ error: "Payment configuration error" });
      }

      // ✅ Amount MUST be string with 2 decimals
      const amount = (plan.price_cents / 100).toFixed(2);

      // ✅ Transaction reference (used later in webhook)
      const transactionReference = `${user.userId}_${planCode}_${Date.now()}`;

      // ✅ Bank reference (max 20 chars)
      const bankReference = `YS-${Date.now().toString().slice(-10)}`;
      console.log("BankReference:", bankReference, "Length:", bankReference.length);

      const payload = {
        SiteCode: String(siteCode).trim(),
        CountryCode: "ZA",
        CurrencyCode: String(PRICING.currency).trim(),
        Amount: String(amount).trim(),
        TransactionReference: String(transactionReference).trim(),
        BankReference: String(bankReference).trim(),
        CancelURL: "https://youscan.addvision.co.za/payment-cancelled",
        ErrorURL: "https://youscan.addvision.co.za/payment-error",
        SuccessURL: "https://youscan.addvision.co.za/payment-return",
        NotifyURL:
          "https://youscan-statement-csv-ui-backend-production.up.railway.app/ozow/webhook",
        IsTest: "true", // ✅ MUST be lowercase for request
      };

      // 🔍 DEBUG — exact payload
      console.log("FORM VALUES:");
      console.log(JSON.stringify(payload, null, 2));

      // ✅ Generate hash
      const hashCheck = generateOzowRequestHash(payload, privateKey);

      console.log("OZOW REQUEST HASH:", hashCheck);

      // ✅ Auto-submit form
      const paymentForm = `
        <html>
          <body onload="document.forms[0].submit()">
            <form method="post" action="https://pay.ozow.com">
              <input type="hidden" name="SiteCode" value="${payload.SiteCode}" />
              <input type="hidden" name="CountryCode" value="${payload.CountryCode}" />
              <input type="hidden" name="CurrencyCode" value="${payload.CurrencyCode}" />
              <input type="hidden" name="Amount" value="${payload.Amount}" />
              <input type="hidden" name="TransactionReference" value="${payload.TransactionReference}" />
              <input type="hidden" name="BankReference" value="${payload.BankReference}" />
              <input type="hidden" name="CancelURL" value="${payload.CancelURL}" />
              <input type="hidden" name="ErrorURL" value="${payload.ErrorURL}" />
              <input type="hidden" name="SuccessURL" value="${payload.SuccessURL}" />
              <input type="hidden" name="NotifyURL" value="${payload.NotifyURL}" />
              <input type="hidden" name="IsTest" value="${payload.IsTest}" />
              <input type="hidden" name="HashCheck" value="${hashCheck}" />
            </form>
          </body>
        </html>
      `;

      return res.send(paymentForm);

    } catch (err) {
      console.error("CREATE OZOW PAYMENT ERROR:", err);
      return res.status(500).json({ error: "Failed to create payment" });
    }
  }
);

export default router;