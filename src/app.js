import express from "express";
import cors from "cors";

import healthRoute from "./routes/health.js";
import parseRoute from "./routes/parse.js";
import exportRoute from "./routes/export.js";

const app = express();

/**
 * Global middleware
 * -----------------
 * - CORS: allow frontend (Vercel) + local dev
 * - JSON parsing only where needed (export)
 */
app.use(
  cors({
    origin: true,
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"]
  })
);

/**
 * Routes
 * ------
 * Keep these explicit and boring.
 */
app.use("/health", healthRoute);
app.use("/parse", parseRoute);
app.use("/export", exportRoute);

/**
 * Unknown route hard stop
 * -----------------------
 * Prevents accidental exposure of internals
 */
app.use((req, res) => {
  res.status(404).json({
    error: "NOT_FOUND",
    message: "Endpoint does not exist"
  });
});

/**
 * Global error handler (fail loudly, consistently)
 */
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);

  res.status(500).json({
    error: "INTERNAL_SERVER_ERROR",
    message: "An unexpected error occurred"
  });
});

export default app;
