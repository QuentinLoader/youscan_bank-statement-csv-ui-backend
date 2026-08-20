import assert from "node:assert/strict";
import test from "node:test";

import { AI_TASKS } from "../ai/contracts.js";
import {
  AI_BANK_STATEMENT_EXTRACTION_SYSTEM_PROMPT,
  AI_SHADOW_COMPARISON_STATUSES,
  AI_SHADOW_STATUSES,
  aiBankStatementExtractor,
  compareAiToDeterministicBankStatement,
  projectAiBankStatementCandidate,
  runAiBankStatementShadow,
} from "../ai/extraction/index.js";
import { runParseJob } from "../orchestrator/runParseJob.js";
import { DOCUMENT_SUBTYPES } from "../registry/documentTypes.js";
import { FNB_EXPECTED_NORMALIZED, FNB_STATEMENT_FIXTURE_TEXT } from "./fixtures/fnbStatement.fixture.js";
import {
  makeFnbShadowCandidate,
  makeShadowAiEnvelope,
} from "./fixtures/aiBankStatementShadow.fixture.js";

function shadowConfig(overrides = {}) {
  return {
    enabled: true,
    classifierEnabled: false,
    extractionEnabled: true,
    provider: "mock",
    model: "mock-extractor",
    timeoutMs: 200,
    maxInputChars: 120_000,
    classificationMaxInputChars: 30_000,
    classificationMinConfidence: 0.92,
    extractionMinConfidence: 0.95,
    extractionFieldMinConfidence: 0.95,
    ...overrides,
  };
}

function mockProvider(envelopeOrHandler) {
  let calls = 0;
  let lastRequest = null;
  return {
    name: "mock",
    get calls() {
      return calls;
    },
    get lastRequest() {
      return lastRequest;
    },
    async generateStructured(request) {
      calls += 1;
      lastRequest = request;
      if (typeof envelopeOrHandler === "function") {
        return envelopeOrHandler(request);
      }
      return {
        content: JSON.stringify(envelopeOrHandler),
        model: "mock-extractor",
        requestId: "shadow-req-1",
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      };
    },
  };
}

function deterministicCanonical(overrides = {}) {
  return {
    ...structuredClone(FNB_EXPECTED_NORMALIZED),
    ...overrides,
  };
}

test("Batch 12 extraction prompt requires source-order completeness, nulls instead of guesses, and evidence", () => {
  assert.match(AI_BANK_STATEMENT_EXTRACTION_SYSTEM_PROMPT, /every transaction in source order/i);
  assert.match(AI_BANK_STATEMENT_EXTRACTION_SYSTEM_PROMPT, /return null rather than deriving/i);
  assert.match(AI_BANK_STATEMENT_EXTRACTION_SYSTEM_PROMPT, /evidence snippets copied/i);
  assert.match(AI_BANK_STATEMENT_EXTRACTION_SYSTEM_PROMPT, /do not inflate confidence/i);
});

test("Batch 12 AI extractor runs only the strict extract_bank_statement task", async () => {
  const provider = mockProvider(makeShadowAiEnvelope());
  const result = await aiBankStatementExtractor({
    extractedText: FNB_STATEMENT_FIXTURE_TEXT,
    config: shadowConfig(),
    provider,
  });

  assert.equal(provider.calls, 1);
  assert.equal(provider.lastRequest.task, AI_TASKS.EXTRACT_BANK_STATEMENT);
  assert.equal(provider.lastRequest.input.documentText.includes("First National Bank"), true);
  assert.equal(Object.keys(provider.lastRequest.input).length, 1);
  assert.equal(result.data.transactionCount, 4);
  assert.equal(result.meta.provider, "mock");
});

test("Batch 12 AI extractor remains independently disabled when extraction flag is off", async () => {
  const provider = mockProvider(makeShadowAiEnvelope());
  await assert.rejects(
    () =>
      aiBankStatementExtractor({
        extractedText: FNB_STATEMENT_FIXTURE_TEXT,
        config: shadowConfig({ extractionEnabled: false }),
        provider,
      }),
    (error) => error.code === "V2_AI_DISABLED"
  );
  assert.equal(provider.calls, 0);
});

test("Batch 12 comparison normalizes equivalent statement-period date formats", () => {
  const aiCanonical = projectAiBankStatementCandidate(makeFnbShadowCandidate(), {
    sourceFileName: "fnb-july-2026.pdf",
  });
  const comparison = compareAiToDeterministicBankStatement({
    aiCanonical,
    deterministicCanonical: deterministicCanonical(),
  });

  assert.equal(comparison.status, AI_SHADOW_COMPARISON_STATUSES.EXACT_MATCH);
  assert.equal(comparison.exactMatch, true);
  assert.equal(comparison.matchScore, 1);
  assert.deepEqual(comparison.metadata.mismatchFields, []);
});

