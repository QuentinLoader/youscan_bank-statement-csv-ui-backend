import express from "express";
import pool from "../config/db.js";
import { authenticateUser } from "../middleware/auth.middleware.js";

const router = express.Router();

router.get("/metrics", authenticateUser, async (req, res) => {
  try {
    const meResult = await pool.query(
      `
      SELECT email
      FROM users
      WHERE id = $1
      LIMIT 1
      `,
      [req.user.userId]
    );

    const myEmail = meResult.rows[0]?.email;

    if (myEmail !== "quentin.loader@gmail.com") {
      return res.status(403).json({ error: "FORBIDDEN" });
    }

    const result = await pool.query(`
      WITH boundaries AS (
        SELECT
          now() - interval '14 days' AS last_14_start,
          now() - interval '28 days' AS previous_14_start
      )
      SELECT
        (SELECT COUNT(*)::int FROM users) AS total_users,

        (SELECT COUNT(*)::int
         FROM users, boundaries b
         WHERE users.created_at >= b.last_14_start) AS signups_last_14_days,

        (SELECT COUNT(*)::int
         FROM users, boundaries b
         WHERE users.created_at >= b.previous_14_start
           AND users.created_at < b.last_14_start) AS signups_previous_14_days,

        (SELECT COUNT(*)::int
         FROM ozow_transactions, boundaries b
         WHERE status = 'Complete'
           AND created_at >= b.last_14_start) AS successful_payments_last_14_days,

        (SELECT COUNT(*)::int FROM users WHERE plan_code = 'FREE') AS free_users,
        (SELECT COUNT(*)::int FROM users WHERE plan_code = 'PAYG_10') AS payg_users,
        (SELECT COUNT(*)::int FROM users WHERE plan_code = 'MONTHLY_25') AS monthly_users,
        (SELECT COUNT(*)::int FROM users WHERE plan_code = 'PRO_YEAR_UNLIMITED') AS pro_year_unlimited_users
      FROM boundaries
    `);

    return res.json(result.rows[0]);
  } catch (error) {
    console.error("Admin metrics error:", error);
    return res.status(500).json({ error: "METRICS_FAILED" });
  }
});

export default router;