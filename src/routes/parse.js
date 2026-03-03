console.log("🔥 ROUTE FILE ACTIVE:", import.meta.url);

import express from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";

import pool from "../config/db.js";
import { parseStatement } from "../services/parseStatement.js";
import { authenticateUser } from "../middleware/auth.middleware.js";
import { checkPlanAccess } from "../middleware/credits.middleware.js";

export const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

const parseLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30
});

router.post(
  "/",
  parseLimiter,
  authenticateUser,
  checkPlanAccess,
  upload.any(),
  async (req, res) => {
    try {
      const user = req.userRecord;
      const files = req.files || [];

      if (files.length === 0) {
        return res.status(400).json({ error: "NO_FILE_UPLOADED" });
      }

      let allTransactions = [];

      for (const file of files) {
        const result = await parseStatement(file.buffer);

        if (!result) {
          return res.status(500).json({ error: "PARSER_ERROR" });
        }

        // ===============================
        // HANDLE PARSER ERROR CODES
        // ===============================

        if (result?.errorCode === "UNSUPPORTED_BANK") {
          return res.status(400).json({
            error: "UNSUPPORTED_BANK",
            message: "This bank is not currently supported."
          });
        }

        if (result?.errorCode === "UNKNOWN_BANK") {
          return res.status(400).json({
            error: "UNKNOWN_BANK",
            message: "We could not detect the bank type."
          });
        }

        if (result?.errorCode === "PARSER_ERROR") {
          return res.status(500).json({
            error: "PARSER_ERROR"
          });
        }

        if (!Array.isArray(result.transactions) || result.transactions.length === 0) {
          return res.status(422).json({
            error: "PARSE_FAILED_OR_EMPTY"
          });
        }

        const standardized = result.transactions.map(t => ({
          ...t,
          sourceFile: file.originalname
        }));

        allTransactions = [...allTransactions, ...standardized];
      }

      // ===============================
      // 🔐 ATOMIC BILLING SECTION
      // ===============================

      let creditsDeducted = 0;

      // FREE PLAN
      if (user.plan_code === "FREE") {
        const freeResult = await pool.query(
          `
          UPDATE users
          SET lifetime_parses_used = lifetime_parses_used + 1
          WHERE id = $1
          AND lifetime_parses_used < 15
          RETURNING lifetime_parses_used
          `,
          [user.id]
        );

        if (freeResult.rowCount === 0) {
          return res.status(403).json({
            code: "FREE_LIMIT_REACHED",
            message: "Free lifetime limit reached.",
            upgrade_required: true,
            suggested_plan: "PAYG_10"
          });
        }

        creditsDeducted = 1;
      }

      // CREDIT-BASED PLANS
      else if (user.plan_code !== "PRO_YEAR_UNLIMITED") {
        const deductionResult = await pool.query(
          `
          UPDATE users
          SET credits_remaining = credits_remaining - 1
          WHERE id = $1
          AND credits_remaining > 0
          RETURNING credits_remaining
          `,
          [user.id]
        );

        if (deductionResult.rowCount === 0) {
          return res.status(403).json({
            code: "CREDITS_EXHAUSTED",
            message: "No credits remaining.",
            upgrade_required: true,
            suggested_plan: "MONTHLY_25"
          });
        }

        creditsDeducted = 1;
      }

      // PRO_YEAR_UNLIMITED → no deduction

      await pool.query(
        `
        INSERT INTO usage_logs
        (user_id, action, plan_code, credits_deducted)
        VALUES ($1, $2, $3, $4)
        `,
        [
          user.id,
          "parse_statement",
          user.plan_code,
          creditsDeducted
        ]
      );

      return res.status(200).json(allTransactions);

    } catch (error) {
      console.error("PARSE ROUTE ERROR:", error);
      return res.status(500).json({ error: "PARSE_ROUTE_FAILED" });
    }
  }
);