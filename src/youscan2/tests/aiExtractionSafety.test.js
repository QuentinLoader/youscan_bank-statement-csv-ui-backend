import assert from "node:assert/strict";
import test from "node:test";

import { getAiConfig } from "../ai/config.js";
import {
  AI_BANK_STATEMENT_EXTRACTION_RESPONSE_SCHEMA,
  AI_EXTRACTION_DISPOSITIONS,
  assessAiBankStatementExtraction,
  projectAiBankStatementCandidate,
  validateAiBankStatementExtractionData,
  verifyAiExtractionEvidence,
} from "../ai/extraction/index.js";
import {
  AI_BANK_STATEMENT_SOURCE_TEXT,
  makeValidAiBankStatementCandidate,
} from "./fixtures/aiBankStatementExtraction.fixture.js";

function assess(overrides = {}) {
  return assessAiBankStatementExtraction({
    candidate: makeValidAiBankStatementCandidate(),
    envelopeConfidence: 0.99,
    sourceText: AI_BANK_STATEMENT_SOURCE_TEXT,
    sourceFileName: "synthetic-fnb.pdf",
    expectedBankName: "FNB",
    minEnvelopeConfidence: 0.95,
    minFieldConfidence: 0.95,
    ...overrides,
  });
}

test("Batch 11 AI extraction is separately disabled by default with 0.95 accuracy thresholds", () => {
  const config = getAiConfig({});
  assert.equal(config.extractionEnabled, false);
  assert.equal(config.extractionMinConfidence, 0.95);
  assert.equal(config.extractionFieldMinConfidence, 0.95);
});

test("Batch 11 extraction cannot be enabled unless base V2 AI is enabled", () => {
  assert.throws(
    () => getAiConfig({ YOUSCAN_V2_AI_EXTRACTION_ENABLED: "true" }),
    /YOUSCAN_V2_AI_ENABLED must be true/
  );
});

test("Batch 11 extraction confidence thresholds enforce a stricter 0.90 production floor", () => {
  assert.throws(
    () =>
      getAiConfig({
        YOUSCAN_V2_AI_ENABLED: "true",
        YOUSCAN_V2_AI_PROVIDER: "openai",
        YOUSCAN_V2_AI_MODEL: "test-model",
        YOUSCAN_V2_AI_EXTRACTION_MIN_CONFIDENCE: "0.89",
      }),
    /between 0.9 and 1/
  );

  assert.throws(
    () =>
      getAiConfig({
        YOUSCAN_V2_AI_ENABLED: "true",
        YOUSCAN_V2_AI_PROVIDER: "openai",
        YOUSCAN_V2_AI_MODEL: "test-model",
        YOUSCAN_V2_AI_EXTRACTION_FIELD_MIN_CONFIDENCE: "0.89",
      }),
    /between 0.9 and 1/
  );
});

test("Batch 11 strict extraction schema forbids extra top-level and transaction properties", () => {
  assert.equal(AI_BANK_STATEMENT_EXTRACTION_RESPONSE_SCHEMA.additionalProperties, false);
  assert.equal(
    AI_BANK_STATEMENT_EXTRACTION_RESPONSE_SCHEMA.properties.transactions.items.additionalProperties,
    false
  );
  assert.equal(
    AI_BANK_STATEMENT_EXTRACTION_RESPONSE_SCHEMA.properties.bankName.additionalProperties,
    false
  );
});

test("Batch 11 strict extraction contract accepts a complete high-confidence candidate", () => {
  assert.deepEqual(validateAiBankStatementExtractionData(makeValidAiBankStatementCandidate()), {
    valid: true,
  });
});

test("Batch 11 strict extraction contract rejects extra fields instead of silently ignoring them", () => {
  const candidate = makeValidAiBankStatementCandidate();
  candidate.unexpected = "do not accept";
  candidate.transactions[0].merchantCategory = "shopping";

  const result = validateAiBankStatementExtractionData(candidate);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.includes("data.unexpected")));
  assert.ok(result.issues.some((issue) => issue.includes("merchantCategory")));
});

test("Batch 11 strict extraction contract rejects invalid field confidence", () => {
  const candidate = makeValidAiBankStatementCandidate();
  candidate.transactions[0].amount.confidence = 1.1;

  const result = validateAiBankStatementExtractionData(candidate);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.includes("amount.confidence")));
});

test("Batch 11 transactionCount must exactly equal the extracted transaction array length", () => {
  const candidate = makeValidAiBankStatementCandidate();
  candidate.transactionCount = 4;

  const result = validateAiBankStatementExtractionData(candidate);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.includes("does not match transactions.length")));
});

test("Batch 11 null fields cannot carry invented evidence", () => {
  const candidate = makeValidAiBankStatementCandidate();
  candidate.accountNumber = {
    value: null,
    confidence: 0.99,
    evidence: ["Account Number 62123456789"],
  };

  const result = validateAiBankStatementExtractionData(candidate);
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.includes("evidence must be empty when value is null")));
});

test("Batch 11 evidence verifier accepts whitespace-normalized source snippets without returning the raw snippets", () => {
  const candidate = makeValidAiBankStatementCandidate();
  candidate.accountNumber.evidence = ["Account   Number\n62123456789"];

  const result = verifyAiExtractionEvidence(candidate, AI_BANK_STATEMENT_SOURCE_TEXT);
  assert.equal(result.valid, true);
  assert.equal(result.checkedFieldCount, result.verifiedFieldCount);
  assert.equal(JSON.stringify(result).includes("62123456789"), false);
});

