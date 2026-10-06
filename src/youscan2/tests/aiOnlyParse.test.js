import assert from "node:assert/strict";
import test from "node:test";
import { runParseJob } from "../orchestrator/runParseJob.js";
import { createAnalysisAvailability } from "../ai/availability.js";
import { getAiConfig } from "../ai/config.js";
import { projectAiBankStatementCandidate } from "../ai/extraction/projectCandidate.js";
import { AI_BANK_STATEMENT_SOURCE_TEXT, makeValidAiBankStatementCandidate } from "./fixtures/aiBankStatementExtraction.fixture.js";
import { makeShadowAiEnvelope } from "./fixtures/aiBankStatementShadow.fixture.js";

const config = getAiConfig({ YOUSCAN_V2_AI_ENABLED: "true", YOUSCAN_V2_AI_EXTRACTION_ENABLED: "true",
  YOUSCAN_V2_AI_PROVIDER: "openai", YOUSCAN_V2_AI_MODEL: "synthetic" });
function parse(candidate = makeValidAiBankStatementCandidate(), text = AI_BANK_STATEMENT_SOURCE_TEXT, envelope = {}) {
  return runParseJob({ file: { originalname: "wrong-bank-absa.pdf" }, extractedText: text,
    requireAi: true,
    availability: createAnalysisAvailability({ probe: async () => {}, logger: () => {} }),
    aiOptions: { config, provider: { name: "mock", generateStructured: async () => ({
      content: JSON.stringify(makeShadowAiEnvelope(candidate, envelope)), requestId: "synthetic",
    }) } },
  });
}

for (const bank of ["FNB", "ABSA", "Standard Bank"]) {
  test(`${bank}: V2 production returns exclusively AI fields, without parser data or comparison`, async () => {
    const candidate = makeValidAiBankStatementCandidate();
    candidate.bankName.value = bank;
    candidate.bankName.evidence = [`${bank} BANK STATEMENT`];
    const text = AI_BANK_STATEMENT_SOURCE_TEXT.replace("FNB BANK STATEMENT", `${bank} BANK STATEMENT`);
    const result = await parse(candidate, text);
    assert.equal(result.status, "completed");
    assert.equal(result.authoritativeSource, "ai");
    assert.equal(result.classification.source, "ai");
    assert.deepEqual(result.result.data, projectAiBankStatementCandidate(candidate, { sourceFileName: "wrong-bank-absa.pdf" }));
    assert.equal(result.aiCompleted, true);
    assert.equal(result.shadowAi, undefined);
    assert.equal(result.aiCorrectionProposal, undefined);
    assert.equal(result.aiDecision, undefined);
  });
}
test("missing AI balances stay null and require review; they are never reconstructed", async () => {
  const candidate = makeValidAiBankStatementCandidate();
  for (const field of [candidate.openingBalance, candidate.closingBalance, ...candidate.transactions.map(t => t.balance)]) {
    field.value = null; field.evidence = [];
  }
  const result = await parse(candidate);
  assert.equal(result.status, "needs_review");
  assert.equal(result.result.data.openingBalance, null);
  assert.equal(result.result.data.closingBalance, null);
  assert.deepEqual(result.result.data.transactions.map(t => t.balance), [null, null, null]);
});

for (const bank of ["Capitec", "Capitec Bank", "Capitec Bank Limited", "Capitec Bank Ltd", "Capitec Bank Ltd.", "CAPITEC  BANK"]) {
  test(`${bank}: recognises the AI bank name and preserves all AI data`, async () => {
    const candidate = makeValidAiBankStatementCandidate();
    candidate.bankName.value = bank;
    candidate.bankName.evidence = [`${bank} BANK STATEMENT`];
    const text = AI_BANK_STATEMENT_SOURCE_TEXT.replace("FNB BANK STATEMENT", `${bank} BANK STATEMENT`);
    const result = await parse(candidate, text);
    assert.equal(result.status, "completed");
    assert.equal(result.classification.documentSubtype, "capitec_statement");
    assert.equal(result.classification.source, "ai");
    assert.equal(result.aiCompleted, true);
    assert.equal(result.authoritativeSource, "ai");
    assert.deepEqual(result.result.data, projectAiBankStatementCandidate(candidate, { sourceFileName: "wrong-bank-absa.pdf" }));
  });
}

test("an unrecognised lookalike bank is not accepted as Capitec", async () => {
  const candidate = makeValidAiBankStatementCandidate();
  candidate.bankName.value = "Capitec Example Finance";
  candidate.bankName.evidence = ["Capitec Example Finance BANK STATEMENT"];
  const result = await parse(candidate, AI_BANK_STATEMENT_SOURCE_TEXT.replace("FNB BANK STATEMENT", "Capitec Example Finance BANK STATEMENT"));
  assert.equal(result.status, "unsupported");
  assert.equal(result.classification.supported, false);
  assert.equal(result.result, null);
});
test("reconciliation flags only AI values and never replaces a conflicting AI balance", async () => {
  const candidate = makeValidAiBankStatementCandidate();
  candidate.closingBalance.value = 1300;
  candidate.closingBalance.evidence = ["Closing Balance 1300.00"];
  const result = await parse(candidate, AI_BANK_STATEMENT_SOURCE_TEXT.replace("Closing Balance 1350.00", "Closing Balance 1300.00"));
  assert.equal(result.status, "needs_review");
  assert.equal(result.result.data.closingBalance, 1300);
  assert.ok(result.result.issues.some(i => i.issueType === "statement_total_reconciliation_mismatch"));
});
test("invalid AI output yields no statement even where the old FNB parser could extract data", async () => {
  const candidate = makeValidAiBankStatementCandidate();
  candidate.transactionCount = 100;
  const result = await parse(candidate);
  assert.equal(result.status, "failed");
  assert.equal(result.result, null);
  assert.equal(result.aiCompleted, undefined);
});
