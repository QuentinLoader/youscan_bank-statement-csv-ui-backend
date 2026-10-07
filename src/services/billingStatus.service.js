import { getAdministratorAccess } from "../administration/access.js";
import pool from "../config/db.js";

export class BillingStatusError extends Error {
  constructor(code, message, status = 404) {
    super(message);
    this.name = "BillingStatusError";
    this.code = code;
    this.status = status;
  }
}

export function shapeBillingStatus(user, { now = new Date(), administratorAccess = { is_admin:false, admin_unlimited:false } } = {}) {
  if (!user) throw new BillingStatusError("USER_NOT_FOUND", "User account not found.", 404);

  let lifetimeRemaining = null;
  let creditsRemaining = null;
  let subscriptionStatus = user.subscription_status || "inactive";

  if (user.plan_code === "FREE") {
    lifetimeRemaining = Math.max(0, 15 - Number(user.lifetime_parses_used || 0));
    subscriptionStatus = "active";
  } else if (user.plan_code === "PAYG_10") {
    creditsRemaining = Number(user.credits_remaining || 0);
    subscriptionStatus = "active";
  } else if (user.plan_code === "MONTHLY_25") {
    creditsRemaining = Number(user.credits_remaining || 0);
    if (subscriptionStatus !== "active" || !user.renewal_date || !(new Date(user.renewal_date) > now)) subscriptionStatus = "expired";
  } else if (user.plan_code === "PRO_YEAR_UNLIMITED") {
    if (
      subscriptionStatus !== "active" ||
      !user.renewal_date ||
      !(new Date(user.renewal_date) > now)
    ) {
      subscriptionStatus = "expired";
    }
  }

  return {
    ...administratorAccess,
    plan_code: user.plan_code,
    credits_remaining: creditsRemaining,
    lifetime_remaining: lifetimeRemaining,
    subscription_status: subscriptionStatus,
    renewal_date: user.renewal_date || null,
    billing_cycle_end: user.billing_cycle_end || null,
  };
}

// Ownership is enforced in the query. A browser redirect is not payment proof.
export async function getPaymentConfirmation({ userId, reference, dbPool = pool } = {}) {
  if (typeof reference !== "string" || !reference || reference.length > 200) {
    throw new BillingStatusError("PAYMENT_REFERENCE_REQUIRED", "A payment reference is required.", 400);
  }
  const result = await dbPool.query(
    `SELECT plan_code, status, processed_at FROM ozow_transactions
     WHERE user_id = $1 AND transaction_reference = $2 LIMIT 1`,
    [userId, reference]
  );
  const payment = result.rows[0];
  return { confirmed: Boolean(payment?.status === "Complete" && payment.processed_at),
    plan_code: payment?.plan_code || null };
}

export async function getBillingStatusForUser({ userId, dbPool = pool, now = new Date(), env = process.env } = {}) {
  const result = await dbPool.query(
    `SELECT id, email, is_verified, plan_code, credits_remaining, lifetime_parses_used,
            subscription_status, renewal_date, billing_cycle_end
     FROM users WHERE id = $1 LIMIT 1`,
    [userId]
  );
  const user = result.rows[0];
  if (!user) throw new BillingStatusError("USER_NOT_FOUND", "User account not found.", 404);
  const administratorAccess = await getAdministratorAccess({ user, userId, dbPool, env });
  return shapeBillingStatus(user, { now, administratorAccess });
}
