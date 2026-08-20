import express from "express";
import pool from "../config/db.js";
import { authenticateUser } from "../middleware/auth.middleware.js";
import { configuredAdminEmails } from "../utils/adminAccess.js";
import { buildCutoverReadiness } from "../youscan2/cutover/readiness.js";

async function loadV2Metrics(dbPool) {
  const tableCheck = await dbPool.query(
    `SELECT to_regclass('public.youscan_v2_review_cases') AS review_cases_table`
  );
  const reviewTableExists = Boolean(tableCheck.rows[0]?.review_cases_table);

  const parseUsage = await dbPool.query(`
    WITH boundaries AS (
      SELECT now() - interval '14 days' AS last_14_start,
             now() - interval '28 days' AS previous_14_start
    )
    SELECT
      COUNT(*) FILTER (WHERE action = 'parse_statement_v2' AND created_at >= b.last_14_start)::int
        AS v2_parse_requests_last_14_days,
      COUNT(*) FILTER (WHERE action = 'parse_statement_v2' AND created_at >= b.previous_14_start AND created_at < b.last_14_start)::int
        AS v2_parse_requests_previous_14_days
    FROM usage_logs, boundaries b
  `);

  let reviewMetrics = {
    v2_review_cases_total: 0,
    v2_review_cases_pending: 0,
    v2_review_cases_partially_reviewed: 0,
    v2_review_cases_reviewed: 0,
  };

  if (reviewTableExists) {
    const result = await dbPool.query(`
      SELECT
        COUNT(*)::int AS v2_review_cases_total,
        COUNT(*) FILTER (WHERE status = 'pending_review')::int AS v2_review_cases_pending,
        COUNT(*) FILTER (WHERE status = 'partially_reviewed')::int AS v2_review_cases_partially_reviewed,
        COUNT(*) FILTER (WHERE status = 'reviewed')::int AS v2_review_cases_reviewed
      FROM youscan_v2_review_cases
    `);
    reviewMetrics = result.rows[0] || reviewMetrics;
  }

  return {
    ...(parseUsage.rows[0] || {
      v2_parse_requests_last_14_days: 0,
      v2_parse_requests_previous_14_days: 0,
    }),
    ...reviewMetrics,
  };
}

export function createAdminRouter({
  dbPool = pool,
  authenticate = authenticateUser,
  env = process.env,
} = {}) {
  const router = express.Router();

  router.get("/metrics", authenticate, async (req, res) => {
    try {
      const meResult = await dbPool.query(
        `SELECT email FROM users WHERE id = $1 LIMIT 1`,
        [req.user.userId]
      );

      const myEmail = String(meResult.rows[0]?.email || "").toLowerCase();
      if (!configuredAdminEmails(env).has(myEmail)) {
        return res.status(403).json({ error: "FORBIDDEN" });
      }

      const result = await dbPool.query(`
        WITH boundaries AS (
          SELECT
            now() - interval '14 days' AS last_14_start,
            now() - interval '28 days' AS previous_14_start
        )
        SELECT
          (SELECT COUNT(*)::int FROM users) AS total_users,
          (SELECT COUNT(*)::int FROM users, boundaries b
           WHERE users.created_at >= b.last_14_start) AS signups_last_14_days,
          (SELECT COUNT(*)::int FROM users, boundaries b
           WHERE users.created_at >= b.previous_14_start
             AND users.created_at < b.last_14_start) AS signups_previous_14_days,
          (SELECT COUNT(*)::int FROM ozow_transactions, boundaries b
           WHERE status = 'Complete'
             AND created_at >= b.last_14_start) AS successful_payments_last_14_days,
          (SELECT COUNT(*)::int FROM users WHERE plan_code = 'FREE') AS free_users,
          (SELECT COUNT(*)::int FROM users WHERE plan_code = 'PAYG_10') AS payg_users,
          (SELECT COUNT(*)::int FROM users WHERE plan_code = 'MONTHLY_25') AS monthly_users,
          (SELECT COUNT(*)::int FROM users WHERE plan_code = 'PRO_YEAR_UNLIMITED') AS pro_year_unlimited_users
        FROM boundaries
      `);

      const v2Metrics = await loadV2Metrics(dbPool);
      return res.json({ ...(result.rows[0] || {}), ...v2Metrics });
    } catch (error) {
      console.error("Admin metrics error:", error?.code || error?.message || "unknown");
      return res.status(500).json({ error: "METRICS_FAILED" });
    }
  });

  router.get("/cutover-readiness", authenticate, async (req, res) => {
    try {
      const meResult = await dbPool.query(
        `SELECT email FROM users WHERE id = $1 LIMIT 1`,
        [req.user.userId]
      );
      const myEmail = String(meResult.rows[0]?.email || "").toLowerCase();
      if (!configuredAdminEmails(env).has(myEmail)) {
        return res.status(403).json({ error: "FORBIDDEN" });
      }

      const readiness = await buildCutoverReadiness({ env, dbPool });
      return res.status(readiness.ready ? 200 : 503).json(readiness);
    } catch (error) {
      console.error("Cutover readiness error:", error?.code || error?.message || "unknown");
      return res.status(500).json({ error: "CUTOVER_READINESS_FAILED" });
    }
  });

  return router;
}

export { configuredAdminEmails, loadV2Metrics };
export default createAdminRouter();
