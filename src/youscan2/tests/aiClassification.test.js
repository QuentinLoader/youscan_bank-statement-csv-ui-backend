import assert from "node:assert/strict";
import test from "node:test";

import { AI_CONTRACT_VERSION, AI_TASKS } from "../ai/contracts.js";
import { getAiConfig } from "../ai/config.js";
import { classifyDocument } from "../classifier/classifyDocument.js";
import { buildClassificationTextSample } from "../classifier/aiClassifier.js";
import {
  AI_CLASSIFICATION_RESPONSE_SCHEMA,
  validateAiClassificationData,
} from "../classifier/aiClassificationContract.js";
import { DOCUMENT_SUBTYPES, DOCUMENT_TYPES } from "../registry/documentTypes.js";
import { runParseJob } from "../orchestrator/runParseJob.js";

function classifierConfig(overrides = {}) {
  return {
    enabled: true,
    classifierEnabled: true,
    provider: "mock",
    model: "mock-classifier",
    timeoutMs: 100,
    maxInputChars: 50_000,
    classificationMaxInputChars: 5_000,
    classificationMinConfidence: 0.92,
    ...overrides,
  };
}

function aiEnvelope({
  documentType = DOCUMENT_TYPES.BANK_STATEMENT,
  documentSubtype = DOCUMENT_SUBTYPES.FNB_STATEMENT,
  confidence = 0.97,
  warnings = [],
  evidence = ["Recognized bank statement branding and structure"],
} = {}) {
  return {
    contractVersion: AI_CONTRACT_VERSION,
    task: AI_TASKS.CLASSIFY_DOCUMENT,
    confidence,
    data: { documentType, documentSubtype },
    warnings,
    evidence,
  };
}

function mockProvider(envelopeOrHandler) {
  let calls = 0;
  return {
    name: "mock",
    get calls() {
      return calls;
    },
    async generateStructured(request) {
      calls += 1;
      if (typeof envelopeOrHandler === "function") {
        return envelopeOrHandler(request);
      }
      return { content: JSON.stringify(envelopeOrHandler) };
    },
  };
}


test("Batch 10 AI classifier is separately disabled by default with a 0.92 acceptance threshold", () => {
  const config = getAiConfig({});
  assert.equal(config.classifierEnabled, false);
  assert.equal(config.classificationMinConfidence, 0.92);
  assert.equal(config.classificationMaxInputChars, 30_000);
});

test("Batch 10 classifier cannot be enabled unless the base V2 AI switch is also enabled", () => {
  assert.throws(
    () =>
      getAiConfig({
        YOUSCAN_V2_AI_CLASSIFIER_ENABLED: "true",
      }),
    /YOUSCAN_V2_AI_ENABLED must be true/
  );
});

test("Batch 10 production classification confidence threshold cannot be configured below 0.80", () => {
  assert.throws(
    () =>
      getAiConfig({
        YOUSCAN_V2_AI_ENABLED: "true",
        YOUSCAN_V2_AI_PROVIDER: "openai",
        YOUSCAN_V2_AI_MODEL: "test-model",
        YOUSCAN_V2_AI_CLASSIFICATION_MIN_CONFIDENCE: "0.79",
      }),
    /between 0.8 and 1/
  );
});

test("Batch 10 strict classifier schema allows only known document type/subtype values", () => {
  assert.equal(AI_CLASSIFICATION_RESPONSE_SCHEMA.type, "object");
  assert.equal(AI_CLASSIFICATION_RESPONSE_SCHEMA.additionalProperties, false);
  assert.ok(
    AI_CLASSIFICATION_RESPONSE_SCHEMA.properties.documentSubtype.enum.includes(
      DOCUMENT_SUBTYPES.STANDARD_BANK_STATEMENT
    )
  );

  assert.deepEqual(
    validateAiClassificationData({
      documentType: DOCUMENT_TYPES.BANK_STATEMENT,
      documentSubtype: DOCUMENT_SUBTYPES.ABSA_STATEMENT,
    }),
    { valid: true }
  );

  assert.equal(
    validateAiClassificationData({
      documentType: DOCUMENT_TYPES.INVOICE,
      documentSubtype: DOCUMENT_SUBTYPES.ABSA_STATEMENT,
    }).valid,
    false
  );
});

