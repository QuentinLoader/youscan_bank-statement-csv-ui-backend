import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import pool from "../config/db.js";
import { authenticateUser } from "../middleware/auth.middleware.js";
import { sendVerificationEmail, sendPasswordResetEmail } from "../utils/email.js";

const router = express.Router();

/* ============================
   REGISTER
============================ */
router.post("/register", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Missing email or password" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const rawToken = crypto.randomBytes(32).toString("hex");
    const hashedToken = crypto.createHash("sha256").update(rawToken).digest("hex");

    const result = await pool.query(
      `INSERT INTO users 
        (
          email,
          password_hash,
          plan_code,
          credits_remaining,
          lifetime_parses_used,
          subscription_status,
          billing_cycle_start,
          billing_cycle_end,
          renewal_date,
          is_verified,
          verification_token
        )
       VALUES (
          $1,$2,'FREE',0,0,'inactive',NULL,NULL,NULL,false,$3
        )
       RETURNING id`,
      [email, hashedPassword, hashedToken]
    );

    await sendVerificationEmail(email, rawToken);

    const token = jwt.sign(
      { userId: result.rows[0].id },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    res.json({ token });

  } catch (err) {
    if (err.code === "23505") {
      return res.status(400).json({ message: "Email already registered" });
    }

    console.error("REGISTER ERROR", err);
    res.status(500).json({ message: "Registration failed" });
  }
});

/* ============================
   FORGOT PASSWORD
============================ */
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: "Email required" });
    }

    const result = await pool.query(
      `SELECT id FROM users WHERE email = $1`,
      [email]
    );

    if (result.rows.length === 0) {
      // Silent success (security best practice)
      return res.json({ message: "If the email exists, a reset link has been sent." });
    }

    const user = result.rows[0];

    const rawToken = crypto.randomBytes(32).toString("hex");
    const hashedToken = crypto.createHash("sha256").update(rawToken).digest("hex");

    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await pool.query(
      `UPDATE users
       SET reset_password_token = $1,
           reset_password_expires = $2
       WHERE id = $3`,
      [hashedToken, expires, user.id]
    );

    await sendPasswordResetEmail(email, rawToken);

    res.json({ message: "If the email exists, a reset link has been sent." });

  } catch (err) {
    console.error("FORGOT PASSWORD ERROR", err);
    res.status(500).json({ message: "Password reset failed" });
  }
});

/* ============================
   RESET PASSWORD
============================ */
router.post("/reset-password", async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({ message: "Token and new password required" });
    }

    const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

    const result = await pool.query(
      `SELECT id, reset_password_expires
       FROM users
       WHERE reset_password_token = $1`,
      [hashedToken]
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(400).json({ message: "Invalid or expired token" });
    }

    if (new Date(user.reset_password_expires) < new Date()) {
      return res.status(400).json({ message: "Token expired" });
    }

    const newHashedPassword = await bcrypt.hash(newPassword, 10);

    await pool.query(
      `UPDATE users
       SET password_hash = $1,
           reset_password_token = NULL,
           reset_password_expires = NULL
       WHERE id = $2`,
      [newHashedPassword, user.id]
    );

    res.json({ message: "Password reset successful" });

  } catch (err) {
    console.error("RESET PASSWORD ERROR", err);
    res.status(500).json({ message: "Password reset failed" });
  }
});

/* ============================
   VERIFY EMAIL
============================ */
router.post("/verify-email", async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ message: "Token required" });
    }

    const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

    const result = await pool.query(
      `SELECT id FROM users WHERE verification_token = $1`,
      [hashedToken]
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(400).json({ message: "Invalid or expired token" });
    }

    await pool.query(
      `UPDATE users
       SET is_verified = true,
           verification_token = NULL
       WHERE id = $1`,
      [user.id]
    );

    res.json({ message: "Email verified successfully" });

  } catch (err) {
    console.error("VERIFY ERROR", err);
    res.status(500).json({ message: "Verification failed" });
  }
});

/* ============================
   LOGIN
============================ */
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const result = await pool.query(
      "SELECT id, password_hash FROM users WHERE email = $1",
      [email]
    );

    const user = result.rows[0];

    if (!user)
      return res.status(400).json({ message: "Invalid credentials" });

    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword)
      return res.status(400).json({ message: "Invalid credentials" });

    const token = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    res.json({ token });

  } catch (err) {
    console.error("LOGIN ERROR", err);
    res.status(500).json({ message: "Login failed" });
  }
});

/* ============================
   GET CURRENT USER
============================ */
router.get("/me", authenticateUser, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT email,
              plan_code,
              credits_remaining,
              lifetime_parses_used,
              subscription_status,
              renewal_date,
              billing_cycle_end,
              is_verified
       FROM users
       WHERE id = $1`,
      [req.user.userId]
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json(user);

  } catch (err) {
    console.error("ME ERROR", err);
    res.status(500).json({ message: "Failed to fetch user" });
  }
});

export default router;