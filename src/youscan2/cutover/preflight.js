import pool from "../../config/db.js";
import { buildCutoverReadiness } from "./readiness.js";

async function main() {
  try {
    const report = await buildCutoverReadiness({ dbPool: pool });
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.ready ? 0 : 1;
  } catch (error) {
    console.error(JSON.stringify({
      ready: false,
      engine: "youscan-v2",
      error: error?.code || "CUTOVER_PREFLIGHT_FAILED",
    }));
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => {});
  }
}

await main();