test("Batch 12 comparison reports field names and row indexes, never mismatched values", () => {
  const aiCanonical = projectAiBankStatementCandidate(
    makeFnbShadowCandidate({ omitReferenceFromDescription: true }),
    { sourceFileName: "fnb-july-2026.pdf" }
  );
  const comparison = compareAiToDeterministicBankStatement({
    aiCanonical,
    deterministicCanonical: deterministicCanonical(),
  });

  assert.equal(comparison.status, AI_SHADOW_COMPARISON_STATUSES.DIFFERENCES);
  assert.equal(comparison.exactMatch, false);
  assert.deepEqual(comparison.transactions.mismatchRows, [
    { rowIndex: 2, fields: ["description"] },
  ]);
  const serialized = JSON.stringify(comparison);
  assert.equal(serialized.includes("INV-7781"), false);
  assert.equal(serialized.includes("62123456789"), false);
  assert.equal(serialized.includes("ACME TRADING"), false);
  assert.equal(serialized.includes("1150"), false);
});

test("Batch 12 transaction-count disagreements are explicit comparison differences", () => {
  const aiCanonical = projectAiBankStatementCandidate(makeFnbShadowCandidate(), {
    sourceFileName: "fnb-july-2026.pdf",
  });
  aiCanonical.transactions.pop();

  const comparison = compareAiToDeterministicBankStatement({
    aiCanonical,
    deterministicCanonical: deterministicCanonical(),
  });

  assert.equal(comparison.exactMatch, false);
  assert.equal(comparison.transactions.countMatch, false);
  assert.equal(comparison.transactions.aiCount, 3);
  assert.equal(comparison.transactions.deterministicCount, 4);
  assert.equal(comparison.status, AI_SHADOW_COMPARISON_STATUSES.DIFFERENCES);
});

test("Batch 12 amount disagreements are identified without exposing either amount", () => {
  const aiCanonical = projectAiBankStatementCandidate(makeFnbShadowCandidate(), {
    sourceFileName: "fnb-july-2026.pdf",
  });
  aiCanonical.transactions[0].amount = -90;

  const comparison = compareAiToDeterministicBankStatement({
    aiCanonical,
    deterministicCanonical: deterministicCanonical(),
  });

  assert.deepEqual(comparison.transactions.mismatchRows[0], {
    rowIndex: 0,
    fields: ["amount"],
  });
  const serialized = JSON.stringify(comparison);
  assert.equal(serialized.includes("-90"), false);
  assert.equal(serialized.includes("-100"), false);
});

test("Batch 12 disabled shadow mode does not call the provider", async () => {
  const provider = mockProvider(makeShadowAiEnvelope());
  const report = await runAiBankStatementShadow({
    extractedText: FNB_STATEMENT_FIXTURE_TEXT,
    deterministicCanonical: deterministicCanonical(),
    classification: { documentSubtype: DOCUMENT_SUBTYPES.FNB_STATEMENT },
    config: shadowConfig({ extractionEnabled: false }),
    provider,
  });

  assert.equal(report.status, AI_SHADOW_STATUSES.DISABLED);
  assert.equal(report.attempted, false);
  assert.equal(report.aiCanAffectResult, false);
  assert.equal(provider.calls, 0);
});

test("Batch 12 eligible AI candidate can shadow-compare as an exact match", async () => {
  const provider = mockProvider(makeShadowAiEnvelope());
  const report = await runAiBankStatementShadow({
    extractedText: FNB_STATEMENT_FIXTURE_TEXT,
    sourceFileName: "fnb-july-2026.pdf",
    deterministicCanonical: deterministicCanonical(),
    classification: { documentSubtype: DOCUMENT_SUBTYPES.FNB_STATEMENT },
    config: shadowConfig(),
    provider,
  });

  assert.equal(report.status, AI_SHADOW_STATUSES.EXACT_MATCH);
  assert.equal(report.attempted, true);
  assert.equal(report.aiCanAffectResult, false);
  assert.equal(report.authoritativeSource, "deterministic");
  assert.equal(report.assessment.eligibleForComparison, true);
  assert.equal(report.comparison.exactMatch, true);
  assert.equal(report.comparison.matchScore, 1);
});

test("Batch 12 an internally valid AI difference is measured but cannot replace deterministic output", async () => {
  const provider = mockProvider(
    makeShadowAiEnvelope(makeFnbShadowCandidate({ omitReferenceFromDescription: true }))
  );
  const report = await runAiBankStatementShadow({
    extractedText: FNB_STATEMENT_FIXTURE_TEXT,
    sourceFileName: "fnb-july-2026.pdf",
    deterministicCanonical: deterministicCanonical(),
    classification: { documentSubtype: DOCUMENT_SUBTYPES.FNB_STATEMENT },
    config: shadowConfig(),
    provider,
  });

  assert.equal(report.status, AI_SHADOW_STATUSES.DIFFERENCES);
  assert.equal(report.aiCanAffectResult, false);
  assert.deepEqual(report.comparison.transactions.mismatchRows, [
    { rowIndex: 2, fields: ["description"] },
  ]);
});

