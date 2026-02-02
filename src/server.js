import express from "express";
import cors from "cors";
import multer from "multer";
import { parseStatement } from "./services/parseStatement.js";

const app = express();

// 1. ROBUST CORS SETUP
const allowedOrigins = [
  "http://localhost:5173",
  "https://slimjan-bank-statement-csv-ui.vercel.app",
  "https://bank-statement-csv-frontend.vercel.app"
];

app.use(cors({
  origin: function (origin, callback) {
    // 1. Allow mobile apps/curl (no origin)
    if (!origin) return callback(null, true);
    
    // 2. Check if it's in our list
    if (allowedOrigins.indexOf(origin) !== -1) {
      return callback(null, true);
    } else {
      // 3. LOG THE ACTUAL ORIGIN so you can see it in Railway!
      console.log("⚠️ CORS Warning: Request from unknown origin:", origin);
      // For now, allow it so the app works, but log it so we can fix the list later
      return callback(null, true); 
    }
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// Handle Preflight
app.options('*', cors()); 

app.use(express.json());
const upload = multer({ storage: multer.memoryStorage() });

// Health Checks
app.get("/", (req, res) => res.send("SlimJan Backend is Online"));
app.get("/health", (req, res) => res.json({ status: "UP" }));

// Main Route
app.post("/parse", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    
    console.log(`✅ Received: ${req.file.originalname}`);
    const transactions = await parseStatement(req.file.buffer);
    res.json(transactions);
  } catch (error) {
    console.error("❌ Parsing Error:", error.message);
    res.status(500).json({ error: "PARSE_FAILED", details: error.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

export default app;