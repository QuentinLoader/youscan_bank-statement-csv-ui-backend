import pool from "../config/db.js";

/**
 * Middleware to verify if a user has an active plan or enough credits 
 * to perform a protected action (like parsing a statement).
 */
export const checkPlanAccess = async (req, res, next) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query(
      `SELECT id,
              plan_code,
              credits_remaining,
              lifetime_parses_used,
              subscription_status,
              renewal_date,
              billing_cycle_end,
              is_verified
       FROM users
       WHERE id = $1`,
      [userId]
    );

    const user = result.rows[0];

    // 1. User Existence Check
    if (!user) {
      return res.status(404).json({
        code: "USER_NOT_FOUND",
        message: "User account not found."
      });
    }

    // 2. Email Verification Check
    if (!user.is_verified) {
      return res.status(403).json({
        code: "EMAIL_NOT_VERIFIED",
        message: "Please verify your email before using YouScan."
      });
    }

    const now = new Date();
    // Ensure credits_remaining is never treated as null during math
    const currentCredits = user.credits_remaining || 0;

    /* =========================================
       PLAN: PRO_YEAR_UNLIMITED
    ========================================= */
    if (user.plan_code === "PRO_YEAR_UNLIMITED") {
      const isSubscriptionActive = 
        user.subscription_status === "active" &&
        user.renewal_date &&
        new Date(user.renewal_date) > now;

      if (isSubscriptionActive) {
        req.userRecord = user;
        return next();
      }

      return res.status(403).json({
        code: "SUBSCRIPTION_EXPIRED",
        message: "Your Pro subscription has expired. Please renew to continue."
      });
    }

    /* =========================================
       PLAN: MONTHLY_25 or PAYG_10
    ========================================= */
    if (user.plan_code === "PAYG_10") {
      if (currentCredits > 0) {
        req.userRecord = user;
        return next();
      }

      return res.status(403).json({
        code: "CREDITS_EXHAUSTED",
        message: "You have no credits remaining. Please top up to continue.",
        action: "REDIRECT_TO_PRICING"
      });
    }

    if (user.plan_code === "MONTHLY_25") {
      const isSubscriptionActive =
        user.subscription_status === "active" &&
        user.renewal_date &&
        new Date(user.renewal_date) > now;

      if (!isSubscriptionActive) {
        return res.status(403).json({
          code: "SUBSCRIPTION_EXPIRED",
          message: "Your Monthly 25 subscription has expired. Please renew to continue.",
          action: "REDIRECT_TO_PRICING"
        });
      }

      if (currentCredits > 0) {
        req.userRecord = user;
        return next();
      }

      return res.status(403).json({
        code: "CREDITS_EXHAUSTED",
        message: "You have no credits remaining. Please upgrade to continue.",
        action: "REDIRECT_TO_PRICING"
      });
    }

    /* =========================================
       PLAN: FREE (LIFETIME LIMIT)
    ========================================= */
    if (user.plan_code === "FREE") {
      const lifetimeUsed = user.lifetime_parses_used || 0;
      
      if (lifetimeUsed < 15) {
        req.userRecord = user;
        return next();
      }

      return res.status(403).json({
        code: "FREE_LIMIT_REACHED",
        message: "You have reached your free lifetime limit of 15 parses.",
        action: "REDIRECT_TO_PRICING"
      });
    }

    /* =========================================
       FALLBACK: NO VALID PLAN
    ========================================= */
    return res.status(403).json({
      code: "INVALID_PLAN",
      message: "No active plan found. Please select a package to begin."
    });

  } catch (err) {
    console.error("CRITICAL: PLAN CHECK ERROR:", err);
    return res.status(500).json({
      code: "PLAN_CHECK_FAILED",
      message: "An error occurred while validating your subscription."
    });
  }
};