import express from "express";
import multer from "multer";
import pool from "../config/db.js";
import { parseStatement } from "../services/parseStatement.js";
import { authenticateUser } from "../middleware/auth.middleware.js";
import { checkPlanAccess } from "../middleware/credits.middleware.js";

export const router = express.Router();

// Handle file in memory
const upload = multer({ storage: multer.memoryStorage() });

/**
 * Because app.js uses "/parse",
 * this "/" maps to "/parse"
 */
router.post(
  "/",
  authenticateUser,
  checkPlanAccess,
  upload.single("file"),
  async (req, res) => {
    try {
      const user = req.userRecord;

      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      console.log("File received in route, passing to service...");

      const result = await parseStatement(req.file.buffer);

      if (!result) {
        throw new Error("Parsing failed");
      }

      /* ================================
         CREDIT DEDUCTION (MVP CLEAN)
      ================================= */

      if (user.plan_code === "FREE") {
        await pool.query(
          `UPDATE users
           SET lifetime_parses_used = lifetime_parses_used + 1
           WHERE id = $1`,
          [user.id]
        );
      } 
      else if (user.plan_code !== "PRO_YEAR_UNLIMITED") {
        await pool.query(
          `UPDATE users
           SET credits_remaining = credits_remaining - 1
           WHERE id = $1`,
          [user.id]
        );
      }

      // Optional usage logging
      await pool.query(
        `INSERT INTO usage_logs
         (user_id, action, plan_code, credits_deducted)
         VALUES ($1, $2, $3, $4)`,
        [
          user.id,
          "parse_statement",
          user.plan_code,
          user.plan_code === "PRO_YEAR_UNLIMITED" ? 0 : 1
        ]
      );

      return res.status(200).json(result);

    } catch (error) {
      console.error("Route Error:", error.message);
      return res.status(500).json({ error: error.message });
    }
  }
);