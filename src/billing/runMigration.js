/**
 * YouScan Paystack billing migration runner.
 * Usage: node src/billing/runMigration.js
 */

import "dotenv/config";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pool from "../config/db.js";

const sqlUrl = new URL("./migrations/001_payment_transactions.sql", import.meta.url);
const sql = await fs.readFile(fileURLToPath(sqlUrl), "utf8");

try {
  await pool.query(sql);
  console.log("YouScan payment_transactions migration applied successfully.");
} finally {
  await pool.end();
}
