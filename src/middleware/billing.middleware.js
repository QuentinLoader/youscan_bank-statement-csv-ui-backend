import pool from "../config/db.js";

export default async function billingMiddleware(req, res, next) {
  const userId = req.user.userId;

  const { rows } = await pool.query(
    "SELECT * FROM users WHERE id = $1",
    [userId]
  );

  if (!rows.length)
    return res.status(404).json({ error: "USER_NOT_FOUND" });

  const user = rows[0];

  if (!user.is_verified)
    return res.status(403).json({ error: "EMAIL_NOT_VERIFIED" });

  const now = new Date();

  // 🟢 FREE PLAN
  if (user.plan_code === "FREE") {
    if (user.lifetime_parses_used >= 15) {
      return res.status(402).json({
        error: "FREE_LIMIT_REACHED",
        upgrade_options: [
          "PAYG_10",
          "MONTHLY_25",
          "PRO_YEAR_UNLIMITED"
        ]
      });
    }

    req.billingUser = user;
    return next();
  }

  // 🟣 PRO YEAR UNLIMITED
  if (user.plan_code === "PRO_YEAR_UNLIMITED") {
    if (
      user.subscription_status !== "active" ||
      !user.renewal_date ||
      new Date(user.renewal_date) < now
    ) {
      return res.status(402).json({
        error: "SUBSCRIPTION_EXPIRED",
        upgrade_options: ["MONTHLY_25"]
      });
    }

    req.billingUser = user;
    return next();
  }

  // 🔵 MONTHLY 25
  if (user.plan_code === "MONTHLY_25") {
    if (!user.billing_cycle_end || new Date(user.billing_cycle_end) < now) {
      await pool.query(
        `UPDATE users
         SET credits_remaining = 25,
             billing_cycle_end = NOW() + INTERVAL '1 month'
         WHERE id = $1`,
        [userId]
      );

      user.credits_remaining = 25;
    }

    if (user.credits_remaining <= 0) {
      return res.status(402).json({
        error: "CREDITS_EXHAUSTED",
        upgrade_options: ["PRO_YEAR_UNLIMITED"]
      });
    }

    req.billingUser = user;
    return next();
  }

  // 🟢 PAYG 10
  if (user.plan_code === "PAYG_10") {
    if (user.credits_remaining <= 0) {
      return res.status(402).json({
        error: "CREDITS_EXHAUSTED",
        upgrade_options: ["MONTHLY_25", "PRO_YEAR_UNLIMITED"]
      });
    }

    req.billingUser = user;
    return next();
  }

  return res.status(400).json({ error: "INVALID_PLAN" });
}