import assert from "node:assert/strict";
import test from "node:test";

import {
  AI_DECISION_OUTCOMES,
  AI_DECISION_RISK_LEVELS,
  AI_SHADOW_STATUSES,
  evaluateAiDecisionPolicy,
} from "../ai/extraction/index.js";
import { runParseJob } from "../orchestrator/runParseJob.js";
import {
  FNB_EXPECTED_NORMALIZED,
  FNB_STATEMENT_FIXTURE_TEXT,
} from "./fixtures/fnbStatement.fixture.js";
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
  return {
    name: "mock",
    async generateStructured(request) {
      if (typeof envelopeOrHandler === "function") {
        return envelopeOrHandler(request);
      }
      return {
        content: JSON.stringify(envelopeOrHandler),
        model: "mock-extractor",
        requestId: "b14-decision-1",
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      };
    },
  };
}

function shadowReport({
  status = AI_SHADOW_STATUSES.EXACT_MATCH,
  mismatchFields = [],
  mismatchRows = [],
  countMatch = true,
  bySeverity = {},
  byCategory = {},
  byField = {},
} = {}) {
  return {
    mode: "shadow",
    attempted: status !== AI_SHADOW_STATUSES.DISABLED,
    authoritativeSource: "deterministic",
    aiCanAffectResult: false,
    status,
    comparison:
      status === AI_SHADOW_STATUSES.EXACT_MATCH ||
      status === AI_SHADOW_STATUSES.DIFFERENCES
        ? {
            metadata: { mismatchFields },
            transactions: { countMatch, mismatchRows },
          }
        : null,
    disagreement:
      status === AI_SHADOW_STATUSES.DIFFERENCES
        ? {
            issueCount:
              mismatchFields.length +
              mismatchRows.reduce((sum, row) => sum + row.fields.length, 0) +
              (countMatch ? 0 : 1),
            affectedTransactionRowCount: mismatchRows.length,
            bySeverity,
            byCategory,
            byField,
          }
        : null,
  };
}

test("Batch 14 exact AI agreement can confirm a completed deterministic parse but never auto-correct", () => {
  const decision = evaluateAiDecisionPolicy({
    shadowAi: shadowReport(),
    deterministicStatus: "completed",
    deterministicIssues: [],
  });

  assert.equal(decision.outcome, AI_DECISION_OUTCOMES.DETERMINISTIC_CONFIRMED);
  assert.equal(decision.risk, AI_DECISION_RISK_LEVELS.NONE);
  assert.equal(decision.authoritativeSource, "deterministic");
  assert.equal(decision.aiCanAutoCorrect, false);
  assert.equal(decision.aiCanChangeParseStatus, false);
});

test("Batch 14 medium-only description disagreement becomes review_ai_difference", () => {
  const decision = evaluateAiDecisionPolicy({
    shadowAi: shadowReport({
      status: AI_SHADOW_STATUSES.DIFFERENCES,
      mismatchRows: [{ rowIndex: 2, fields: ["description"] }],
      bySeverity: { medium: 1 },
      byCategory: { transaction_description: 1 },
      byField: { description: 1 },
    }),
    deterministicStatus: "completed",
  });

  assert.equal(decision.outcome, AI_DECISION_OUTCOMES.REVIEW_AI_DIFFERENCE);
  assert.equal(decision.risk, AI_DECISION_RISK_LEVELS.MEDIUM);
  assert.deepEqual(decision.reviewTargets.transactionRows, [
    { rowIndex: 2, fields: ["description"] },
  ]);
  assert.equal(decision.aiCanAutoCorrect, false);
});

