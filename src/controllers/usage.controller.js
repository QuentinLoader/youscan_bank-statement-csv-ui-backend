import pool from '../config/db.js';

export async function recordExport(req, res) {
  const userId = req.userRecord.id;
  const ip = req.ip;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const userResult = await client.query(
      `SELECT plan, lifetime_parses_used, credits_remaining, subscription_expires_at
       FROM users
       WHERE id = $1
       FOR UPDATE`,
      [userId]
    );

    if (userResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = userResult.rows[0];

    /**
     * FREE PLAN — Atomic update
     */
    if (user.plan === 'free') {
      const FREE_LIMIT = 15;

      const updateResult = await client.query(
        `UPDATE users
         SET lifetime_parses_used = lifetime_parses_used + 1
         WHERE id = $1
           AND lifetime_parses_used < $2`,
        [userId, FREE_LIMIT]
      );

      if (updateResult.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(403).json({ code: 'FREE_LIMIT_REACHED' });
      }
    }

    /**
     * PAY-AS-YOU-GO PLAN — Atomic decrement
     */
    if (user.plan === 'pay-as-you-go') {
      const updateResult = await client.query(
        `UPDATE users
         SET credits_remaining = credits_remaining - 1
         WHERE id = $1
           AND credits_remaining > 0`,
        [userId]
      );

      if (updateResult.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(403).json({ code: 'NO_CREDITS' });
      }

      await client.query(
        `INSERT INTO credit_transactions (user_id, type, amount, reference)
         VALUES ($1, 'deduction', 1, 'csv_export')`,
        [userId]
      );
    }

    /**
     * PRO PLAN — Expiry check
     */
    if (user.plan === 'pro') {
      if (
        !user.subscription_expires_at ||
        new Date(user.subscription_expires_at) < new Date()
      ) {
        await client.query('ROLLBACK');
        return res.status(403).json({ code: 'SUBSCRIPTION_EXPIRED' });
      }
    }

    /**
     * Usage log
     */
    await client.query(
      `INSERT INTO usage_logs (user_id, action, ip_address)
       VALUES ($1, 'export_csv', $2)`,
      [userId, ip]
    );

    await client.query('COMMIT');

    return res.status(200).json({ success: true });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('recordExport error:', err);
    return res.status(500).json({ error: 'Export recording failed' });
  } finally {
    client.release();
  }
}
