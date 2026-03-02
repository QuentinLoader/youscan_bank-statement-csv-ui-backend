import pool from "../db.js";

export default async function getOrCreateUsage(userId, periodKey) {
  const existing = await pool.query(
    `
    SELECT * FROM user_usage
    WHERE user_id = $1
    AND period_key = $2
    `,
    [userId, periodKey]
  );

  if (existing.rows.length > 0) {
    return existing.rows[0];
  }

  const created = await pool.query(
    `
    INSERT INTO user_usage (user_id, period_key, exports_used)
    VALUES ($1, $2, 0)
    RETURNING *
    `,
    [userId, periodKey]
  );

  return created.rows[0];
}