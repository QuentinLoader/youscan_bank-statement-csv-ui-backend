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

for (const bank of ["FNB", "ABSA", "Standard Bank", "Absa Bank Limited", "Absa Bank (Ltd.)", "Absa Bank South Africa"]) {
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

function withFee(fee = -6, payment = -100) {
  const candidate = makeValidAiBankStatementCandidate();
  const delta = fee + payment + 100;
  candidate.transactions[0].amount.value = payment;
  if (payment === 0) candidate.transactions[0].description.value = 'Service fee';
  candidate.transactions[0].fee = { value: fee, confidence: 0.99, evidence: [] };
  candidate.closingBalance.value += delta;
  candidate.closingBalance.evidence = [`Closing Balance ${candidate.closingBalance.value.toFixed(2)}`];
  const lines = candidate.transactions.map((row, index) => {
    row.balance.value += delta;
    const line = `${row.date.value} ${row.description.value} Money Out/In=${row.amount.value.toFixed(2)} Fee=${index === 0 ? fee.toFixed(2) : 'blank'} Balance=${row.balance.value.toFixed(2)}`;
    for (const field of Object.values(row)) if (field.value !== null) field.evidence = [line];
    return line;
  });
  const text = AI_BANK_STATEMENT_SOURCE_TEXT.split('\n').slice(0, 5).join('\n') + '\n' + lines.join('\n') + '\n' + candidate.closingBalance.evidence[0];
  return { candidate, text };
}

test('attached AI fees reconcile without overwriting the source payment or balance', async () => {
  const { candidate, text } = withFee();
  const result = await parse(candidate, text);
  assert.equal(result.status, 'completed');
  assert.deepEqual(result.result.data.transactions[0], {
    date: '01/07/2026', description: 'CARD PURCHASE SHOP', amount: -106,
    paymentAmount: -100, fee: -6, balance: 894,
  });
  assert.equal(result.result.data.closingBalance, 1344);
  assert.equal(result.result.issues.length, 0);
});

test('an omitted attached fee remains a real reconciliation warning', async () => {
  const { candidate, text } = withFee();
  candidate.transactions[0].fee = { value: null, confidence: 0.99, evidence: [] };
  const result = await parse(candidate, text);
  assert.equal(result.status, 'needs_review');
  assert.equal(result.result.data.transactions[0].amount, -100);
  assert.equal(result.result.data.transactions[0].fee, undefined);
  assert.ok(result.result.issues.some(issue => issue.issueType === 'statement_total_reconciliation_mismatch'));
});

test('fee-only rows use the AI fee once, and fee refunds preserve their positive sign', async () => {
  for (const fee of [-100, 2]) {
    const { candidate, text } = withFee(fee);
    const refunded = await parse(candidate, text);
    assert.equal(refunded.result.data.transactions[0].amount, -100 + fee);
  }
  const { candidate, text } = withFee(-6, 0);
  const result = await parse(candidate, text);
  assert.equal(result.status, 'completed');
  assert.equal(result.result.data.transactions[0].amount, -6);
  assert.equal(result.result.data.transactions[0].paymentAmount, 0);
});

test('missing fee fields fail the strict AI contract; uncertain fee values require review', async () => {
  const { candidate, text } = withFee();
  delete candidate.transactions[0].fee;
  assert.equal((await parse(candidate, text)).status, 'failed');
  candidate.transactions[0].fee = { value: null, confidence: 0.1, evidence: [] };
  const result = await parse(candidate, text);
  assert.equal(result.status, 'needs_review');
  assert.ok(result.result.issues.some(issue => issue.issueType === 'low_field_confidence' && issue.fieldPath === 'transactions[0].fee'));
});

test('41 independently extracted attached fees are included exactly once in totals', async () => {
  const candidate = makeValidAiBankStatementCandidate();
  candidate.openingBalance.value = 100000;
  candidate.openingBalance.evidence = ['Opening Balance 100000.00'];
  let balance = 100000;
  const lines = [];
  candidate.transactions = Array.from({ length: 41 }, (_, index) => {
    const fee = index === 40 ? -15 : -5;
    balance += -200 + fee;
    const line = `01/07/2026 TEST PAYMENT ${index} Money Out=-200.00 Fee=${fee.toFixed(2)} Balance=${balance.toFixed(2)}`;
    lines.push(line);
    const field = value => ({ value, confidence: 0.99, evidence: [line] });
    return { date: field('01/07/2026'), description: field(`TEST PAYMENT ${index}`),
      amount: field(-200), fee: field(fee), balance: field(balance) };
  });
  candidate.transactionCount = 41;
  candidate.closingBalance.value = balance;
  candidate.closingBalance.evidence = [`Closing Balance ${balance.toFixed(2)}`];
  const text = AI_BANK_STATEMENT_SOURCE_TEXT.split('\n').slice(0, 5).join('\n').replace('Opening Balance 1000.00', 'Opening Balance 100000.00') + '\n' + lines.join('\n') + '\n' + candidate.closingBalance.evidence[0];
  const result = await parse(candidate, text);
  assert.equal(result.status, 'completed');
  assert.equal(result.result.issues.length, 0);
  assert.equal(result.result.data.transactions.length, 41);
  assert.equal(result.result.data.transactions.reduce((sum, row) => sum + row.fee, 0), -215);
  assert.equal(result.result.data.transactions.reduce((sum, row) => sum + row.amount, 0), -8415);
  assert.equal(result.result.data.closingBalance, 91585);
});

test('rounding a row total cannot hide suspicious precision in the AI payment or fee', async () => {
  const { candidate, text } = withFee(-6.001);
  const result = await parse(candidate, text);
  assert.equal(result.status, 'needs_review');
  assert.ok(result.result.issues.some(issue => issue.issueType === 'source_amount_precision_issue'));
  assert.equal(result.result.data.transactions[0].fee, -6.001);
});
