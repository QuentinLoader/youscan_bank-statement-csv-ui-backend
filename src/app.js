import express from "express";
import cors from "cors";

import healthRoute from "./routes/health.js";
import parseRoute from "./routes/parse.js";
import exportRoute from "./routes/export.js";

const app = express();

// CORS (needed for frontend + Insomnia)
app.use(cors({ origin: true }));

// ROUTES — THIS IS WHAT MATTERS
app.use("/health", healthRoute);
app.use("/parse", parseRoute);
app.use("/export", exportRoute);

// 404 fallback
app.use((req, res) => {
  res.status(404).json({
    error: "NOT_FOUND",
    message: "Endpoint does not exist"
  });
});

export default app;
