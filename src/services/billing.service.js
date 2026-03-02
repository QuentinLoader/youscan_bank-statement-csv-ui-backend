import pool from "../config/db.js";

export async function deductUserCredit(userId) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 🔒 Lock user row
    const { rows } = await client.query(
      "SELECT * FROM users WHERE id = $1 FOR UPDATE",
      [userId]
    );

    if (!rows.length) {
      throw new Error("USER_NOT_FOUND");
    }

    const user = rows[0];
    const now = new Date();

    /* =============================
       FREE PLAN
    ============================= */
    if (user.plan_code === "FREE") {
      if (user.lifetime_parses_used >= 15) {
        throw new Error("FREE_LIMIT_REACHED");
      }

      await client.query(
        `UPDATE users
         SET lifetime_parses_used = lifetime_parses_used + 1
         WHERE id = $1`,
        [userId]
      );
    }

    /* =============================
       PAYG_10
    ============================= */
    else if (user.plan_code === "PAYG_10") {
      if (user.credits_remaining <= 0) {
        throw new Error("CREDITS_EXHAUSTED");
      }

      await client.query(
        `UPDATE users
         SET credits_remaining = credits_remaining - 1
         WHERE id = $1`,
        [userId]
      );
    }

    /* =============================
       MONTHLY_25
    ============================= */
    else if (user.plan_code === "MONTHLY_25") {

      // Reset cycle if expired
      if (!user.billing_cycle_end || new Date(user.billing_cycle_end) < now) {
        await client.query(
          `UPDATE users
           SET credits_remaining = 25,
               billing_cycle_end = NOW() + INTERVAL '1 month'
           WHERE id = $1`,
          [userId]
        );

        user.credits_remaining = 25;
      }

      if (user.credits_remaining <= 0) {
        throw new Error("CREDITS_EXHAUSTED");
      }

      await client.query(
        `UPDATE users
         SET credits_remaining = credits_remaining - 1
         WHERE id = $1`,
        [userId]
      );
    }

    /* =============================
       PRO_YEAR_UNLIMITED
    ============================= */
    else if (user.plan_code === "PRO_YEAR_UNLIMITED") {

      if (
        user.subscription_status !== "active" ||
        !user.renewal_date ||
        new Date(user.renewal_date) < now
      ) {
        throw new Error("SUBSCRIPTION_EXPIRED");
      }

      // Unlimited → no deduction
    }

    else {
      throw new Error("INVALID_PLAN");
    }

    await client.query("COMMIT");

    return true;

  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}