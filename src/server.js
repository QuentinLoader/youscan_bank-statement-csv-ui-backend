import express from "express";
import cors from "cors";
import multer from "multer";
import { parseStatement } from "./services/parseStatement.js";

const app = express();

// 1. IMPROVED CORS - Allows all your Vercel preview links
app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    
    // This allows localhost OR any URL that ends with .vercel.app
    if (origin.startsWith("http://localhost") || origin.endsWith(".vercel.app")) {
      return callback(null, true);
    } else {
      console.log("⚠️ Blocked Origin:", origin);
      return callback(new Error("CORS Not Allowed"), false);
    }
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

app.options('*', cors()); 
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

app.get("/", (req, res) => res.send("SlimJan Backend is Online"));

app.post("/parse", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    
    console.log(`✅ Processing: ${req.file.originalname}`);
    const transactions = await parseStatement(req.file.buffer);

    // FIX: Ensure we always return an array, even if empty
    const safeTransactions = transactions || [];
    
    console.log(`🚀 Sending ${safeTransactions.length} transactions back to frontend`);
    res.json(safeTransactions);
  } catch (error) {
    console.error("❌ Parser Crash:", error.message);
    res.status(500).json([]); // Send empty array so frontend doesn't crash on .length
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Engine running on port ${PORT}`);
});