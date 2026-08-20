/**
 * YouScan V2 Batch 16 migration runner.
 * Usage: node src/youscan2/review/runMigration.js
 */

import "dotenv/config";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pool from "../../config/db.js";

const sqlUrl = new URL("./migrations/001_review_workflow.sql", import.meta.url);
const sql = await fs.readFile(fileURLToPath(sqlUrl), "utf8");

try {
  await pool.query(sql);
  console.log("YouScan V2 review workflow migration applied successfully.");
} finally {
  await pool.end();
}
