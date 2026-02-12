// 🔥 LOAD ENV FIRST — BEFORE ANYTHING ELSE
import dotenv from "dotenv";
dotenv.config();

console.log("🔥 SERVER FILE VERSION: Production Hardened + Secured");
console.log("DATABASE_URL exists:", !!process.env.DATABASE_URL);

import helmet from "helmet";
import express from "express";
import cors from "cors";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { parseStatement } from "./services/parseStatement.js";
import pool from "./config/db.js";
import authRoutes from "./routes/auth.routes.js";
import { authenticateUser } from "./middleware/auth.middleware.js";
import { checkPlanAccess } from "./middleware/credits.middleware.js";

const app = express();

/* ============================
   REQUIRED FOR RAILWAY / PROXY
============================ */
app.set("trust proxy", 1);

/* ============================
   SECURITY MIDDLEWARE
============================ */
app.use(helmet());

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false
});
app.use(globalLimiter);

app.use(express.json());

/* ============================
   CORS (ALLOW PROD + LOVABLE)
============================ */
const allowedOrigin = process.env.FRONTEND_URL;

app.use(cors({
  origin: function (origin, callback) {

    // Allow Postman / Insomnia / non-browser
    if (!origin) return callback(null, true);

    // Allow main production frontend
    if (origin === allowedOrigin) {
      return callback(null, true);
    }

    // Allow any Lovable preview domains
    if (
      origin.endsWith(".lovable.app") ||
      origin.endsWith(".lovableproject.com")
    ) {
      return callback(null, true);
    }

    return callback(new Error("Not allowed by CORS"));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false
}));

/* ============================
   FILE UPLOAD CONFIG
============================ */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  }
});

/* ============================
   HEALTH CHECK
============================ */
app.get("/", (req, res) =>
  res.send("YouScan Engine: Secure Production Active")
);

/* ============================
   AUTH ROUTES
============================ */
app.use("/auth", authRoutes);

/* ============================
   PARSE RATE LIMITER
============================ */
const parseLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30
});

/* ============================
   PROTECTED PARSE ROUTE
============================ */
app.post(
  "/parse",
  parseLimiter,
  authenticateUser,
  checkPlanAccess,
  upload.any(),
  async (req, res) => {

    const client = await pool.connect();

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

        let rawTransactions = [];
        let statementMetadata = {};
        let detectedBankName = "FNB";
        let detectedBankLogo = "fnb";

        if (result.transactions && Array.isArray(result.transactions)) {
          rawTransactions = result.transactions;
          statementMetadata = result.metadata || {};
          if (result.bankName) detectedBankName = result.bankName;
          if (result.bankLogo) detectedBankLogo = result.bankLogo;
        }
        else if (
          result.transactions &&
          result.transactions.transactions &&
          Array.isArray(result.transactions.transactions)
        ) {
          rawTransactions = result.transactions.transactions;
          statementMetadata = result.transactions.metadata || {};
          if (result.bankName) detectedBankName = result.bankName;
        }
        else if (Array.isArray(result)) {
          rawTransactions = result;
        }
        else {
          throw new Error("Invalid parse structure");
        }

        const standardized = rawTransactions.map(t => ({
          ...t,
          bankName: t.bankName || detectedBankName,
          bankLogo: t.bankLogo || detectedBankLogo,
          sourceFile: file.originalname,
          statementMetadata: {
            openingBalance: statementMetadata.openingBalance || 0,
            closingBalance: statementMetadata.closingBalance || 0,
            statementId: statementMetadata.statementId || "Unknown"
          }
        }));

        allTransactions = [...allTransactions, ...standardized];
      }

      // CREDIT DEDUCTION AFTER SUCCESS
      const user = req.userRecord;

      if (user.plan === "free" || user.plan === "pay-as-you-go") {

        await client.query("BEGIN");

        await client.query(
          "UPDATE users SET credits_remaining = credits_remaining - 1 WHERE id = $1",
          [user.id]
        );

        await client.query(
          `INSERT INTO usage_logs (user_id, action, ip_address)
           VALUES ($1, $2, $3)`,
          [user.id, "statement_upload", req.ip]
        );

        await client.query("COMMIT");
      }

      res.json(allTransactions);

    } catch (error) {

      await client.query("ROLLBACK");

      console.error("PARSE ERROR:", error.message);
      res.status(500).json({ error: "Parsing failed" });

    } finally {
      client.release();
    }
  }
);

/* ============================
   OZOW WEBHOOK (PLACEHOLDER)
============================ */
app.post("/payments/ozow-webhook", async (req, res) => {
  try {
    const { email, status, subscription_end } = req.body;

    if (status !== "SUCCESS") {
      return res.sendStatus(200);
    }

    await pool.query(
      `UPDATE users 
       SET plan = 'pro',
           subscription_expires_at = $1
       WHERE email = $2`,
      [subscription_end, email]
    );

    res.sendStatus(200);

  } catch (err) {
    console.error("OZOW WEBHOOK ERROR");
    res.sendStatus(500);
  }
});

const PORT = process.env.PORT || 8080;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 YouScan running on port ${PORT}`);
});
