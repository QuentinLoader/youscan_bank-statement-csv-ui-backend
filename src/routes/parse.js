import express from "express";
import multer from "multer";
import pool from "../config/db.js";
import { parseStatement } from "../services/parseStatement.js";
import { authenticateUser } from "../middleware/auth.middleware.js";
import { deductUserCredit } from "../services/billing.service.js";

export const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post(
  "/",
  authenticateUser,
  upload.single("file"),
  async (req, res) => {
    const client = await pool.connect();

    try {
      const userId = req.user.userId;

      if (!req.file) {
        return res.status(400).json({ error: "NO_FILE_UPLOADED" });
      }

      console.log("File received in route, passing to service...");

      const result = await parseStatement(req.file.buffer);

      if (!result || !result.transactions || !result.transactions.length) {
        return res.status(422).json({
          error: "PARSE_FAILED_OR_EMPTY"
        });
      }

      const detectedBank =
        (result.bankName || "").toLowerCase();

      // 🔒 BLOCK STANDARD BANK BEFORE CREDIT DEDUCTION
      if (detectedBank.includes("standard bank")) {
        return res.status(400).json({
          error: "UNSUPPORTED_BANK",
          message:
            "Standard Bank statements are currently not supported."
        });
      }

      // ✅ Deduct credit safely (atomic inside billing.service)
      await deductUserCredit(userId);

      // Optional usage logging
      await client.query(
        `INSERT INTO usage_logs
         (user_id, action, credits_deducted)
         VALUES ($1, $2, $3)`,
        [userId, "parse_statement", 1]
      );

      return res.status(200).json(result);

    } catch (error) {
      console.error("Parse Route Error:", error);

      if (error.message === "FREE_LIMIT_REACHED") {
        return res.status(402).json({ error: "FREE_LIMIT_REACHED" });
      }

      if (error.message === "CREDITS_EXHAUSTED") {
        return res.status(402).json({ error: "CREDITS_EXHAUSTED" });
      }

      if (error.message === "SUBSCRIPTION_EXPIRED") {
        return res.status(402).json({ error: "SUBSCRIPTION_EXPIRED" });
      }

      return res.status(500).json({
        error: "PARSE_ROUTE_FAILED"
      });

    } finally {
      client.release();
    }
  }
);