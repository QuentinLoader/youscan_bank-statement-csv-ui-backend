// 🔥 LOAD ENV FIRST
console.log("🔥 SERVER BUILD ID: 2026-03-02-CLEAN-PARSE");
import dotenv from "dotenv";
dotenv.config();

import helmet from "helmet";
import express from "express";
import cors from "cors";
import multer from "multer";
import rateLimit from "express-rate-limit";

import { parseStatement } from "./services/parseStatement.js";
import pool from "./config/db.js";

import authRoutes from "./routes/auth.routes.js";
import usageRoutes from "./routes/usage.routes.js";
import billingRoutes from "./routes/billing.routes.js";
import { router as parseRoute } from "./routes/parse.js";

import { authenticateUser } from "./middleware/auth.middleware.js";
import { checkPlanAccess } from "./middleware/credits.middleware.js";
import { PRICING } from "./config/pricing.js";

const app = express();

app.set("trust proxy", 1);

app.use(helmet());

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
});
app.use(globalLimiter);

app.use(express.json());

/* ============================
   CORS CONFIG
============================ */

const allowedOrigins = [
  process.env.FRONTEND_URL,
  "https://youscan.addvision.co.za"
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);

      if (
        allowedOrigins.includes(origin) ||
        origin.endsWith(".lovable.app") ||
        origin.endsWith(".lovableproject.com")
      ) {
        return callback(null, true);
      }

      console.warn("Blocked by CORS:", origin);
      return callback(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true
  })
);

app.options("*", cors({
  origin: allowedOrigins,
  credentials: true
}));

/* ============================
   HEALTH CHECK
============================ */

app.get("/", (req, res) =>
  res.send("YouScan Engine: Production Billing Active")
);

/* ============================
   PRICING
============================ */

app.get("/pricing", (req, res) => {
  res.json(PRICING);
});

/* ============================
   AUTH ROUTES
============================ */

app.use("/auth", authRoutes);

/* ============================
   USAGE ROUTES (if still needed)
============================ */

app.use("/usage", usageRoutes);

/* ============================
   BILLING ROUTES
============================ */

app.use("/billing", billingRoutes);

app.use("/parse", parseRoute);

/* ============================
   PARSE ROUTE (Billing Integrated)
============================ */

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

const parseLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30
});

app.post(
  "/parse",
  parseLimiter,
  authenticateUser,
  checkPlanAccess,
  upload.any(),
  async (req, res) => {
    try {
      const user = req.userRecord;
      const files = req.files || [];

      if (files.length === 0) {
        return res.status(400).json({ error: "No files uploaded" });
      }

      let allTransactions = [];

      for (const file of files) {
        const result = await parseStatement(file.buffer);

        if (!result) {
          throw new Error("Parsing failed");
        }

        const rawTransactions = result.transactions || [];

        const standardized = rawTransactions.map(t => ({
          ...t,
          sourceFile: file.originalname
        }));

        allTransactions = [...allTransactions, ...standardized];
      }

      /* ================================
         CREDIT DEDUCTION
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

      res.json(allTransactions);

    } catch (error) {
      console.error("PARSE ERROR:", error.message);
      res.status(500).json({ error: "Parsing failed" });
    }
  }
);

/* ============================
   404 HANDLER
============================ */

app.use((req, res) => {
  res.status(404).json({
    error: "NOT_FOUND",
    message: `The endpoint ${req.originalUrl} does not exist.`
  });
});

/* ============================
   GLOBAL ERROR HANDLER
============================ */

app.use((err, req, res, next) => {
  console.error("Global Error:", err.stack);
  res.status(500).json({
    error: "INTERNAL_SERVER_ERROR",
    message: "Something went wrong."
  });
});

const PORT = process.env.PORT || 8080;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 YouScan running on port ${PORT}`);
});