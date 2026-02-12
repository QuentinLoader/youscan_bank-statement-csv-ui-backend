import pool from "../config/db.js";

export const checkPlanAccess = async (req, res, next) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query(
      "SELECT * FROM users WHERE id = $1",
      [userId]
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    req.userRecord = user;

    // PRO PLAN → unlimited if active
    if (user.plan === "pro") {
      if (
        user.subscription_expires_at &&
        new Date(user.subscription_expires_at) > new Date()
      ) {
        return next();
      } else {
        return res.status(403).json({ message: "Subscription expired" });
      }
    }

    // FREE or PAYG → check credits only (do NOT deduct yet)
    if (user.credits_remaining <= 0) {
      return res.status(403).json({ message: "No credits remaining" });
    }

    next();

  } catch (err) {
    console.error("PLAN CHECK ERROR:", err);
    res.status(500).json({ message: "Plan check failed" });
  }
};
