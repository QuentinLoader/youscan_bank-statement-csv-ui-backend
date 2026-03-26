// ==========================================
// 🔥 SERVER BUILD: 2026-03-23-FINAL-STABLE
// ==========================================

import dotenv from "dotenv";
dotenv.config();

import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";

// Route & Webhook Imports
import ozowWebhook from "./webhooks/ozow.webhook.js";
import ozowPaymentRoutes from "./routes/ozow.payment.routes.js";
import authRoutes from "./routes/auth.routes.js";
import usageRoutes from "./routes/usage.routes.js";
import { router as parseRoute } from "./routes/parse.js";
import { PRICING } from "./config/pricing.js";
import adminRoutes from "./routes/admin.js";

const app = express();
app.set("trust proxy", 1);

/* =========================================
   CORS CONFIGURATION
========================================= */
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const allowedOrigins = [
        "https://youscan.addvision.co.za",
        "http://localhost:3000" // Added for local testing
      ];
      
      if (
        allowedOrigins.includes(origin) || 
        origin.endsWith(".lovable.app") || 
        origin.endsWith(".lovableproject.com")
      ) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

app.options("*", cors());

/* =========================================
   OZOW WEBHOOK (MUST BE BEFORE JSON PARSER)
========================================= */
app.use("/ozow", ozowWebhook);

/* =========================================
   ADMIN ROUTE
========================================= */
app.use("/api/admin", adminRoutes);

/* =========================================
   STANDARD MIDDLEWARE
========================================= */
app.use(helmet());
app.use(express.json());

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500, // Increased for production stability
});
app.use(globalLimiter);

/* =========================================
   ROUTES
========================================= */

// Payment Routes (Handles /billing/create-ozow-payment)
app.use("/billing", ozowPaymentRoutes);

// Core Logic Routes
app.use("/auth", authRoutes);
app.use("/usage", usageRoutes);
app.use("/parse", parseRoute);

app.get("/", (req, res) => res.send("YouScan Engine: Billing Active"));
app.get("/pricing", (req, res) => res.json(PRICING));

/* =========================================
   GET HEALTHROUTES
========================================= */

app.get("/health/routes", (req, res) => {
  res.json({
    ok: true,
    routes: {
      pricing: "/pricing",
      billingCreateOzowPayment: "/billing/create-ozow-payment",
      ozowWebhook: "/ozow/webhook",
      parse: "/parse",
      auth: "/auth",
      usage: "/usage"
    }
  });
});


/* =========================================
   ERROR HANDLERS
========================================= */
app.use((req, res) => {
  res.status(404).json({
    error: "NOT_FOUND",
    message: `The endpoint ${req.originalUrl} does not exist.`,
  });
});

app.use((err, req, res, next) => {
  console.error("Global Error:", err.stack);
  res.status(500).json({
    error: "INTERNAL_SERVER_ERROR",
    message: "Something went wrong.",
  });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 YouScan running on port ${PORT}`);
});