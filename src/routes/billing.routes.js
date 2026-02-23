import express from "express";
import pool from "../config/db.js";
import { authenticateUser } from "../middleware/auth.middleware.js";
import billingMiddleware from "../middleware/billing.middleware.js";

const router = express.Router();

router.post(
  "/consume-credit",
  authenticateUser,
  billingMiddleware,
  async (req, res) => {
    const user = req.billingUser;

    if (user.plan_type === "payg") {
      await pool.query(
        "UPDATE users SET credits_remaining = credits_remaining - 1 WHERE id = $1",
        [user.id]
      );
    }

    await pool.query(
      "INSERT INTO usage_logs (user_id) VALUES ($1)",
      [user.id]
    );

    res.json({ success: true });
  }
);

export default router;