test("Batch 12 a low-confidence AI candidate is not compared", async () => {
  const provider = mockProvider(makeShadowAiEnvelope(undefined, { confidence: 0.90 }));
  const report = await runAiBankStatementShadow({
    extractedText: FNB_STATEMENT_FIXTURE_TEXT,
    sourceFileName: "fnb-july-2026.pdf",
    deterministicCanonical: deterministicCanonical(),
    classification: { documentSubtype: DOCUMENT_SUBTYPES.FNB_STATEMENT },
    config: shadowConfig(),
    provider,
  });

  assert.equal(report.status, AI_SHADOW_STATUSES.NEEDS_REVIEW);
  assert.equal(report.assessment.eligibleForComparison, false);
  assert.equal(report.comparison, null);
  assert.ok(report.assessment.issueTypes.includes("low_envelope_confidence"));
});

test("Batch 12 contract-invalid AI output is unavailable/rejected before comparison", async () => {
  const bad = makeFnbShadowCandidate();
  bad.transactions[0].amount.value = "not-a-number";
  const provider = mockProvider(makeShadowAiEnvelope(bad));

  const report = await runAiBankStatementShadow({
    extractedText: FNB_STATEMENT_FIXTURE_TEXT,
    deterministicCanonical: deterministicCanonical(),
    classification: { documentSubtype: DOCUMENT_SUBTYPES.FNB_STATEMENT },
    config: shadowConfig(),
    provider,
  });

  // runAiTask enforces the strict contract before the Batch 11 assessment.
  assert.equal(report.status, AI_SHADOW_STATUSES.UNAVAILABLE);
  assert.equal(report.comparison, null);
  assert.equal(report.errorCode, "V2_AI_INVALID_RESPONSE");
});

test("Batch 12 provider failure is isolated from the deterministic result and does not expose upstream text", async () => {
  const provider = mockProvider(() => {
    throw new Error("secret provider body with account 62123456789");
  });
  const report = await runAiBankStatementShadow({
    extractedText: FNB_STATEMENT_FIXTURE_TEXT,
    deterministicCanonical: deterministicCanonical(),
    classification: { documentSubtype: DOCUMENT_SUBTYPES.FNB_STATEMENT },
    config: shadowConfig(),
    provider,
  });

  assert.equal(report.status, AI_SHADOW_STATUSES.UNAVAILABLE);
  assert.equal(report.aiCanAffectResult, false);
  assert.equal(report.errorCode, "V2_AI_PROVIDER_FAILED");
  assert.equal(JSON.stringify(report).includes("62123456789"), false);
  assert.equal(JSON.stringify(report).includes("secret provider body"), false);
});

test("Batch 12 runParseJob attaches an exact shadow report without changing deterministic output", async () => {
  const provider = mockProvider(makeShadowAiEnvelope());
  const result = await runParseJob({
    file: { originalname: "fnb-july-2026.pdf", mimetype: "application/pdf" },
    extractedText: FNB_STATEMENT_FIXTURE_TEXT,
    extractionMeta: { sourceType: "test" },
    shadowAiOptions: {
      config: shadowConfig(),
      provider,
    },
  });

  assert.equal(result.status, "completed");
  assert.deepEqual(result.result.data, FNB_EXPECTED_NORMALIZED);
  assert.equal(result.shadowAi.status, AI_SHADOW_STATUSES.EXACT_MATCH);
  assert.equal(result.shadowAi.aiCanAffectResult, false);
  assert.equal(provider.calls, 1);
  const shadowSerialized = JSON.stringify(result.shadowAi);
  assert.equal(shadowSerialized.includes("62123456789"), false);
  assert.equal(shadowSerialized.includes("ACME TRADING"), false);
  assert.equal(shadowSerialized.includes("Coffee Shop"), false);
});

test("Batch 12 runParseJob keeps deterministic completed status when AI finds a shadow difference", async () => {
  const provider = mockProvider(
    makeShadowAiEnvelope(makeFnbShadowCandidate({ omitReferenceFromDescription: true }))
  );
  const result = await runParseJob({
    file: { originalname: "fnb-july-2026.pdf", mimetype: "application/pdf" },
    extractedText: FNB_STATEMENT_FIXTURE_TEXT,
    shadowAiOptions: {
      config: shadowConfig(),
      provider,
    },
  });

  assert.equal(result.status, "completed");
  assert.deepEqual(result.result.data, FNB_EXPECTED_NORMALIZED);
  assert.equal(result.shadowAi.status, AI_SHADOW_STATUSES.DIFFERENCES);
  assert.equal(result.shadowAi.comparison.exactMatch, false);
  assert.equal(result.shadowAi.aiCanAffectResult, false);
});

test("Batch 12 runParseJob remains completed when shadow AI provider is unavailable", async () => {
  const provider = mockProvider(() => {
    throw new Error("provider down");
  });
  const result = await runParseJob({
    file: { originalname: "fnb-july-2026.pdf", mimetype: "application/pdf" },
    extractedText: FNB_STATEMENT_FIXTURE_TEXT,
    shadowAiOptions: {
      config: shadowConfig(),
      provider,
    },
  });

  assert.equal(result.status, "completed");
  assert.deepEqual(result.result.data, FNB_EXPECTED_NORMALIZED);
  assert.equal(result.shadowAi.status, AI_SHADOW_STATUSES.UNAVAILABLE);
  assert.equal(result.shadowAi.aiCanAffectResult, false);
});
