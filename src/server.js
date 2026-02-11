import express from "express";
import cors from "cors";
import multer from "multer";
import { parseStatement } from "./services/parseStatement.js";

const app = express();

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

/**
 * Main Route: Now supports Reconciliation Metadata
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
        
        // --- 1. HANDLE RETURN TYPE (Object vs Array) ---
        let rawTransactions = [];
        let statementMetadata = {}; // This will hold Opening/Closing balances

        if (result.transactions && Array.isArray(result.transactions)) {
          // NEW: Parser returned { metadata, transactions }
          rawTransactions = result.transactions;
          statementMetadata = result.metadata || {};
          console.log(`📊 Extracted ${rawTransactions.length} items (with metadata)`);
        } else if (Array.isArray(result)) {
          // OLD: Parser returned just [ ... ]
          rawTransactions = result;
          console.log(`📊 Extracted ${rawTransactions.length} items (legacy array)`);
        } else {
          // Fallback
          rawTransactions = [];
          console.warn(`⚠️ Warning: Parser returned unexpected format for ${file.originalname}`);
        }

        // --- 2. STANDARDIZE & INJECT METADATA ---
        const standardized = rawTransactions.map(t => ({
          ...t,
          // Standard Fields
          bankName: t.bankName || "FNB", // Default to FNB if missing
          bankLogo: t.bankLogo || "fnb",
          sourceFile: file.originalname,
          
          // RECONCILIATION DATA
          // We attach this to every row so the Frontend Grid has access to the Truth
          statementMetadata: {
            openingBalance: statementMetadata.openingBalance || 0,
            closingBalance: statementMetadata.closingBalance || 0,
            statementId: statementMetadata.statementId || "Unknown"
          }
        }));

        allTransactions = [...allTransactions, ...standardized];

      } catch (parseError) {
        console.error(`❌ Error parsing file ${file.originalname}:`, parseError.message);
        // We continue to the next file instead of crashing the whole request
      }
    }

    // Return the combined array to the frontend
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