test("Batch 14 transaction amount disagreement always requires manual review", () => {
  const decision = evaluateAiDecisionPolicy({
    shadowAi: shadowReport({
      status: AI_SHADOW_STATUSES.DIFFERENCES,
      mismatchRows: [{ rowIndex: 0, fields: ["amount"] }],
      bySeverity: { critical: 1 },
      byCategory: { transaction_amount: 1 },
      byField: { amount: 1 },
    }),
    deterministicStatus: "completed",
  });

  assert.equal(decision.outcome, AI_DECISION_OUTCOMES.MANUAL_REVIEW_REQUIRED);
  assert.equal(decision.risk, AI_DECISION_RISK_LEVELS.CRITICAL);
  assert.ok(decision.reasonCodes.includes("critical_ai_deterministic_disagreement"));
});

test("Batch 14 transaction date disagreement is high risk and requires manual review", () => {
  const decision = evaluateAiDecisionPolicy({
    shadowAi: shadowReport({
      status: AI_SHADOW_STATUSES.DIFFERENCES,
      mismatchRows: [{ rowIndex: 1, fields: ["date"] }],
      bySeverity: { high: 1 },
      byCategory: { transaction_date: 1 },
      byField: { date: 1 },
    }),
    deterministicStatus: "completed",
  });

  assert.equal(decision.outcome, AI_DECISION_OUTCOMES.MANUAL_REVIEW_REQUIRED);
  assert.equal(decision.risk, AI_DECISION_RISK_LEVELS.HIGH);
});

test("Batch 14 transaction-count disagreement is treated as critical manual review", () => {
  const decision = evaluateAiDecisionPolicy({
    shadowAi: shadowReport({
      status: AI_SHADOW_STATUSES.DIFFERENCES,
      countMatch: false,
      bySeverity: { critical: 1 },
      byCategory: { transaction_count: 1 },
      byField: { transactionCount: 1 },
    }),
    deterministicStatus: "completed",
  });

  assert.equal(decision.outcome, AI_DECISION_OUTCOMES.MANUAL_REVIEW_REQUIRED);
  assert.equal(decision.reviewTargets.transactionCountMismatch, true);
  assert.equal(decision.risk, AI_DECISION_RISK_LEVELS.CRITICAL);
});

test("Batch 14 unavailable AI leaves a completed deterministic result authoritative", () => {
  const decision = evaluateAiDecisionPolicy({
    shadowAi: shadowReport({ status: AI_SHADOW_STATUSES.UNAVAILABLE }),
    deterministicStatus: "completed",
  });

  assert.equal(decision.outcome, AI_DECISION_OUTCOMES.DETERMINISTIC_RETAINED);
  assert.ok(decision.reasonCodes.includes("ai_unavailable"));
});

test("Batch 14 unsafe AI candidate cannot become actionable", () => {
  const decision = evaluateAiDecisionPolicy({
    shadowAi: shadowReport({ status: AI_SHADOW_STATUSES.NEEDS_REVIEW }),
    deterministicStatus: "completed",
  });

  assert.equal(decision.outcome, AI_DECISION_OUTCOMES.DETERMINISTIC_RETAINED);
  assert.ok(decision.reasonCodes.includes("ai_candidate_requires_review"));
  assert.equal(decision.aiCanAutoCorrect, false);
});

test("Batch 14 AI exact match never clears deterministic needs_review", () => {
  const decision = evaluateAiDecisionPolicy({
    shadowAi: shadowReport({ status: AI_SHADOW_STATUSES.EXACT_MATCH }),
    deterministicStatus: "needs_review",
    deterministicIssues: [
      { issueType: "closing_balance_mismatch", rowIndex: 3, metadata: { secret: 1100 } },
    ],
  });

  assert.equal(decision.outcome, AI_DECISION_OUTCOMES.MANUAL_REVIEW_REQUIRED);
  assert.equal(decision.risk, AI_DECISION_RISK_LEVELS.HIGH);
  assert.ok(decision.reasonCodes.includes("deterministic_requires_review"));
  assert.ok(decision.reasonCodes.includes("ai_agreement_does_not_clear_validation"));
});