test("Batch 11 missing or fabricated field evidence forces needs_review", async () => {
  const candidate = makeValidAiBankStatementCandidate();
  candidate.transactions[1].amount.evidence = ["FABRICATED SOURCE LINE 500.00"];

  const result = await assess({ candidate });
  assert.equal(result.disposition, AI_EXTRACTION_DISPOSITIONS.NEEDS_REVIEW);
  assert.equal(result.eligibleForComparison, false);
  assert.ok(result.issues.some((issue) => issue.issueType === "unverifiable_field_evidence"));
});

test("Batch 11 low overall AI confidence cannot become eligible for comparison", async () => {
  const result = await assess({ envelopeConfidence: 0.91 });
  assert.equal(result.disposition, AI_EXTRACTION_DISPOSITIONS.NEEDS_REVIEW);
  assert.ok(result.issues.some((issue) => issue.issueType === "low_envelope_confidence"));
});

test("Batch 11 any low-confidence populated critical field forces needs_review", async () => {
  const candidate = makeValidAiBankStatementCandidate();
  candidate.transactions[0].amount.confidence = 0.90;

  const result = await assess({ candidate });
  assert.equal(result.disposition, AI_EXTRACTION_DISPOSITIONS.NEEDS_REVIEW);
  assert.ok(
    result.issues.some(
      (issue) =>
        issue.issueType === "low_field_confidence" &&
        issue.fieldPath === "transactions[0].amount"
    )
  );
});

test("Batch 11 invalid calendar dates are rejected through canonical validation", async () => {
  const candidate = makeValidAiBankStatementCandidate();
  candidate.transactions[0].date.value = "31/02/2026";

  const result = await assess({ candidate });
  assert.equal(result.disposition, AI_EXTRACTION_DISPOSITIONS.REJECTED);
  assert.ok(result.issues.some((issue) => issue.issueType === "canonical_invalid_date"));
});

test("Batch 11 invalid statement-period dates are rejected before comparison", async () => {
  const candidate = makeValidAiBankStatementCandidate();
  candidate.statementPeriodEnd.value = "31/02/2026";

  const result = await assess({ candidate });
  assert.equal(result.disposition, AI_EXTRACTION_DISPOSITIONS.REJECTED);
  assert.ok(result.issues.some((issue) => issue.issueType === "invalid_statement_period_end"));
});

test("Batch 11 transaction outside the stated period requires review", async () => {
  const candidate = makeValidAiBankStatementCandidate();
  candidate.transactions[2].date.value = "03/08/2026";

  const result = await assess({ candidate });
  assert.equal(result.disposition, AI_EXTRACTION_DISPOSITIONS.NEEDS_REVIEW);
  assert.ok(
    result.issues.some((issue) => issue.issueType === "transaction_outside_statement_period")
  );
});

test("Batch 11 exact duplicate AI transaction rows are flagged for review", async () => {
  const candidate = makeValidAiBankStatementCandidate();
  candidate.transactions[1] = structuredClone(candidate.transactions[0]);

  const result = await assess({ candidate });
  assert.notEqual(result.disposition, AI_EXTRACTION_DISPOSITIONS.ELIGIBLE_FOR_COMPARISON);
  assert.ok(
    result.issues.some((issue) => issue.issueType === "possible_duplicate_transaction")
  );
});

test("Batch 11 opening plus transaction totals must reconcile to closing balance", async () => {
  const candidate = makeValidAiBankStatementCandidate();
  candidate.closingBalance.value = 1360;

  const result = await assess({ candidate });
  assert.equal(result.disposition, AI_EXTRACTION_DISPOSITIONS.NEEDS_REVIEW);
  assert.ok(
    result.issues.some(
      (issue) => issue.issueType === "statement_total_reconciliation_mismatch"
    )
  );
});

test("Batch 11 printed running-balance inconsistencies remain visible and force review", async () => {
  const candidate = makeValidAiBankStatementCandidate();
  candidate.transactions[1].balance.value = 1410;

  const result = await assess({ candidate });
  assert.equal(result.disposition, AI_EXTRACTION_DISPOSITIONS.NEEDS_REVIEW);
  assert.ok(
    result.issues.some(
      (issue) => issue.issueType === "canonical_balance_continuity_mismatch"
    )
  );
});

test("Batch 11 AI bank-name disagreement with deterministic classification requires review", async () => {
  const candidate = makeValidAiBankStatementCandidate();
  candidate.bankName.value = "ABSA";

  const result = await assess({ candidate, expectedBankName: "FNB" });
  assert.equal(result.disposition, AI_EXTRACTION_DISPOSITIONS.NEEDS_REVIEW);
  assert.ok(result.issues.some((issue) => issue.issueType === "bank_name_disagreement"));
});

test("Batch 11 projection produces canonical values but never evidence/confidence objects", () => {
  const canonical = projectAiBankStatementCandidate(makeValidAiBankStatementCandidate(), {
    sourceFileName: "synthetic-fnb.pdf",
  });

  assert.equal(canonical.bankName, "FNB");
  assert.equal(canonical.transactions[0].amount, -100);
  assert.equal(canonical.sourceFileName, "synthetic-fnb.pdf");
  assert.equal("confidence" in canonical.transactions[0], false);
  assert.equal("evidence" in canonical.transactions[0], false);
});

test("Batch 11 a fully supported AI extraction can only become eligible_for_comparison, never accepted", async () => {
  const result = await assess();

  assert.equal(result.disposition, AI_EXTRACTION_DISPOSITIONS.ELIGIBLE_FOR_COMPARISON);
  assert.equal(result.eligibleForComparison, true);
  assert.equal(result.validation.status, "passed");
  assert.equal(result.validation.score, 1);
  assert.equal(result.summary.transactionCount, 3);
  assert.equal(result.summary.warningCount, 0);
  assert.equal(result.summary.errorCount, 0);
  assert.equal(JSON.stringify(result).includes("evidence"), true);
  assert.equal(JSON.stringify(result).includes("Account Number 62123456789"), false);
});
