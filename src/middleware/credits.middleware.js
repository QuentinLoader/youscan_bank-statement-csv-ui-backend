import pool from "../config/db.js";

export const enforceCredits = async (req, res, next) => {
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

    // BASIC PLAN (subscription active)
    if (user.plan === "basic") {
      if (user.subscription_expires_at && new Date(user.subscription_expires_at) > new Date()) {
        return next(); // unlimited access
      } else {
        return res.status(403).json({ message: "Subscription expired" });
      }
    }

    // FREE OR PAYG → check credits
    if (user.credits_remaining <= 0) {
      return res.status(403).json({ message: "No credits remaining" });
    }

    // Deduct 1 credit
    await pool.query(
      "UPDATE users SET credits_remaining = credits_remaining - 1 WHERE id = $1",
      [userId]
    );

    // Log usage
    await pool.query(
      "INSERT INTO usage_logs (user_id, action) VALUES ($1, $2)",
      [userId, "statement_upload"]
    );

    next();

  } catch (err) {
    console.error("CREDIT ERROR:", err);
    res.status(500).json({ message: "Credit check failed" });
  }
};
