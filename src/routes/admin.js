import express from "express";
import pool from "../config/db.js";
import { authenticateUser } from "../middleware/auth.middleware.js";

const router = express.Router();

router.get("/metrics", authenticateUser, async (req, res) => {
  try {
    // Temporary admin lock
    console.log("ADMIN REQ USER:", req.user);
    if (req.user?.email !== "quentin.loader@gmail.com") {
      return res.status(403).json({ error: "FORBIDDEN" });
    }

    const totalUsersResult = await pool.query(`
      SELECT COUNT(*)::int AS count
      FROM users
    `);

    const totalParsesResult = await pool.query(`
      SELECT COALESCE(SUM(lifetime_parses_used), 0)::int AS total
      FROM users
    `);

    const freeUsersResult = await pool.query(`
      SELECT COUNT(*)::int AS count
      FROM users
      WHERE plan_code = 'FREE'
    `);

    const paidUsersResult = await pool.query(`
      SELECT COUNT(*)::int AS count
      FROM users
      WHERE plan_code <> 'FREE'
    `);

    const successfulPaymentsResult = await pool.query(`
      SELECT COUNT(*)::int AS count
      FROM ozow_transactions
      WHERE status = 'Complete'
    `);

    return res.json({
      total_users: totalUsersResult.rows[0].count,
      total_parses: totalParsesResult.rows[0].total,
      free_users: freeUsersResult.rows[0].count,
      paid_users: paidUsersResult.rows[0].count,
      successful_payments: successfulPaymentsResult.rows[0].count
    });
  } catch (error) {
    console.error("Admin metrics error:", error);
    return res.status(500).json({ error: "METRICS_FAILED" });
  }
});

export default router;