test("Batch 10 strong deterministic bank classification never calls AI", async () => {
  const provider = mockProvider(aiEnvelope({ documentSubtype: DOCUMENT_SUBTYPES.FNB_STATEMENT }));
  const result = await classifyDocument({
    fileName: "statement.pdf",
    extractedText: "ABSA opening balance closing balance transaction date debit credit balance",
    aiConfig: classifierConfig(),
    aiProvider: provider,
  });

  assert.equal(provider.calls, 0);
  assert.equal(result.documentSubtype, DOCUMENT_SUBTYPES.ABSA_STATEMENT);
  assert.equal(result.classificationMethod, "heuristic");
  assert.equal(result.aiAttempted, false);
  assert.equal(result.aiEligible, false);
  assert.equal(result.needsReview, false);
});

test("Batch 10 classifier feature flag keeps weak deterministic behavior unchanged when disabled", async () => {
  const provider = mockProvider(aiEnvelope());
  const result = await classifyDocument({
    fileName: "weak-fnb.pdf",
    extractedText: "FNB balance",
    aiConfig: classifierConfig({ classifierEnabled: false }),
    aiProvider: provider,
  });

  assert.equal(provider.calls, 0);
  assert.equal(result.documentSubtype, DOCUMENT_SUBTYPES.FNB_STATEMENT);
  assert.equal(result.supported, true);
  assert.equal(result.classificationMethod, "heuristic");
  assert.equal(result.aiAttempted, false);
  assert.equal(result.aiEligible, true);
});

test("Batch 10 high-confidence AI can resolve an unknown generic bank statement", async () => {
  const provider = mockProvider(aiEnvelope({ documentSubtype: DOCUMENT_SUBTYPES.FNB_STATEMENT }));
  const result = await classifyDocument({
    fileName: "statement.pdf",
    extractedText: "opening balance closing balance transaction date debit credit balance",
    aiConfig: classifierConfig(),
    aiProvider: provider,
  });

  assert.equal(provider.calls, 1);
  assert.equal(result.documentType, DOCUMENT_TYPES.BANK_STATEMENT);
  assert.equal(result.documentSubtype, DOCUMENT_SUBTYPES.FNB_STATEMENT);
  assert.equal(result.supported, true);
  assert.equal(result.classificationMethod, "ai_fallback");
  assert.equal(result.classificationDecision, "accepted");
  assert.equal(result.aiAttempted, true);
  assert.equal(result.needsReview, false);
});

test("Batch 10 high-confidence AI that agrees with a weak deterministic bank candidate may accept it", async () => {
  const provider = mockProvider(aiEnvelope({ documentSubtype: DOCUMENT_SUBTYPES.FNB_STATEMENT }));
  const result = await classifyDocument({
    fileName: "fnb.pdf",
    extractedText: "FNB balance",
    aiConfig: classifierConfig(),
    aiProvider: provider,
  });

  assert.equal(provider.calls, 1);
  assert.equal(result.documentSubtype, DOCUMENT_SUBTYPES.FNB_STATEMENT);
  assert.equal(result.supported, true);
  assert.equal(result.classificationMethod, "ai_fallback");
  assert.equal(result.needsReview, false);
  assert.equal(result.deterministicCandidate.documentSubtype, DOCUMENT_SUBTYPES.FNB_STATEMENT);
});

