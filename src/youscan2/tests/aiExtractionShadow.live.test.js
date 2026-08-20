import assert from "node:assert/strict";
import test from "node:test";

import { getAiConfig } from "../ai/config.js";
import {
  AI_SHADOW_STATUSES,
  runAiBankStatementShadow,
} from "../ai/extraction/index.js";
import { DOCUMENT_SUBTYPES } from "../registry/documentTypes.js";
import {
  FNB_EXPECTED_NORMALIZED,
  FNB_STATEMENT_FIXTURE_TEXT,
} from "./fixtures/fnbStatement.fixture.js";

const liveEnabled =
  String(process.env.YOUSCAN_V2_AI_EXTRACTION_LIVE_TEST || "").toLowerCase() ===
  "true";

const liveTest = liveEnabled ? test : test.skip;

liveTest("Batch 12 optional live OpenAI extraction shadow smoke test", async () => {
  const config = getAiConfig();
  assert.equal(config.enabled, true);
  assert.equal(config.extractionEnabled, true);

  const report = await runAiBankStatementShadow({
    extractedText: FNB_STATEMENT_FIXTURE_TEXT,
    sourceFileName: "synthetic-fnb-july-2026.pdf",
    deterministicCanonical: FNB_EXPECTED_NORMALIZED,
    classification: { documentSubtype: DOCUMENT_SUBTYPES.FNB_STATEMENT },
    config,
  });

  assert.equal(report.attempted, true);
  assert.equal(report.aiCanAffectResult, false);
  assert.equal(report.authoritativeSource, "deterministic");
  assert.notEqual(report.status, AI_SHADOW_STATUSES.UNAVAILABLE);
  assert.notEqual(report.status, AI_SHADOW_STATUSES.REJECTED);

  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes("62123456789"), false);
  assert.equal(serialized.includes("ACME TRADING"), false);
  assert.equal(serialized.includes("Coffee Shop"), false);
});
