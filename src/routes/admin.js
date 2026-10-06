import { listFailures, resolveFailure, operationsOverview, cleanupOperations, uuid } from "../operations/adminOperations.js";
import express from "express";
import pool from "../config/db.js";
import { authenticateUser } from "../middleware/auth.middleware.js";
import { configuredAdminEmails } from "../utils/adminAccess.js";
import { buildCutoverReadiness } from "../youscan2/cutover/readiness.js";

async function requireAdmin({ req, res, dbPool, env }) {
  const meResult = await dbPool.query(
    `SELECT email FROM users WHERE id = $1 LIMIT 1`,
    [req.user.userId]
  );

  const myEmail = String(meResult.rows[0]?.email || "")
    .trim()
    .toLowerCase();

  if (!configuredAdminEmails(env).has(myEmail)) {
    res.status(403).json({ error: "FORBIDDEN" });
    return false;
  }

  return true;
}

async function loadV2Metrics(dbPool) {
  const tableCheck = await dbPool.query(
    `SELECT to_regclass('public.youscan_v2_review_cases') AS review_cases_table`
  );

  const reviewTableExists = Boolean(
    tableCheck.rows[0]?.review_cases_table
  );

  /*
   * V2 commercial usage is recorded on the first successful
   * CSV export of a document, not when the document is parsed.
   */
  const exportUsage = await dbPool.query(`
    WITH boundaries AS (
      SELECT
        now() - interval '14 days' AS last_14_start,
        now() - interval '28 days' AS previous_14_start
    )
    SELECT
      COUNT(*) FILTER (
        WHERE action = 'export_csv_v2'
          AND created_at >= b.last_14_start
      )::int AS v2_exports_last_14_days,

      COUNT(*) FILTER (
        WHERE action = 'export_csv_v2'
          AND created_at >= b.previous_14_start
          AND created_at < b.last_14_start
      )::int AS v2_exports_previous_14_days

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
        COUNT(*)::int
          AS v2_review_cases_total,

        COUNT(*) FILTER (
          WHERE status = 'pending_review'
        )::int
          AS v2_review_cases_pending,

        COUNT(*) FILTER (
          WHERE status = 'partially_reviewed'
        )::int
          AS v2_review_cases_partially_reviewed,

        COUNT(*) FILTER (
          WHERE status = 'reviewed'
        )::int
          AS v2_review_cases_reviewed

      FROM youscan_v2_review_cases
    `);

    reviewMetrics =
      result.rows[0] || reviewMetrics;
  }

  return {
    ...(exportUsage.rows[0] || {
      v2_exports_last_14_days: 0,
      v2_exports_previous_14_days: 0,
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

  router.get(
    "/metrics",
    authenticate,
    async (req, res) => {
      try {
        const allowed = await requireAdmin({
          req,
          res,
          dbPool,
          env,
        });

        if (!allowed) {
          return;
        }

        const result = await dbPool.query(`
          WITH boundaries AS (
            SELECT
              now() - interval '14 days' AS last_14_start,
              now() - interval '28 days' AS previous_14_start
          )
          SELECT
            (
              SELECT COUNT(*)::int
              FROM users
            ) AS total_users,

            (
              SELECT COUNT(*)::int
              FROM users, boundaries b
              WHERE users.created_at >= b.last_14_start
            ) AS signups_last_14_days,

            (
              SELECT COUNT(*)::int
              FROM users, boundaries b
              WHERE users.created_at >= b.previous_14_start
                AND users.created_at < b.last_14_start
            ) AS signups_previous_14_days,

            (
              SELECT COUNT(*)::int
              FROM ozow_transactions, boundaries b
              WHERE status = 'Complete'
                AND processed_at IS NOT NULL
                AND created_at >= b.last_14_start
            ) AS successful_payments_last_14_days,

            (
              SELECT COUNT(*)::int
              FROM users
              WHERE plan_code = 'FREE'
            ) AS free_users,

            (
              SELECT COUNT(*)::int
              FROM users
              WHERE plan_code = 'PAYG_10'
            ) AS payg_users,

            (
              SELECT COUNT(*)::int
              FROM users
              WHERE plan_code = 'MONTHLY_25'
            ) AS monthly_users,

            (
              SELECT COUNT(*)::int
              FROM users
              WHERE plan_code = 'PRO_YEAR_UNLIMITED'
            ) AS pro_year_unlimited_users

          FROM boundaries
        `);

        const v2Metrics =
          await loadV2Metrics(dbPool);

        return res.json({
          ...(result.rows[0] || {}),
          ...v2Metrics,
        });
      } catch (error) {
        console.error(
          "Admin metrics error:",
          error?.code ||
            error?.message ||
            "unknown"
        );

        return res
          .status(500)
          .json({
            error: "METRICS_FAILED",
          });
      }
    }
  );

  /*
   * Registered users.
   *
   * Deliberately returns email addresses only.
   * No plan, credit, auth, payment or profile
   * information is exposed by this endpoint.
   */
  router.get(
    "/users",
    authenticate,
    async (req, res) => {
      try {
        const allowed = await requireAdmin({
          req,
          res,
          dbPool,
          env,
        });

        if (!allowed) {
          return;
        }

        const result = await dbPool.query(`
          SELECT email
          FROM users
          WHERE email IS NOT NULL
            AND BTRIM(email) <> ''
          ORDER BY LOWER(email) ASC
        `);

        return res.json({
          users: result.rows.map((row) => ({
            email: String(row.email),
          })),
        });
      } catch (error) {
        console.error(
          "Admin users error:",
          error?.code ||
            error?.message ||
            "unknown"
        );

        return res
          .status(500)
          .json({
            error: "ADMIN_USERS_FAILED",
          });
      }
    }
  );

  router.get(
    "/cutover-readiness",
    authenticate,
    async (req, res) => {
      try {
        const allowed = await requireAdmin({
          req,
          res,
          dbPool,
          env,
        });

        if (!allowed) {
          return;
        }

        const readiness =
          await buildCutoverReadiness({
            env,
            dbPool,
          });

        return res
          .status(
            readiness.ready
              ? 200
              : 503
          )
          .json(readiness);
      } catch (error) {
        console.error(
          "Cutover readiness error:",
          error?.code ||
            error?.message ||
            "unknown"
        );

        return res
          .status(500)
          .json({
            error:
              "CUTOVER_READINESS_FAILED",
          });
      }
    }
  );

  const protectedOperation = handler => [authenticate, async (req, res) => {
    try {
      if (!await requireAdmin({ req, res, dbPool, env })) return;
      res.set('Cache-Control', 'no-store');
      await handler(req, res);
    } catch {
      console.error('ADMIN_OPERATIONS_FAILED');
      res.status(503).json({ error: 'OPERATIONS_UNAVAILABLE', message: 'Operations data is temporarily unavailable. Try refreshing.' });
    }
  }];
  router.get('/operations', ...protectedOperation(async (_req,res) => res.json(await operationsOverview(dbPool))));
  router.get('/failures', ...protectedOperation(async (req,res) => res.json(await listFailures(dbPool,req.query))));
  router.get('/failures/:id', ...protectedOperation(async (req,res) => {
    if (!uuid.test(req.params.id)) return res.status(400).json({ error: 'INVALID_REFERENCE' });
    const record = await dbPool.query("SELECT * FROM processing_attempts WHERE id=$1 AND outcome IN ('failed','rejected')", [req.params.id]);
    if (!record.rows.length) return res.status(404).json({ error: 'FAILURE_NOT_FOUND' });
    const history = await dbPool.query('SELECT changed_at,actor_id,previous_state,new_state,reason FROM processing_resolution_history WHERE attempt_id=$1 ORDER BY changed_at,id', [req.params.id]);
    res.json({ ...record.rows[0], history: history.rows });
  }));
  router.post('/failures/:id/resolution', express.json({ limit: '2kb' }), ...protectedOperation(async (req,res) => {
    const result = await resolveFailure(dbPool, { id: req.params.id, actor: req.user.userId, state: req.body?.state, reason: req.body?.reason });
    res.status(result.status).json(result);
  }));
  router.post('/operations/cleanup', ...protectedOperation(async (_req,res) => res.json(await cleanupOperations(dbPool, env.OPERATIONS_RETENTION_DAYS || 90))));

  return router;
}

export {
  configuredAdminEmails,
  loadV2Metrics,
};

export default createAdminRouter();