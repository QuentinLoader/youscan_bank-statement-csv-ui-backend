import dotenv from "dotenv";
dotenv.config();
import express from "express";
import cors from "cors";
import multer from "multer";
import { parseStatement } from "./services/parseStatement.js";
import pool from "./config/db.js"; //temp - delete

/* ✅ ADD THIS LINE */
import authRoutes from "./routes/auth.routes.js";

const app = express();

// 1. Temp - check the connection
app.get("/db-debug", async (req, res) => {
  const result = await pool.query("SELECT current_database()");
  res.json(result.rows);
});

// 1. NUCLEAR CORS (Allows everything for development)
app.use(cors({
  origin: '*', 
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false 
}));

app.options('*', cors()); 
app.use(express.json());

// Using MemoryStorage for fast, temporary processing
const upload = multer({ storage: multer.memoryStorage() });

// Health Check
app.get("/", (req, res) => res.send("YouScan Engine: Global Access Active"));

/* ✅ ADD THIS BLOCK (Mount Auth Routes) */
app.use("/auth", authRoutes);

/**
 * Main Route: Smart Unwrap Logic
 */
app.post("/parse", upload.any(), async (req, res) => {
  try {
    const files = req.files || [];
    
    if (files.length === 0) {
      console.error("❌ Request received but no files found in req.files");
      return res.status(400).json({ error: "No files uploaded" });
    }
    
    console.log(`📂 Processing ${files.length} file(s)...`);
    let allTransactions = [];

    for (const file of files) {
      console.log(`✅ YouScan processing: ${file.originalname} (Field: ${file.fieldname})`);
      
      try {
        const result = await parseStatement(file.buffer);
        
        // --- SMART UNWRAP LOGIC ---
        let rawTransactions = [];
        let statementMetadata = {}; 
        let detectedBankName = "FNB"; // Default
        let detectedBankLogo = "fnb";

        if (result.transactions && Array.isArray(result.transactions)) {
          rawTransactions = result.transactions;
          statementMetadata = result.metadata || {};
          if (result.bankName) detectedBankName = result.bankName;
          if (result.bankLogo) detectedBankLogo = result.bankLogo;
        } 
        else if (result.transactions && result.transactions.transactions && Array.isArray(result.transactions.transactions)) {
          console.log("🔧 Fixing double-nested transactions from middleware...");
          rawTransactions = result.transactions.transactions;
          statementMetadata = result.transactions.metadata || {};
          if (result.bankName) detectedBankName = result.bankName;
        }
        else if (Array.isArray(result)) {
          rawTransactions = result;
        } 
        else {
          console.warn(`⚠️ Warning: Parser returned unexpected format for ${file.originalname}`);
          console.log("Debug dump:", JSON.stringify(result).substring(0, 200)); 
          continue;
        }

        console.log(`📊 Extracted ${rawTransactions.length} items from ${detectedBankName} (Balance: ${statementMetadata.openingBalance || '?'} -> ${statementMetadata.closingBalance || '?'})`);

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
        console.error(`❌ Error parsing file ${file.originalname}:`, parseError.message);
      }
    }

    res.json(allTransactions);

  } catch (error) {
    console.error("❌ YouScan Global Error:", error.message);
    res.status(500).json({ error: "Parsing failed", details: error.message });
  }
});

/**
 * Simple Auth Gate
 */
app.post("/verify-gate", (req, res) => {
  const { code } = req.body;
  if (code === "007") {
    console.log("🔓 Access Granted: Code 007 matched.");
    res.json({ success: true, token: "youscan-access-granted" });
  } else {
    console.warn("🔒 Access Denied: Incorrect code entered.");
    res.status(401).json({ success: false, message: "Invalid Access Code" });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 YouScan running on port ${PORT}`);
});
