import express from "express";
import crypto from "crypto";
import pool from "../config/db.js";

const router = express.Router();

/**
 * ✅ CREATE OZOW PAYMENT
 * POST /billing/create-ozow-payment
 */
router.post("/create-ozow-payment", async (req, res) => {
  try {
    const { amount, planCode, userId } = req.body;
    
    if (!amount || !planCode || !userId) {
      return res.status(400).json({ error: "MISSING_REQUIRED_FIELDS" });
    }

    const siteCode = process.env.OZOW_SITE_CODE;
    const privateKey = process.env.OZOW_PRIVATE_KEY;
    
    // Format: userId_planCode_timestamp
    const bankReference = `${userId}_${planCode}_${Date.now()}`;
    
    const payload = {
      SiteCode: siteCode,
      CountryCode: "ZA",
      CurrencyCode: "ZAR",
      Amount: parseFloat(amount).toFixed(2),
      TransactionReference: bankReference,
      BankReference: bankReference,
      CancelUrl: `https://youscan.addvision.co.za/payment-cancelled`,
      ErrorUrl: `https://youscan.addvision.co.za/payment-error`,
      SuccessUrl: `https://youscan.addvision.co.za/payment-return`,
      NotifyUrl: `https://youscan-statement-csv-ui-backend-production.up.railway.app/ozow/webhook`,
      IsTest: true // 🔥 CHANGE TO false FOR LIVE PAYMENTS
    };

    // Strict order concatenation for Request Hash
    const hashString = (
      payload.SiteCode +
      payload.CountryCode +
      payload.CurrencyCode +
      payload.Amount +
      payload.TransactionReference +
      payload.BankReference +
      payload.CancelUrl +
      payload.ErrorUrl +
      payload.SuccessUrl +
      payload.NotifyUrl +
      payload.IsTest +
      privateKey
    ).toLowerCase();

    const hash = crypto.createHash("sha512").update(hashString).digest("hex");

    res.status(200).json({
      ...payload,
      Hash: hash
    });

  } catch (error) {
    console.error("❌ Failed to initiate Ozow payment:", error);
    res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
  }
});

/**
 * ✅ CHECK STATUS (Optional helper for frontend)
 * GET /billing/status/:reference
 */
router.get("/status/:reference", async (req, res) => {
  try {
    const { reference } = req.params;
    const result = await pool.query(
      "SELECT * FROM payments WHERE external_reference = $1",
      [reference]
    );

    if (result.rowCount > 0) {
      res.json({ status: "Complete", payment: result.rows[0] });
    } else {
      res.json({ status: "Pending" });
    }
  } catch (err) {
    res.status(500).json({ error: "DB_ERROR" });
  }
});

export default router;