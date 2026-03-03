import express from "express";
import crypto from "crypto";
import { authenticateUser } from "../middleware/auth.middleware.js";
import { PRICING } from "../config/pricing.js";

const router = express.Router();

/*
=========================================
CREATE OZOW PAYMENT
POST /billing/create-ozow-payment
=========================================
*/
router.post(
  "/create-ozow-payment",
  authenticateUser,
  async (req, res) => {
    try {
      const { planCode } = req.body;

      if (!planCode) {
        return res.status(400).json({ error: "Plan code required" });
      }

      const plan = PRICING[planCode];

      if (!plan) {
        return res.status(400).json({ error: "Invalid plan" });
      }

      const user = req.userRecord;

      // SERVER-CONTROLLED AMOUNT
     const amount = Number(plan.price).toFixed(2);

      const transactionReference = `${user.id}_${plan.code}_${Date.now()}`;
      const bankReference = `YOUSCAN-${Date.now()}`;

      const successUrl = "https://youscan.addvision.co.za/payment-return";
      const cancelUrl = "https://youscan.addvision.co.za/payment-cancelled";
      const errorUrl = "https://youscan.addvision.co.za/payment-error";
      const notifyUrl =
        "https://youscan-statement-csv-ui-backend-production.up.railway.app/ozow/webhook";

      const siteCode = process.env.OZOW_SITE_CODE;
      const privateKey = process.env.OZOW_PRIVATE_KEY;

      /*
      =========================================
      HASH GENERATION (CRITICAL)
      =========================================
      */

      const stringToHash =
        siteCode +
        "ZA" +
        "ZAR" +
        amount +
        transactionReference +
        bankReference +
        cancelUrl +
        errorUrl +
        successUrl +
        notifyUrl +
        privateKey;

      const hashCheck = crypto
        .createHash("sha512")
        .update(stringToHash)
        .digest("hex");

      /*
      =========================================
      RETURN AUTO-SUBMIT FORM
      =========================================
      */

      const paymentForm = `
        <html>
          <body onload="document.forms[0].submit()">
            <form method="post" action="https://pay.ozow.com">
              <input type="hidden" name="SiteCode" value="${siteCode}" />
              <input type="hidden" name="CountryCode" value="ZA" />
              <input type="hidden" name="CurrencyCode" value="ZAR" />
              <input type="hidden" name="Amount" value="${amount}" />
              <input type="hidden" name="TransactionReference" value="${transactionReference}" />
              <input type="hidden" name="BankReference" value="${bankReference}" />
              <input type="hidden" name="CancelURL" value="${cancelUrl}" />
              <input type="hidden" name="ErrorURL" value="${errorUrl}" />
              <input type="hidden" name="SuccessURL" value="${successUrl}" />
              <input type="hidden" name="NotifyURL" value="${notifyUrl}" />
              <input type="hidden" name="IsTest" value="false" />
              <input type="hidden" name="HashCheck" value="${hashCheck}" />
            </form>
          </body>
        </html>
      `;

      res.send(paymentForm);

    } catch (err) {
      console.error("CREATE OZOW PAYMENT ERROR:", err);
      res.status(500).json({ error: "Failed to create payment" });
    }
  }
);

export default router;