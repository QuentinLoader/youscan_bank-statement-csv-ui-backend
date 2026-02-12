import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import pool from "../config/db.js";
import { authenticateUser } from "../middleware/auth.middleware.js";
import { sendVerificationEmail } from "../utils/email.js";

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

    // Generate secure token
    const rawToken = crypto.randomBytes(32).toString("hex");
    const hashedToken = crypto
      .createHash("sha256")
      .update(rawToken)
      .digest("hex");

    const result = await pool.query(
      `INSERT INTO users 
        (email, password_hash, plan, credits_remaining, is_verified, verification_token)
       VALUES ($1, $2, 'free', 15, false, $3)
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

    console.error("REGISTER ERROR");
    res.status(500).json({ message: "Registration failed" });
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

    const hashedToken = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");

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
    console.error("VERIFY ERROR");
    res.status(500).json({ message: "Verification failed" });
  }
});

/* ============================
   RESEND VERIFICATION
============================ */
router.post("/resend-verification", authenticateUser, async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query(
      `SELECT email, is_verified FROM users WHERE id = $1`,
      [userId]
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.is_verified) {
      return res.status(400).json({ message: "Already verified" });
    }

    const rawToken = crypto.randomBytes(32).toString("hex");
    const hashedToken = crypto
      .createHash("sha256")
      .update(rawToken)
      .digest("hex");

    await pool.query(
      `UPDATE users SET verification_token = $1 WHERE id = $2`,
      [hashedToken, userId]
    );

    await sendVerificationEmail(user.email, rawToken);

    res.json({ message: "Verification email sent" });

  } catch (err) {
    console.error("RESEND ERROR");
    res.status(500).json({ message: "Resend failed" });
  }
});

/* ============================
   LOGIN
============================ */
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const result = await pool.query(
      "SELECT * FROM users WHERE email = $1",
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
    console.error("LOGIN ERROR");
    res.status(500).json({ message: "Login failed" });
  }
});

export default router;
