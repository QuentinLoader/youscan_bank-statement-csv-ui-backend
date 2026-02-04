import express from "express";
import cors from "cors";
import multer from "multer";
import { parseStatement } from "./services/parseStatement.js";

const app = express();

// 1. NUCLEAR CORS (Enhanced for production/dev flexibility)
app.use(cors({
  origin: '*', 
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false 
}));

app.options('*', cors()); 
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

// Health Check
app.get("/", (req, res) => res.send("YouScan Engine: Global Access Active"));

/**
 * Main Route: Supports both single and multiple file uploads
 * Instruction: In Lovable, ensure the FormData key is 'files'
 */
app.post("/parse", upload.array("files"), async (req, res) => {
  try {
    const files = req.files || (req.file ? [req.file] : []);
    if (files.length === 0) return res.status(400).json({ error: "No files uploaded" });
    
    let allTransactions = [];

    for (const file of files) {
      console.log(`✅ YouScan received: ${file.originalname}`);
      
      // The parseStatement function should now return { transactions, bankInfo }
      const result = await parseStatement(file.buffer);
      
      // Standardize the response with bank metadata for Lovable UI
      const transactionsWithMetadata = (result.transactions || []).map(t => ({
        ...t,
        bankName: result.bankName,
        bankLogo: result.bankLogo, // URL or ID for Lovable to show logo
        fileName: file.originalname
      }));

      allTransactions = [...allTransactions, ...transactionsWithMetadata];
      console.log(`📊 Detected Bank: ${result.bankName} (${result.transactions.length} transactions)`);
    }

    res.json(allTransactions);
  } catch (error) {
    console.error("❌ YouScan Error:", error.message);
    res.status(500).json({ error: "Parsing failed", details: error.message });
  }
});

/**
 * Simple Auth Gate (Optional Backend Validation for '007')
 */
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
  console.log(`🚀 YouScan running on ${PORT}`);
});