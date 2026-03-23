import express from "express";
import crypto from "crypto";
import pool from "../config/db.js";

const router = express.Router();

const getPrice = (planCode) => {
  const prices = {
    'PAYG_10': 5.00,
    'MONTHLY_25': 25.00,
    'PRO_YEAR_UNLIMITED': 250.00
  };
  return prices[planCode] || null;
};

router.post("/create-ozow-payment", async (req, res) => {
  try {
    const { planCode, userId } = req.body; // 👈 Now receiving both from frontend
    const amount = getPrice(planCode);

    if (!amount || !userId) {
      console.error("❌ Validation Failed:", { planCode, userId });
      return res.status(400).json({ error: "INVALID_REQUEST_DATA" });
    }

    const siteCode = process.env.OZOW_SITE_CODE;
    const privateKey = process.env.OZOW_PRIVATE_KEY;
    
    // Unique reference: userId_plan_timestamp
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
      IsTest: true 
    };

    const hashString = (
      payload.SiteCode + payload.CountryCode + payload.CurrencyCode +
      payload.Amount + payload.TransactionReference + payload.BankReference +
      payload.CancelUrl + payload.ErrorUrl + payload.SuccessUrl +
      payload.NotifyUrl + payload.IsTest + privateKey
    ).toLowerCase();

    const hash = crypto.createHash("sha512").update(hashString).digest("hex");

    console.log(`✅ Payment Link Generated for User ${userId} (${planCode})`);

    res.status(200).json({
      ...payload,
      Hash: hash
    });

  } catch (error) {
    console.error("❌ Ozow Error:", error);
    res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
  }
});

export default router;