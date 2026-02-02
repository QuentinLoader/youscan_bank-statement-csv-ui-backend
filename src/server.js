import express from "express";
import cors from "cors";
import multer from "multer";
import { parseStatement } from "./services/parseStatement.js";

const app = express();

// 1. UPDATED CORS SETUP
// This allows your local computer AND your Vercel site to talk to this backend
const allowedOrigins = [
  "http://localhost:5173",
  "https://slimjan-bank-statement-csv-ui.vercel.app" 
];

app.use(cors({
  origin: function (origin, callback) {
    // allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// Important: Handle the preflight OPTIONS request specifically
app.options('*', cors()); 

app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

// Health check for Railway
app.get("/", (req, res) => {
  res.send("SlimJan Backend is Online");
});

app.get("/health", (req, res) => {
  res.json({ status: "UP", timestamp: new Date().toISOString() });
});

// Main parsing route
app.post("/parse", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }
    console.log(`Received file: ${req.file.originalname}`);
    const transactions = await parseStatement(req.file.buffer);
    res.json(transactions);
  } catch (error) {
    console.error("Parsing Error:", error.message);
    res.status(500).json({ 
      error: "FAILED_TO_PARSE", 
      message: error.message 
    });
  }
});

const PORT = process.env.PORT || 8080;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 SlimJan engine started on port ${PORT}`);
});

export default app;