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
      WITH
      boundaries AS (
        SELECT
          date_trunc('week', now()) AS this_week_start,
          date_trunc('week', now()) + interval '7 days' AS next_week_start,
          date_trunc('week', now()) - interval '7 days' AS last_week_start,

          date_trunc('month', now()) AS this_month_start,
          date_trunc('month', now()) + interval '1 month' AS next_month_start,
          date_trunc('month', now()) - interval '1 month' AS last_month_start
      )
      SELECT
        -- totals
        (SELECT COUNT(*)::int FROM users) AS total_users,
        (SELECT COALESCE(SUM(lifetime_parses_used), 0)::int FROM users) AS total_parses,

        -- plan breakdown
        (SELECT COUNT(*)::int FROM users WHERE plan_code = 'FREE') AS free_users,
        (SELECT COUNT(*)::int FROM users WHERE plan_code = 'PAYG_10') AS payg_users,
        (SELECT COUNT(*)::int FROM users WHERE plan_code = 'MONTHLY_25') AS monthly_users,
        (SELECT COUNT(*)::int FROM users WHERE plan_code = 'PRO_YEAR_UNLIMITED') AS pro_year_unlimited_users,

        -- this week users
        (SELECT COUNT(*)::int FROM users, boundaries b WHERE users.created_at < b.this_week_start) AS users_start_this_week,
        (SELECT COUNT(*)::int FROM users, boundaries b WHERE users.created_at >= b.this_week_start AND users.created_at < b.next_week_start) AS new_users_this_week,
        (SELECT COUNT(*)::int FROM users, boundaries b WHERE users.created_at < b.next_week_start) AS users_end_this_week,

        -- last week users
        (SELECT COUNT(*)::int FROM users, boundaries b WHERE users.created_at < b.last_week_start) AS users_start_last_week,
        (SELECT COUNT(*)::int FROM users, boundaries b WHERE users.created_at >= b.last_week_start AND users.created_at < b.this_week_start) AS new_users_last_week,
        (SELECT COUNT(*)::int FROM users, boundaries b WHERE users.created_at < b.this_week_start) AS users_end_last_week,

        -- this month users
        (SELECT COUNT(*)::int FROM users, boundaries b WHERE users.created_at < b.this_month_start) AS users_start_this_month,
        (SELECT COUNT(*)::int FROM users, boundaries b WHERE users.created_at >= b.this_month_start AND users.created_at < b.next_month_start) AS new_users_this_month,
        (SELECT COUNT(*)::int FROM users, boundaries b WHERE users.created_at < b.next_month_start) AS users_end_this_month,

        -- last month users
        (SELECT COUNT(*)::int FROM users, boundaries b WHERE users.created_at < b.last_month_start) AS users_start_last_month,
        (SELECT COUNT(*)::int FROM users, boundaries b WHERE users.created_at >= b.last_month_start AND users.created_at < b.this_month_start) AS new_users_last_month,
        (SELECT COUNT(*)::int FROM users, boundaries b WHERE users.created_at < b.this_month_start) AS users_end_last_month,

        -- payments
        (SELECT COUNT(*)::int FROM ozow_transactions, boundaries b WHERE status = 'Complete' AND created_at >= b.this_week_start AND created_at < b.next_week_start) AS successful_payments_this_week,
        (SELECT COUNT(*)::int FROM ozow_transactions, boundaries b WHERE status = 'Complete' AND created_at >= b.last_week_start AND created_at < b.this_week_start) AS successful_payments_last_week,
        (SELECT COUNT(*)::int FROM ozow_transactions, boundaries b WHERE status = 'Complete' AND created_at >= b.this_month_start AND created_at < b.next_month_start) AS successful_payments_this_month,
        (SELECT COUNT(*)::int FROM ozow_transactions, boundaries b WHERE status = 'Complete' AND created_at >= b.last_month_start AND created_at < b.this_month_start) AS successful_payments_last_month
      FROM boundaries
    `);

    return res.json(result.rows[0]);
  } catch (error) {
    console.error("Admin metrics error:", error);
    return res.status(500).json({ error: "METRICS_FAILED" });
  }
});

export default router;