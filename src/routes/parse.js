import express from "express";
import multer from "multer";
import pool from "../config/db.js";
import { parseStatement } from "../services/parseStatement.js";
import { authenticateUser } from "../middleware/auth.middleware.js";
import { deductUserCredit } from "../services/billing.service.js";

// 🔥 PROVE WHICH FILE IS RUNNING
console.log("🔥 ACTIVE PARSE ROUTE FILE:", import.meta.url);

export const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post(
  "/",
  authenticateUser,
  upload.single("file"),
  async (req, res) => {

    console.log("🔥 /parse ROUTE HIT");
    console.log("🔥 FILE:", import.meta.url);

    const client = await pool.connect();

    try {
      const userId = req.user.userId;
      console.log("👤 User ID:", userId);

      if (!req.file) {
        console.log("🚫 NO_FILE_UPLOADED");
        return res.status(400).json({ error: "NO_FILE_UPLOADED" });
      }

      console.log("📥 File received in route, passing to service...");

      const result = await parseStatement(req.file.buffer);

      console.log("🧠 Raw parseStatement result:");
      console.dir(result, { depth: null });

      // ==========================================================
      // 🚨 OPTIONAL HARD TEST (UNCOMMENT TO FORCE VERIFY ROUTE)
      // ==========================================================
      // return res.status(418).json({ test: "ACTIVE_PARSE_ROUTE_CONFIRMED" });

      // ==========================================================
      // 1️⃣ HANDLE PARSER ERROR CODES FIRST
      // ==========================================================

      if (result?.errorCode) {
        console.log("🚫 Parser returned errorCode:", result.errorCode);

        if (result.errorCode === "UNSUPPORTED_BANK") {
          return res.status(400).json({
            error: "UNSUPPORTED_BANK",
            message: "This bank is not currently supported."
          });
        }

        if (result.errorCode === "UNKNOWN_BANK") {
          return res.status(400).json({
            error: "UNKNOWN_BANK",
            message: "We could not detect the bank type."
          });
        }

        if (result.errorCode === "PARSER_ERROR") {
          return res.status(500).json({
            error: "PARSER_ERROR"
          });
        }
      }

      // ==========================================================
      // 2️⃣ VALIDATE TRANSACTION STRUCTURE
      // ==========================================================

      if (
        !result ||
        !Array.isArray(result.transactions) ||
        result.transactions.length === 0
      ) {
        console.log("⚠️ No transactions detected.");
        console.log("⚠️ Result shape:", result);

        return res.status(422).json({
          error: "PARSE_FAILED_OR_EMPTY"
        });
      }

      // ==========================================================
      // 3️⃣ DEDUCT CREDIT (Atomic inside billing.service)
      // ==========================================================

      await deductUserCredit(userId);
      console.log("💳 Credit deducted for user:", userId);

      await client.query(
        `INSERT INTO usage_logs
         (user_id, action, credits_deducted)
         VALUES ($1, $2, $3)`,
        [userId, "parse_statement", 1]
      );

      console.log("✅ Returning structured result to frontend");

      // ==========================================================
      // 4️⃣ RETURN FULL STRUCTURED RESULT
      // ==========================================================

      return res.status(200).json(result);

    } catch (error) {

      console.error("❌ Parse Route Error:", error);

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
      console.log("🔚 DB client released");
    }
  }
);