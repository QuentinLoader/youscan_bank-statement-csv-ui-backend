// 🔥 LOAD ENV FIRST — BEFORE ANYTHING ELSE
import dotenv from "dotenv";
dotenv.config();

console.log("🔥 SERVER FILE VERSION: Production Hardened + Billing Secured + Idempotent Webhook + Robust CORS");
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
import { PRICING } from "./config/pricing.js";

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
   ROBUST CORS CONFIGURATION
============================ */

const allowedOrigin = process.env.FRONTEND_URL;

app.use(cors({
  origin: (origin, callback) => {

    // Allow server-to-server (no origin header)
    if (!origin) return callback(null, true);

    // Allow primary frontend domain
    if (origin === allowedOrigin) {
      return callback(null, true);
    }

    // Allow ALL Lovable preview / project domains
    if (
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

// Explicit preflight handler
app.options("*", cors());

/* ============================
   FILE UPLOAD CONFIG
============================ */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024
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

      const user = req.userRecord;

      await client.query("BEGIN");

      if (user.plan === "free") {
        await client.query(
          `UPDATE users
           SET lifetime_parses_used = lifetime_parses_used + 1
           WHERE id = $1`,
          [user.id]
        );
      }

      if (user.plan === "pay-as-you-go") {
        await client.query(
          `UPDATE users
           SET credits_remaining = credits_remaining - 1
           WHERE id = $1`,
          [user.id]
        );

        await client.query(
          `INSERT INTO credit_transactions
           (user_id, type, amount, reference)
           VALUES ($1, 'deduction', -1, 'statement_parse')`,
          [user.id]
        );
      }

      await client.query(
        `INSERT INTO usage_logs (user_id, action, ip_address)
         VALUES ($1, $2, $3)`,
        [user.id, "statement_upload", req.ip]
      );

      await client.query("COMMIT");

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
   OZOW WEBHOOK (HARDENED + IDEMPOTENT + SECRET)
============================ */
app.post("/payments/ozow-webhook", async (req, res) => {
  const client = await pool.connect();

  try {

    if (req.query.secret !== process.env.OZOW_WEBHOOK_SECRET) {
      return res.sendStatus(403);
    }

    const {
      email,
      status,
      payment_type,
      amount_cents,
      external_reference
    } = req.body;

    if (!email || !external_reference) {
      return res.sendStatus(400);
    }

    if (status !== "SUCCESS") {
      return res.sendStatus(200);
    }

    await client.query("BEGIN");

    const existingPayment = await client.query(
      `SELECT id FROM payments WHERE external_reference = $1`,
      [external_reference]
    );

    if (existingPayment.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.sendStatus(200);
    }

    const userResult = await client.query(
      `SELECT id FROM users WHERE email = $1`,
      [email]
    );

    const user = userResult.rows[0];
    if (!user) {
      await client.query("ROLLBACK");
      return res.sendStatus(200);
    }

    if (payment_type === "subscription") {

      if (amount_cents !== PRICING.PRO_MONTHLY.price_cents) {
        throw new Error("Subscription amount mismatch");
      }

      await client.query(
        `INSERT INTO payments
         (user_id, provider, payment_type, amount_cents, status, external_reference)
         VALUES ($1, 'ozow', 'subscription', $2, 'success', $3)`,
        [user.id, amount_cents, external_reference]
      );

      await client.query(
        `UPDATE users
         SET plan = 'pro',
             subscription_expires_at = NOW() + interval '1 month'
         WHERE id = $1`,
        [user.id]
      );
    }

    if (payment_type === "credit_10") {

      const bundle = PRICING.CREDIT_BUNDLES.CREDIT_10;

      if (amount_cents !== bundle.price_cents) {
        throw new Error("Credit bundle amount mismatch");
      }

      await client.query(
        `INSERT INTO payments
         (user_id, provider, payment_type, amount_cents, status, external_reference)
         VALUES ($1, 'ozow', 'credit_bundle', $2, 'success', $3)`,
        [user.id, amount_cents, external_reference]
      );

      await client.query(
        `UPDATE users
         SET plan = 'pay-as-you-go',
             credits_remaining = credits_remaining + $1
         WHERE id = $2`,
        [bundle.credits, user.id]
      );

      await client.query(
        `INSERT INTO credit_transactions
         (user_id, type, amount, reference)
         VALUES ($1, 'purchase', $2, 'credit_bundle')`,
        [user.id, bundle.credits]
      );
    }

    await client.query("COMMIT");

    return res.sendStatus(200);

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("OZOW WEBHOOK ERROR:", err.message);
    return res.sendStatus(500);
  } finally {
    client.release();
  }
});

const PORT = process.env.PORT || 8080;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 YouScan running on port ${PORT}`);
});
