import assert from "node:assert/strict";
import test from "node:test";
import { summarizeAiValidationIssues, AI_EXTRACTION_FAILED_MESSAGE } from "../ai/validationDiagnostics.js";
import { runParseJob } from "../orchestrator/runParseJob.js";
import { AI_BANK_STATEMENT_SOURCE_TEXT, makeValidAiBankStatementCandidate } from "./fixtures/aiBankStatementExtraction.fixture.js";
import { makeShadowAiEnvelope } from "./fixtures/aiBankStatementShadow.fixture.js";

test("diagnostics retain known fields and reasons without values, snippets or unexpected keys", () => {
  const issues = [
    "data.transactions[2].balance.evidence must be empty when value is null.",
    "data.transactionCount (9) does not match transactions.length (8).",
    "data.openingBalance.value must be a finite number or null.",
    "data.customer-secret-123456789@example.com is not allowed.",
    "PRIVATE document content or API key", { value: "PRIVATE" },
  ];
  assert.deepEqual(summarizeAiValidationIssues(issues), [
    { field: "data.transactions[2].balance.evidence", reason: "null_field_has_evidence" },
    { field: "data.transactionCount", reason: "transaction_count_mismatch" },
    { field: "data.openingBalance.value", reason: "invalid_number" },
    { field: "response", reason: "unexpected_field" },
    { field: "response", reason: "invalid_response" },
    { field: "response", reason: "invalid_response" },
  ]);
  assert.equal(summarizeAiValidationIssues(Array(100).fill("PRIVATE")).length, 25);
});

test("failed AI contract logs a safe field diagnosis and request ID but returns only the customer message", async () => {
  const candidate = makeValidAiBankStatementCandidate();
  candidate.transactionCount = 9;
  const logs = [];
  const original = console.error;
  console.error = (...args) => logs.push(args.join(" "));
  let result;
  try {
    result = await runParseJob({ file: { originalname: "statement.pdf" },
      extractedText: AI_BANK_STATEMENT_SOURCE_TEXT, requireAi: true,
      availability: { assertAvailable: async () => {}, recordFailure: () => assert.fail("document failure is not an outage") },
      aiOptions: { config: { enabled: true, extractionEnabled: true, timeoutMs: 1000, maxInputChars: 10000 },
        provider: { name: "mock", generateStructured: async () => ({
          content: JSON.stringify(makeShadowAiEnvelope(candidate)), requestId: "req-synthetic",
        }) },
      },
    });
  } finally { console.error = original; }
  assert.equal(result.status, "failed");
  assert.equal(result.result, null);
  assert.equal(result.error.message, AI_EXTRACTION_FAILED_MESSAGE);
  assert.equal(result.error.code, "V2_AI_INVALID_RESPONSE");
  assert.ok(logs.some(line => line.includes('"reason":"transaction_count_mismatch"')));
  assert.ok(logs.some(line => line.includes('"providerRequestId":"req-synthetic"')));
  assert.ok(!JSON.stringify(logs).includes("TEST CUSTOMER"));
  assert.ok(!JSON.stringify(logs).includes("62123456789"));
  assert.ok(!JSON.stringify(result.error).includes("validationIssues"));
});
