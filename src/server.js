// 🔥 LOAD ENV FIRST
import dotenv from "dotenv";
dotenv.config();

console.log("🔥 SERVER FILE VERSION: Billing Authoritative + Usage Endpoint Active");
console.log("DATABASE_URL exists:", !!process.env.DATABASE_URL);

import helmet from "helmet";
import express from "express";
import cors from "cors";
import multer from "multer";
import rateLimit from "express-rate-limit";

import { parseStatement } from "./services/parseStatement.js";
import pool from "./config/db.js";

import authRoutes from "./routes/auth.routes.js";
import usageRoutes from "./routes/usage.routes.js";

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

const allowedOrigin = process.env.FRONTEND_URL;

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);

    if (
      origin === allowedOrigin ||
      origin.endsWith(".lovable.app") ||
      origin.endsWith(".lovableproject.com")
    ) {
      return callback(null, true);
    }

    console.warn("Blocked by CORS:", origin);
    return callback(null, false);
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true
}));

app.options("*", cors());

/* ============================
   HEALTH CHECK
============================ */
app.get("/", (req, res) =>
  res.send("YouScan Engine: Production Billing Active")
);

/* ============================
   PRICING ENDPOINT
============================ */
app.get("/pricing", (req, res) => {
  res.json(PRICING);
});

/* ============================
   AUTH ROUTES
============================ */
app.use("/auth", authRoutes);

/* ============================
   USAGE ROUTES (NEW)
============================ */
app.use("/usage", usageRoutes);

/* ============================
   PARSE ROUTE
   ⚠ NO BILLING HERE ANYMORE
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

      res.json(allTransactions);

    } catch (error) {
      console.error("PARSE ERROR:", error.message);
      res.status(500).json({ error: "Parsing failed" });
    }
  }
);

/* ============================
   GLOBAL ERROR HANDLING
============================ */

app.use((req, res) => {
  res.status(404).json({
    error: "NOT_FOUND",
    message: `The endpoint ${req.originalUrl} does not exist.`
  });
});

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
