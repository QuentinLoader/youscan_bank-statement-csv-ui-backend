// Canonical production entry point; extraction is served by /api/v2/parse.

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
import { PRICING } from "./config/pricing.js";
import adminRoutes from "./routes/admin.js";
import youscan2ReviewRoutes from "./youscan2/review/review.routes.js";
import youscan2ParseRoutes from "./youscan2/api/parse.routes.js";

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
        "http://localhost:3000", // Added for local testing
        ...String(process.env.FRONTEND_ALLOWED_ORIGINS || "").split(",").map(value => value.trim()).filter(value => /^https:\/\/[^/]+$/.test(value))
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
app.use("/api/v2/parse", youscan2ParseRoutes);
app.use("/api/v2/reviews", youscan2ReviewRoutes);

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
    billingStatus: "/billing/status",
    billingPaymentStatus: "/billing/payment-status",
      ozowWebhook: "/ozow/webhook",
      v2Parse: "/api/v2/parse",
      v2AnalysisAvailability: "/api/v2/parse/availability",
      v2Reviews: "/api/v2/reviews",
      adminCutoverReadiness: "/api/admin/cutover-readiness",
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
