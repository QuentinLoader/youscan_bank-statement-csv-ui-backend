import assert from "node:assert/strict";
import test from "node:test";

import { PRICING } from "../../config/pricing.js";
import {
  REQUIRED_TABLES,
  buildCutoverReadiness,
  evaluateCutoverConfiguration,
} from "../cutover/readiness.js";

function readyEnv() {
  return {
    DATABASE_URL: "postgresql://synthetic",
    JWT_SECRET: "synthetic-jwt",
    OZOW_SITE_CODE: "synthetic-site",
    OZOW_PRIVATE_KEY: "synthetic-ozow",
    YOUSCAN_V2_REVIEW_PERSISTENCE_ENABLED: "true",
    YOUSCAN_V2_REVIEW_ENCRYPTION_KEY: Buffer.alloc(32, 5).toString("base64"),
    YOUSCAN_V2_AI_ENABLED: "true",
    YOUSCAN_V2_AI_PROVIDER: "openai",
    YOUSCAN_V2_AI_MODEL: "gpt-5.6",
    OPENAI_API_KEY: "synthetic-openai",
    YOUSCAN_V2_AI_CLASSIFIER_ENABLED: "true",
    YOUSCAN_V2_AI_EXTRACTION_ENABLED: "true",
  };
}

function tableDb(missing = []) {
  return {
    async query(sql, params) {
      assert.equal(String(sql).includes("to_regclass"), true);
      const names = params[0];
      return {
        rows: names.map((name) => ({ name, present: !missing.includes(name) })),
      };
    },
  };
}

test("Batch 19 cutover configuration is ready only when commercial, review, and AI secrets/flags are present", () => {
  const report = evaluateCutoverConfiguration(readyEnv(), PRICING);
  assert.equal(report.ready, true);
  assert.equal(report.checks.every((item) => item.ok), true);
});

test("Batch 19 cutover configuration fails closed without AI extraction or a valid review key", () => {
  const env = readyEnv();
  env.YOUSCAN_V2_AI_EXTRACTION_ENABLED = "false";
  env.YOUSCAN_V2_REVIEW_ENCRYPTION_KEY = Buffer.alloc(16).toString("base64");
  const report = evaluateCutoverConfiguration(env, PRICING);
  assert.equal(report.ready, false);
  assert.equal(report.checks.find((item) => item.name === "ai_extraction_enabled").ok, false);
  assert.equal(report.checks.find((item) => item.name === "review_encryption_key").ok, false);
});

test("Batch 19 cutover readiness requires all existing commercial and V2 review tables", async () => {
  const report = await buildCutoverReadiness({ env: readyEnv(), dbPool: tableDb() });
  assert.equal(report.ready, true);
  assert.deepEqual(Object.keys(report.database.tables).sort(), [...REQUIRED_TABLES].sort());
});

test("Batch 19 cutover readiness fails when an existing commercial table is missing", async () => {
  const report = await buildCutoverReadiness({ env: readyEnv(), dbPool: tableDb(["usage_logs"]) });
  assert.equal(report.ready, false);
  assert.equal(report.database.tables.usage_logs, false);
});

test("Batch 19 readiness report is privacy-safe and never returns secret values", async () => {
  const env = readyEnv();
  const report = await buildCutoverReadiness({ env, dbPool: tableDb() });
  const serialized = JSON.stringify(report);
  for (const secret of [env.JWT_SECRET, env.OZOW_PRIVATE_KEY, env.OPENAI_API_KEY, env.YOUSCAN_V2_REVIEW_ENCRYPTION_KEY]) {
    assert.equal(serialized.includes(secret), false);
  }
});
