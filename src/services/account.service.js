import bcrypt from "bcrypt";
import crypto from "crypto";
import pool from "../config/db.js";

export class AccountServiceError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "AccountServiceError";
    this.code = code;
    this.status = status;
  }
}

function validateNewPassword(value) {
  const password = String(value || "");
  if (password.length < 8) {
    throw new AccountServiceError(
      "PASSWORD_TOO_SHORT",
      "Password must be at least 8 characters.",
      400
    );
  }
  return password;
}

export async function changePasswordForUser({
  userId,
  currentPassword,
  newPassword,
  dbPool = pool,
  bcryptImpl = bcrypt,
} = {}) {
  if (!userId) throw new AccountServiceError("USER_NOT_FOUND", "User account not found.", 404);
  if (!currentPassword) throw new AccountServiceError("CURRENT_PASSWORD_REQUIRED", "Current password required.");
  const nextPassword = validateNewPassword(newPassword);

  const result = await dbPool.query(
    `SELECT id, password_hash FROM users WHERE id = $1 LIMIT 1`,
    [userId]
  );
  const user = result.rows[0];
  if (!user) throw new AccountServiceError("USER_NOT_FOUND", "User account not found.", 404);

  const valid = await bcryptImpl.compare(String(currentPassword), user.password_hash);
  if (!valid) {
    throw new AccountServiceError("CURRENT_PASSWORD_INVALID", "Current password is incorrect.", 400);
  }

  const same = await bcryptImpl.compare(nextPassword, user.password_hash);
  if (same) {
    throw new AccountServiceError("PASSWORD_UNCHANGED", "New password must be different from the current password.", 400);
  }

  const hashed = await bcryptImpl.hash(nextPassword, 10);
  await dbPool.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [hashed, userId]);
  return { success: true };
}

export async function resendVerificationForUser({
  userId,
  dbPool = pool,
  sendEmail = null,
  randomBytes = crypto.randomBytes,
} = {}) {
  if (!userId) throw new AccountServiceError("USER_NOT_FOUND", "User account not found.", 404);

  const result = await dbPool.query(
    `SELECT id, email, is_verified FROM users WHERE id = $1 LIMIT 1`,
    [userId]
  );
  const user = result.rows[0];
  if (!user) throw new AccountServiceError("USER_NOT_FOUND", "User account not found.", 404);

  if (user.is_verified) {
    return { success: true, alreadyVerified: true };
  }

  const rawToken = randomBytes(32).toString("hex");
  const hashedToken = crypto.createHash("sha256").update(rawToken).digest("hex");
  await dbPool.query(
    `UPDATE users SET verification_token = $1 WHERE id = $2`,
    [hashedToken, userId]
  );
  const sender = sendEmail || (async (email, token) => {
    const module = await import("../utils/email.js");
    return module.sendVerificationEmail(email, token);
  });
  await sender(user.email, rawToken);

  return { success: true, alreadyVerified: false };
}