test("Batch 10 AI disagreement with a weak deterministic bank candidate becomes needs_review", async () => {
  const provider = mockProvider(aiEnvelope({ documentSubtype: DOCUMENT_SUBTYPES.ABSA_STATEMENT }));
  const result = await classifyDocument({
    fileName: "ambiguous.pdf",
    extractedText: "FNB balance",
    aiConfig: classifierConfig(),
    aiProvider: provider,
  });

  assert.equal(result.supported, false);
  assert.equal(result.needsReview, true);
  assert.equal(result.classificationDecision, "needs_review");
  assert.equal(result.documentSubtype, DOCUMENT_SUBTYPES.UNKNOWN);
  assert.equal(result.deterministicCandidate.documentSubtype, DOCUMENT_SUBTYPES.FNB_STATEMENT);
  assert.equal(result.aiCandidate.documentSubtype, DOCUMENT_SUBTYPES.ABSA_STATEMENT);
});

test("Batch 10 low-confidence AI never auto-accepts an unknown bank classification", async () => {
  const provider = mockProvider(aiEnvelope({ confidence: 0.75 }));
  const result = await classifyDocument({
    extractedText: "opening balance closing balance transaction date debit credit balance",
    aiConfig: classifierConfig(),
    aiProvider: provider,
  });

  assert.equal(result.supported, false);
  assert.equal(result.needsReview, true);
  assert.equal(result.classificationDecision, "needs_review");
  assert.equal(result.aiConfidence, 0.75);
});

test("Batch 10 AI provider failure fails closed to needs_review instead of guessing", async () => {
  const provider = mockProvider(() => {
    throw new Error("upstream unavailable");
  });
  const result = await classifyDocument({
    extractedText: "opening balance closing balance transaction date debit credit balance",
    aiConfig: classifierConfig(),
    aiProvider: provider,
  });

  assert.equal(result.supported, false);
  assert.equal(result.needsReview, true);
  assert.equal(result.classificationMethod, "heuristic_ai_failed");
  assert.equal(result.aiAttempted, true);
  assert.equal(result.aiErrorCode, "V2_AI_PROVIDER_FAILED");
});

test("Batch 10 high-confidence AI can identify a non-bank document but does not mark it supported", async () => {
  const provider = mockProvider(
    aiEnvelope({
      documentType: DOCUMENT_TYPES.INVOICE,
      documentSubtype: DOCUMENT_SUBTYPES.GENERIC_INVOICE,
      confidence: 0.98,
      evidence: ["Invoice structure detected"],
    })
  );
  const result = await classifyDocument({
    extractedText: "Invoice VAT total due supplier",
    aiConfig: classifierConfig(),
    aiProvider: provider,
  });

  assert.equal(result.documentType, DOCUMENT_TYPES.INVOICE);
  assert.equal(result.documentSubtype, DOCUMENT_SUBTYPES.GENERIC_INVOICE);
  assert.equal(result.supported, false);
  assert.equal(result.needsReview, false);
  assert.equal(result.classificationDecision, "unsupported");
});

test("Batch 10 classification sampling keeps the beginning and end within the configured limit", () => {
  const input = `${"HEADER ".repeat(50)}${"MIDDLE ".repeat(500)}${"FOOTER ".repeat(50)}`;
  const sample = buildClassificationTextSample(input, 500);

  assert.ok(sample.length <= 500);
  assert.ok(sample.includes("HEADER"));
  assert.ok(sample.includes("FOOTER"));
  assert.ok(sample.includes("middle omitted"));
});

test("Batch 10 runParseJob stops at needs_review before any bank parser runs", async () => {
  const provider = mockProvider(aiEnvelope({ confidence: 0.70 }));
  const result = await runParseJob({
    file: { originalname: "unknown-bank.pdf", mimetype: "application/pdf" },
    extractedText: "opening balance closing balance transaction date debit credit balance",
    extractionMeta: { sourceType: "test" },
    classificationOptions: {
      aiConfig: classifierConfig(),
      aiProvider: provider,
    },
  });

  assert.equal(provider.calls, 1);
  assert.equal(result.status, "needs_review");
  assert.equal(result.classification.needsReview, true);
  assert.equal(result.schema, null);
  assert.equal(result.result, null);
  assert.equal(result.error, null);
});
