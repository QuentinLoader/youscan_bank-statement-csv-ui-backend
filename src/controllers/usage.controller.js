import { getAdministratorAccess, ADMINISTRATOR_LOCK } from "../administration/access.js";
import pool from "../config/db.js";

const FREE_LIMIT = 15;

function cleanText(value, maxLength) {
  const text = String(value || "").trim();
  return text ? text.slice(0, maxLength) : null;
}

export function createRecordExport({ dbPool=pool, env=process.env } = {}) {
return async function recordExport(req, res) {
  if (!req.user?.userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const userId = req.user.userId;
  const ip = req.ip || null;

  const jobId = cleanText(req.body?.jobId, 200);
  const fileName = cleanText(req.body?.fileName, 255);

  if (!jobId) {
    return res.status(400).json({
      error: "V2_EXPORT_JOB_ID_REQUIRED",
      message: "A V2 jobId is required before export.",
    });
  }

  const client = await dbPool.connect();

  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock_shared($1)", [ADMINISTRATOR_LOCK]);

    /*
     * Lock the user first.
     *
     * This serializes simultaneous export requests for the same user and
     * prevents two requests for the same job from both consuming credit.
     */
    const userResult = await client.query(
      `
      SELECT
        id, email, is_verified,
        plan_code,
        credits_remaining,
        lifetime_parses_used, subscription_status, renewal_date
      FROM users
      WHERE id = $1
      FOR UPDATE
      `,
      [userId]
    );

    if (userResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(401).json({ error: "Unauthorized" });
    }

    const user = userResult.rows[0];
    const administratorAccess = await getAdministratorAccess({ user, dbPool:client, env });
    const entitlementSource = administratorAccess.is_admin ? "administrator" : "commercial";

    /*
     * Idempotency:
     * if this parsed document was already exported, allow another download
     * without consuming another FREE use / paid credit.
     */
    const existingExport = await client.query(
      `
      SELECT
        id,
        plan_code,
        credits_deducted,
        exported_at
      FROM v2_export_ledger
      WHERE user_id = $1
        AND job_id = $2
      LIMIT 1
      `,
      [userId, jobId]
    );

    if (existingExport.rows.length > 0) {
      await client.query("COMMIT");

      return res.status(200).json({
        success: true,
        first_export: false,
        already_exported: true,
        allowance_consumed: false,
        credits_deducted: 0,
        job_id: jobId,
      });
    }

    if (!user.is_verified) {
      await client.query('ROLLBACK');
      return res.status(403).json({error:'EMAIL_NOT_VERIFIED'});
    }
    if (!administratorAccess.is_admin && ['MONTHLY_25','PRO_YEAR_UNLIMITED'].includes(user.plan_code) &&
        (user.subscription_status !== 'active' || !user.renewal_date || !(new Date(user.renewal_date)>new Date()))) {
      await client.query('ROLLBACK');
      return res.status(403).json({error:'SUBSCRIPTION_EXPIRED',message:'Renew your subscription before exporting a new statement.'});
    }

    let creditsDeducted = 0;
    let remaining = null;
    let allowanceConsumed = false;

    /*
     * FREE
     * One successful first export consumes one of the 15 lifetime uses.
     */
    if (administratorAccess.is_admin) {
      // Preserve the underlying plan and all allowances.
      remaining = null;
    }
    else if (user.plan_code === "FREE") {
      const updateResult = await client.query(
        `
        UPDATE users
        SET lifetime_parses_used =
          COALESCE(lifetime_parses_used, 0) + 1
        WHERE id = $1
          AND COALESCE(lifetime_parses_used, 0) < $2
        RETURNING lifetime_parses_used
        `,
        [userId, FREE_LIMIT]
      );

      if (updateResult.rowCount === 0) {
        await client.query("ROLLBACK");

        return res.status(402).json({
          error: "FREE_LIMIT_REACHED",
          upgrade_required: true,
          upgrade_options: [
            "PAYG_10",
            "MONTHLY_25",
            "PRO_YEAR_UNLIMITED",
          ],
        });
      }

      remaining = Math.max(
        0,
        FREE_LIMIT - Number(updateResult.rows[0].lifetime_parses_used || 0)
      );

      allowanceConsumed = true;
    }

    /*
     * PRO YEAR UNLIMITED
     */
    else if (user.plan_code === "PRO_YEAR_UNLIMITED") {
      creditsDeducted = 0;
      allowanceConsumed = false;
      remaining = null;
    }

    /*
     * PAYG / MONTHLY
     */
    else if (
      user.plan_code === "MONTHLY_25" ||
      user.plan_code === "PAYG_10"
    ) {
      const updateResult = await client.query(
        `
        UPDATE users
        SET credits_remaining = credits_remaining - 1
        WHERE id = $1
          AND COALESCE(credits_remaining, 0) > 0
        RETURNING credits_remaining
        `,
        [userId]
      );

      if (updateResult.rowCount === 0) {
        await client.query("ROLLBACK");

        return res.status(402).json({
          error: "CREDITS_EXHAUSTED",
          upgrade_required: true,
          upgrade_options:
            user.plan_code === "PAYG_10"
              ? ["MONTHLY_25", "PRO_YEAR_UNLIMITED"]
              : ["PRO_YEAR_UNLIMITED"],
        });
      }

      creditsDeducted = 1;
      allowanceConsumed = true;
      remaining = Number(updateResult.rows[0].credits_remaining);
    }

    /*
     * INVALID PLAN
     */
    else {
      await client.query("ROLLBACK");

      return res.status(400).json({
        error: "INVALID_PLAN",
      });
    }

    /*
     * Record this specific parsed document as paid/exported.
     */
    await client.query(
      `
      INSERT INTO v2_export_ledger
        (
          user_id,
          job_id,
          file_name,
          plan_code,
          credits_deducted, entitlement_source
        )
      VALUES
        ($1, $2, $3, $4, $5, $6)
      `,
      [
        userId,
        jobId,
        fileName,
        user.plan_code,
        creditsDeducted,
        entitlementSource,
      ]
    );

    /*
     * Keep normal usage reporting.
     */
    await client.query(
      `
      INSERT INTO usage_logs
        (
          user_id,
          action,
          ip_address,
          plan_code,
          credits_deducted, entitlement_source
        )
      VALUES
        ($1, $2, $3, $4, $5, $6)
      `,
      [
        userId,
        "export_csv_v2",
        ip,
        user.plan_code,
        creditsDeducted,
        entitlementSource,
      ]
    );

    await client.query("COMMIT");

    return res.status(200).json({
      success: true,
      first_export: true,
      already_exported: false,
      allowance_consumed: allowanceConsumed,
      credits_deducted: creditsDeducted,
      remaining,
      entitlement_source: entitlementSource,
      plan_code: user.plan_code,
      job_id: jobId,
    });
  } catch (err) {
    await client.query("ROLLBACK");

    console.error(
      "recordExport error:",
      err?.code || err?.message || "unknown"
    );

    return res.status(500).json({
      error: "V2_EXPORT_RECORD_FAILED",
      message: "YouScan could not authorize this export.",
    });
  } finally {
    client.release();
  }
}
}
export const recordExport = createRecordExport();