test("Batch 14 failed deterministic parse remains critical even if AI exists", () => {
  const decision = evaluateAiDecisionPolicy({
    shadowAi: shadowReport({ status: AI_SHADOW_STATUSES.EXACT_MATCH }),
    deterministicStatus: "failed",
    deterministicIssues: [{ issueType: "invalid_amount", rowIndex: 0 }],
  });

  assert.equal(decision.outcome, AI_DECISION_OUTCOMES.MANUAL_REVIEW_REQUIRED);
  assert.equal(decision.risk, AI_DECISION_RISK_LEVELS.CRITICAL);
  assert.ok(decision.reasonCodes.includes("deterministic_parse_failed"));
});

test("Batch 14 no shadow report is explicitly not_available", () => {
  const decision = evaluateAiDecisionPolicy({
    shadowAi: null,
    deterministicStatus: "completed",
  });

  assert.equal(decision.outcome, AI_DECISION_OUTCOMES.NOT_AVAILABLE);
  assert.equal(decision.aiCanAutoCorrect, false);
});

test("Batch 14 advisory report is privacy-safe and excludes deterministic issue metadata values", () => {
  const decision = evaluateAiDecisionPolicy({
    shadowAi: shadowReport({
      status: AI_SHADOW_STATUSES.DIFFERENCES,
      mismatchFields: ["accountNumber"],
      bySeverity: { critical: 1 },
      byCategory: { identity: 1 },
      byField: { accountNumber: 1 },
    }),
    deterministicStatus: "completed",
    deterministicIssues: [
      {
        issueType: "missing_account_number",
        metadata: { accountNumber: "62123456789", clientName: "ACME TRADING" },
      },
    ],
  });

  const serialized = JSON.stringify(decision);
  assert.equal(serialized.includes("62123456789"), false);
  assert.equal(serialized.includes("ACME TRADING"), false);
  assert.deepEqual(decision.reviewTargets.metadataFields, ["accountNumber"]);
  assert.deepEqual(decision.deterministic.issueTypes, ["missing_account_number"]);
});

test("Batch 14 runParseJob attaches deterministic_confirmed advisory after exact shadow match", async () => {
  const provider = mockProvider(makeShadowAiEnvelope());
  const result = await runParseJob({
    file: { originalname: "fnb-july-2026.pdf", mimetype: "application/pdf" },
    extractedText: FNB_STATEMENT_FIXTURE_TEXT,
    shadowAiOptions: { config: shadowConfig(), provider },
  });

  assert.equal(result.status, "completed");
  assert.deepEqual(result.result.data, FNB_EXPECTED_NORMALIZED);
  assert.equal(result.aiDecision.outcome, AI_DECISION_OUTCOMES.DETERMINISTIC_CONFIRMED);
  assert.equal(result.aiDecision.aiCanAutoCorrect, false);
  assert.equal(result.aiDecision.authoritativeSource, "deterministic");
});

test("Batch 14 runParseJob exposes a review target for an AI description difference without changing data", async () => {
  const provider = mockProvider(
    makeShadowAiEnvelope(makeFnbShadowCandidate({ omitReferenceFromDescription: true }))
  );
  const result = await runParseJob({
    file: { originalname: "fnb-july-2026.pdf", mimetype: "application/pdf" },
    extractedText: FNB_STATEMENT_FIXTURE_TEXT,
    shadowAiOptions: { config: shadowConfig(), provider },
  });

  assert.equal(result.status, "completed");
  assert.deepEqual(result.result.data, FNB_EXPECTED_NORMALIZED);
  assert.equal(result.aiDecision.outcome, AI_DECISION_OUTCOMES.REVIEW_AI_DIFFERENCE);
  assert.deepEqual(result.aiDecision.reviewTargets.transactionRows, [
    { rowIndex: 2, fields: ["description"] },
  ]);
  assert.equal(result.aiDecision.aiCanAutoCorrect, false);
});
