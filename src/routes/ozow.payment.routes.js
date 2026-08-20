import express from "express";
import pool from "../config/db.js";
import { authenticateUser } from "../middleware/auth.middleware.js";
import { PRICING } from "../config/pricing.js";
import { generateOzowRequestHash } from "../utils/ozowSecurity.js";

const router = express.Router();

function escapeHtmlAttribute(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

router.post("/create-ozow-payment", authenticateUser, async (req, res) => {
  try {
    const { planCode } = req.body;

    if (!planCode) {
      return res.status(400).json({ error: "Plan code required" });
    }

    const plan = PRICING.PLANS[planCode];
    if (!plan || Number(plan.price_cents || 0) <= 0) {
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

    await pool.query(
      `UPDATE ozow_transactions
       SET status = 'Expired', processed_at = NOW(), updated_at = NOW()
       WHERE user_id = $1
         AND status IN ('Pending', 'Initiated')
         AND processed_at IS NULL
         AND created_at <= NOW() - INTERVAL '15 minutes'`,
      [user.userId]
    );

    const existingPayment = await pool.query(
      `SELECT id, transaction_reference, plan_code, created_at, status
       FROM ozow_transactions
       WHERE user_id = $1
         AND status IN ('Pending', 'Initiated')
         AND processed_at IS NULL
         AND created_at > NOW() - INTERVAL '15 minutes'
       ORDER BY created_at DESC
       LIMIT 1`,
      [user.userId]
    );

    if (existingPayment.rows.length > 0) {
      return res.status(400).json({
        error: "PAYMENT_ALREADY_PENDING",
        message: "You already have a payment in progress. Please complete it first.",
        transactionReference: existingPayment.rows[0].transaction_reference,
        planCode: existingPayment.rows[0].plan_code,
      });
    }

    const amount = (plan.price_cents / 100).toFixed(2);
    const nowMs = Date.now();
    const transactionReference = `${user.userId}_${planCode}_${nowMs}`;
    const bankReference = `YS-${String(nowMs).slice(-10)}`;

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
      NotifyURL: "https://youscan-statement-csv-ui-backend-production.up.railway.app/ozow/webhook",
      IsTest: "false",
    };

    const hashCheck = generateOzowRequestHash(payload, privateKey);

    // Never log the private key, hash input, HashCheck, or full payment payload.
    console.log("Ozow payment initiated", {
      transactionReference,
      planCode,
      userId: user.userId,
    });

    await pool.query(
      `INSERT INTO ozow_transactions (
         user_id, transaction_reference, transaction_id, plan_code, amount,
         currency_code, status, raw_payload, created_at, updated_at
       )
       VALUES ($1, $2, $2, $3, $4, $5, 'Pending', $6::jsonb, NOW(), NOW())`,
      [
        user.userId,
        transactionReference,
        planCode,
        amount,
        "ZAR",
        JSON.stringify(payload),
      ]
    );

    const inputs = { ...payload, HashCheck: hashCheck };
    const hiddenInputs = Object.entries(inputs)
      .map(
        ([name, value]) =>
          `<input type="hidden" name="${escapeHtmlAttribute(name)}" value="${escapeHtmlAttribute(value)}" />`
      )
      .join("\n            ");

    const paymentForm = `
      <html>
        <body onload="document.forms[0].submit()">
          <form method="post" action="https://pay.ozow.com" target="_top">
            ${hiddenInputs}
          </form>
        </body>
      </html>
    `;

    return res.send(paymentForm);
  } catch (err) {
    console.error("CREATE OZOW PAYMENT ERROR:", err?.code || err?.message || "unknown");
    return res.status(500).json({ error: "Failed to create payment" });
  }
});

export default router;
