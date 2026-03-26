import express from "express";
import crypto from "crypto";
import pool from "../config/db.js";
import { authenticateUser } from "../middleware/auth.middleware.js";
import { PRICING } from "../config/pricing.js";

const router = express.Router();

function generateOzowRequestHash(data, privateKey) {
  const parts = [
    data.SiteCode,
    data.CountryCode,
    data.CurrencyCode,
    data.Amount,
    data.TransactionReference,
    data.BankReference,

    data.Optional1,
    data.Optional2,
    data.Optional3,
    data.Optional4,
    data.Optional5,
    data.Customer,

    data.CancelURL,
    data.ErrorURL,
    data.SuccessURL,
    data.NotifyURL,
    data.IsTest,
    privateKey
  ];

  const normalizedParts = parts.map((v) =>
    v === undefined || v === null ? "" : String(v)
  );

  const rawString = normalizedParts.join("");
  const hashString = rawString.toLowerCase();

  console.log("REQUEST HASH PARTS:");
  normalizedParts.forEach((p, i) => {
    console.log(`${i}: "${p}"`);
  });

  console.log("REQUEST RAW STRING:", JSON.stringify(rawString));
  console.log("REQUEST HASH STRING:", JSON.stringify(hashString));

  return crypto
    .createHash("sha512")
    .update(hashString, "utf-8")
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

      // 1) Expire old stuck payments first
      await pool.query(
        `
        UPDATE ozow_transactions
        SET status = 'Expired',
            processed_at = NOW()
        WHERE user_id = $1
          AND processed_at IS NULL
          AND created_at <= NOW() - INTERVAL '15 minutes'
        `,
        [user.userId]
      );

      // 2) Only block on a recent active payment
      const existingPayment = await pool.query(
        `
        SELECT id, transaction_reference, plan_code, created_at, status
        FROM ozow_transactions
        WHERE user_id = $1
          AND processed_at IS NULL
          AND created_at > NOW() - INTERVAL '15 minutes'
          AND COALESCE(status, 'Pending') NOT IN ('Complete', 'Cancelled', 'Expired', 'Failed')
        ORDER BY created_at DESC
        LIMIT 1
        `,
        [user.userId]
      );

      if (existingPayment.rows.length > 0) {
        return res.status(400).json({
          error: "PAYMENT_ALREADY_PENDING",
          message: "You already have a payment in progress. Please complete it first.",
          transactionReference: existingPayment.rows[0].transaction_reference,
          planCode: existingPayment.rows[0].plan_code
        });
      }

      const amount = (plan.price_cents / 100).toFixed(2);
      const nowMs = Date.now();
      const transactionReference = `${user.userId}_${planCode}_${nowMs}`;
      const bankReference = `YS-${String(nowMs).slice(-10)}`;

      console.log("BankReference:", bankReference, "Length:", bankReference.length);

      const payload = {
        SiteCode: String(siteCode).trim(),
        CountryCode: "ZA",
        CurrencyCode: String(PRICING.currency).trim(),
        Amount: String(amount).trim(),
        TransactionReference: String(transactionReference).trim(),
        BankReference: String(bankReference).trim(),

        Optional1: "",
        Optional2: "",
        Optional3: "",
        Optional4: "",
        Optional5: "",
        Customer: "",

        CancelURL: "https://youscan.addvision.co.za/payment-cancelled",
        ErrorURL: "https://youscan.addvision.co.za/payment-error",
        SuccessURL: "https://youscan.addvision.co.za/payment-return",
        NotifyURL:
          "https://youscan-statement-csv-ui-backend-production.up.railway.app/ozow/webhook",

        IsTest: "false"
      };

      console.log("FORM VALUES:");
      console.log(JSON.stringify(payload, null, 2));

      const hashCheck = generateOzowRequestHash(payload, privateKey);

      console.log("OZOW REQUEST HASH:", hashCheck);

      // 3) Record pending transaction before redirecting to Ozow
      await pool.query(
        `
        INSERT INTO ozow_transactions (
          user_id,
          transaction_reference,
          transaction_id,
          plan_code,
          amount,
          currency_code,
          status,
          raw_payload,
          created_at,
          updated_at
      )
        VALUES ($1, $2, $2, $3, $4, 'ZAR', 'Pending', NOW(), NOW())
        `,
        [user.userId, transactionReference, planCode, amount,JSON.stringify(payload)]
      );

      const paymentForm = `
        <html>
          <body onload="document.forms[0].submit()">
            <form method="post" action="https://pay.ozow.com" target="_top">
              <input type="hidden" name="SiteCode" value="${payload.SiteCode}" />
              <input type="hidden" name="CountryCode" value="${payload.CountryCode}" />
              <input type="hidden" name="CurrencyCode" value="${payload.CurrencyCode}" />
              <input type="hidden" name="Amount" value="${payload.Amount}" />
              <input type="hidden" name="TransactionReference" value="${payload.TransactionReference}" />
              <input type="hidden" name="BankReference" value="${payload.BankReference}" />

              <input type="hidden" name="Optional1" value="${payload.Optional1}" />
              <input type="hidden" name="Optional2" value="${payload.Optional2}" />
              <input type="hidden" name="Optional3" value="${payload.Optional3}" />
              <input type="hidden" name="Optional4" value="${payload.Optional4}" />
              <input type="hidden" name="Optional5" value="${payload.Optional5}" />
              <input type="hidden" name="Customer" value="${payload.Customer}" />

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