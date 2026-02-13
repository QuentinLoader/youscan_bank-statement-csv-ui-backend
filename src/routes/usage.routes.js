import express from "express";
import { recordExport } from "../controllers/usage.controller.js";
import { authenticateUser } from "../middleware/auth.middleware.js";

const router = express.Router();

/**
 * POST /usage/record-export
 * Backend-authoritative export deduction.
 * Must succeed before frontend generates CSV.
 */
router.post("/record-export", authenticateUser, recordExport);

export default router;
