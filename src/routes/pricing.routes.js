import express from "express";
import { PRICING } from "../config/pricing.js";

const router = express.Router();

router.get("/", (req, res) => {
  res.json(PRICING);
});

export default router;
