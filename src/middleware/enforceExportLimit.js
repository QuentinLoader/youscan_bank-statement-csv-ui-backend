import pool from "../db.js";
import { PRICING } from "../config/pricing.js";
import getActiveSubscription from "../utils/getActiveSubscription.js";
import getOrCreateUsage from "../utils/getOrCreateUsage.js";

export default async function enforceExportLimit(req, res, next) {
  try {
    const userId = req.user.id;

    let subscription = await getActiveSubscription(userId);

    // Default to FREE if no subscription
    let planCode = subscription?.plan || "FREE";
    const plan = PRICING.PLANS[planCode];

    if (!plan) {
      return res.status(500).json({
        error: "Invalid plan configuration"
      });
    }

    // Unlimited yearly plan
    if (plan.unlimited) {
      return next();
    }

    let periodKey;

    if (plan.type === "lifetime") {
      periodKey = "lifetime";
    }

    if (plan.type === "credits") {
      periodKey = "credit_bucket";
    }

    if (plan.type === "subscription") {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, "0");
      periodKey = `${year}-${month}`;
    }

    const usage = await getOrCreateUsage(userId, periodKey);

    let limit;

    if (plan.type === "lifetime") {
      limit = plan.credits;
    }

    if (plan.type === "credits") {
      limit = plan.credits;
    }

    if (plan.type === "subscription") {
      limit = plan.credits_per_cycle;
    }

    if (usage.exports_used >= limit) {
      return res.status(403).json({
        error: "EXPORT_LIMIT_REACHED",
        upgrade_required: true,
        current_plan: planCode
      });
    }

    // Increment usage
    await pool.query(
      `
      UPDATE user_usage
      SET exports_used = exports_used + 1,
          updated_at = NOW()
      WHERE id = $1
      `,
      [usage.id]
    );

    next();

  } catch (err) {
    console.error("Usage enforcement error:", err);
    return res.status(500).json({
      error: "Usage validation failed"
    });
  }
}