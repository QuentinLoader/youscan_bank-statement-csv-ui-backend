import express from "express";
import pool from "../config/db.js";
import { authenticateUser } from "../middleware/auth.middleware.js";
import billingMiddleware from "../middleware/billing.middleware.js";

const router = express.Router();

/**
 * POST /api/billing/consume-credit
 * Used to deduct credit AFTER successful parse/export
 */
router.post(
  "/consume-credit",
  authenticateUser,
  billingMiddleware,
  async (req, res) => {
    try {
      const user = req.billingUser;

      // 🟢 FREE PLAN
      if (user.plan_code === "FREE") {
        await pool.query(
          `UPDATE users
           SET lifetime_parses_used = lifetime_parses_used + 1
           WHERE id = $1`,
          [user.id]
        );
      }

      // 🟣 PRO YEAR UNLIMITED
      else if (user.plan_code === "PRO_YEAR_UNLIMITED") {
        // No deduction needed
      }

      // 🔵 MONTHLY 25 or 🟡 PAYG_10
      else {
        await pool.query(
          `UPDATE users
           SET credits_remaining = credits_remaining - 1
           WHERE id = $1`,
          [user.id]
        );
      }

      // Usage log
      await pool.query(
        `INSERT INTO usage_logs
         (user_id, action, plan_code, credits_deducted)
         VALUES ($1, $2, $3, $4)`,
        [
          user.id,
          "consume_credit",
          user.plan_code,
          user.plan_code === "PRO_YEAR_UNLIMITED" ? 0 : 1
        ]
      );

      return res.json({ success: true });

    } catch (error) {
      console.error("Consume Credit Error:", error);
      return res.status(500).json({
        error: "CREDIT_CONSUMPTION_FAILED"
      });
    }
  }
);

export default router;