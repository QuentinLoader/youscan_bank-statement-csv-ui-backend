// 🔥 LOAD ENV FIRST — BEFORE ANYTHING ELSE
import dotenv from "dotenv";
dotenv.config();

console.log("🔥 SERVER FILE VERSION: 12 Feb - JWT Protected");
console.log("DATABASE_URL exists:", !!process.env.DATABASE_URL);

import express from "express";
import cors from "cors";
import multer from "multer";
import { parseStatement } from "./services/parseStatement.js";
import pool from "./config/db.js";
import authRoutes from "./routes/auth.routes.js";

// ✅ NEW IMPORTS
import { authenticateUser } from "./middleware/auth.middleware.js";
import { checkPlanAccess } from "./middleware/credits.middleware.js";

const app = express();

/* ============================
   DB DEBUG (temporary)
============================ */
app.get("/db-debug", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT current_database(), inet_server_addr(), inet_server_port()"
    );
    res.json(result.rows);
  } catch (err) {
    console.error("DB DEBUG ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ============================
   CORS
============================ */
app.use(cors({
  origin: '*', 
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false 
}));

app.options('*', cors()); 
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

/* ============================
   Health Check
============================ */
app.get("/", (req, res) => 
  res.send("YouScan Engine: Global Access Active")
);

/* ============================
   Auth Routes
============================ */
app.use("/auth", authRoutes);

/* ============================
   PROTECTED PARSE ROUTE
============================ */
app.post(
  "/parse",
  authenticateUser,   // 🔐 Step 1: Verify JWT
  enforceCredits,     // 💳 Step 2: Check & deduct credits
  upload.any(),
  async (req, res) => {
    try {
      const files = req.files || [];

      if (files.length === 0) {
        return res.status(400).json({ error: "No files uploaded" });
      }

      let allTransactions = [];

      for (const file of files) {
        try {
          const result = await parseStatement(file.buffer);

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
            continue;
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

        } catch (parseError) {
          console.error("Parse error:", parseError.message);
        }
      }

      res.json(allTransactions);

    } catch (error) {
      console.error("Global Error:", error.message);
      res.status(500).json({ error: "Parsing failed" });
    }
  }
);

/* ============================
   Simple Auth Gate (Legacy)
============================ */
app.post("/verify-gate", (req, res) => {
  const { code } = req.body;

  if (code === "007") {
    res.json({ success: true, token: "youscan-access-granted" });
  } else {
    res.status(401).json({ success: false, message: "Invalid Access Code" });
  }
});

const PORT = process.env.PORT || 8080;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 YouScan running on port ${PORT}`);
});
