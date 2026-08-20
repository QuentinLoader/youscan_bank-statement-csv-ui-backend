/**
 * YouScan V2 commercial-shell bridge.
 *
 * Preserves the current V1 parse charging model:
 * - FREE: 15 lifetime successful parse requests.
 * - PAYG_10 / MONTHLY_25: one credit per successful parse request.
 * - PRO_YEAR_UNLIMITED: no credit deduction while active.
 *
 * The debit and usage-log insert are one database transaction so concurrent
 * requests cannot consume the same last credit twice.
 */

import pool from "../../config/db.js";

export class ParseEntitlementError extends Error {
  constructor(code, message, { status = 403, suggestedPlan = null } = {}) {
    super(message);
    this.name = "ParseEntitlementError";
    this.code = code;
    this.status = status;
    this.suggestedPlan = suggestedPlan;
  }
}

function nowIsBefore(value, now = new Date()) {
  if (!value) return false;
  const timestamp = new Date(value);
  return !Number.isNaN(timestamp.getTime()) && timestamp > now;
}

export function evaluateParseEntitlement(user, { now = new Date() } = {}) {
  if (!user) {
    throw new ParseEntitlementError("USER_NOT_FOUND", "User account not found.", { status: 404 });
  }

  if (user.plan_code === "FREE") {
    const used = Number(user.lifetime_parses_used || 0);
    if (used >= 15) {
      throw new ParseEntitlementError(
        "FREE_LIMIT_REACHED",
        "Free lifetime limit reached.",
        { suggestedPlan: "PAYG_10" }
      );
    }
    return { planCode: "FREE", creditsDeducted: 1, mutation: "increment_lifetime" };
  }

  if (user.plan_code === "PAYG_10" || user.plan_code === "MONTHLY_25") {
    const credits = Number(user.credits_remaining || 0);
    if (credits <= 0) {
      throw new ParseEntitlementError(
        "CREDITS_EXHAUSTED",
        "No credits remaining.",
        { suggestedPlan: user.plan_code === "PAYG_10" ? "MONTHLY_25" : "PRO_YEAR_UNLIMITED" }
      );
    }
    return { planCode: user.plan_code, creditsDeducted: 1, mutation: "decrement_credit" };
  }

  if (user.plan_code === "PRO_YEAR_UNLIMITED") {
    if (user.subscription_status !== "active" || !nowIsBefore(user.renewal_date, now)) {
      throw new ParseEntitlementError(
        "SUBSCRIPTION_EXPIRED",
        "Your Pro subscription has expired. Please renew to continue.",
        { suggestedPlan: "PRO_YEAR_UNLIMITED" }
      );
    }
    return { planCode: user.plan_code, creditsDeducted: 0, mutation: "none" };
  }

  throw new ParseEntitlementError("INVALID_PLAN", "No active plan found.", { status: 403 });
}

export async function consumeSuccessfulV2Parse({
  userId,
  ipAddress = null,
  dbPool = pool,
  action = "parse_statement_v2",
  now = new Date(),
} = {}) {
  if (!userId) {
    throw new ParseEntitlementError("USER_NOT_FOUND", "User account not found.", { status: 404 });
  }

  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");

    const userResult = await client.query(
      `SELECT id, plan_code, credits_remaining, lifetime_parses_used,
              subscription_status, renewal_date
       FROM users
       WHERE id = $1
       FOR UPDATE`,
      [userId]
    );

    const user = userResult.rows[0];
    const decision = evaluateParseEntitlement(user, { now });
    let remaining = null;

    if (decision.mutation === "increment_lifetime") {
      const update = await client.query(
        `UPDATE users
         SET lifetime_parses_used = lifetime_parses_used + 1
         WHERE id = $1 AND lifetime_parses_used < 15
         RETURNING lifetime_parses_used`,
        [userId]
      );
      if (!update.rowCount) {
        throw new ParseEntitlementError("FREE_LIMIT_REACHED", "Free lifetime limit reached.", {
          suggestedPlan: "PAYG_10",
        });
      }
      remaining = Math.max(0, 15 - Number(update.rows[0].lifetime_parses_used || 0));
    } else if (decision.mutation === "decrement_credit") {
      const update = await client.query(
        `UPDATE users
         SET credits_remaining = credits_remaining - 1
         WHERE id = $1 AND credits_remaining > 0
         RETURNING credits_remaining`,
        [userId]
      );
      if (!update.rowCount) {
        throw new ParseEntitlementError("CREDITS_EXHAUSTED", "No credits remaining.", {
          suggestedPlan: decision.planCode === "PAYG_10" ? "MONTHLY_25" : "PRO_YEAR_UNLIMITED",
        });
      }
      remaining = Number(update.rows[0].credits_remaining);
    }

    await client.query(
      `INSERT INTO usage_logs (user_id, action, ip_address, plan_code, credits_deducted)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, action, ipAddress, decision.planCode, decision.creditsDeducted]
    );

    await client.query("COMMIT");
    return {
      planCode: decision.planCode,
      creditsDeducted: decision.creditsDeducted,
      remaining,
      usageAction: action,
    };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original error.
    }
    throw error;
  } finally {
    client.release();
  }
}
