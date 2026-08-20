import test from "node:test";
import assert from "node:assert/strict";

import { classifyDocument } from "../classifier/classifyDocument.js";
import { extractNedbankTransactions } from "../extractor/nedbank/extractor.js";
import { buildBankStatementExtraction } from "../extractor/index.js";
import { buildBankStatementNormalization } from "../normalizer/index.js";
import { runParseJob } from "../orchestrator/runParseJob.js";
import { validateBankStatement } from "../plugins/bankStatement/bankStatement.validator.js";
import { validateBankStatementShape } from "../schemas/bankStatement.v1.js";
import {
  NEDBANK_BALANCE_ONLY_FIXTURE_TEXT,
  NEDBANK_EXPECTED_NORMALIZED,
  NEDBANK_EXPECTED_TRANSACTIONS,
  NEDBANK_NEGATIVE_BALANCE_FIXTURE_TEXT,
  NEDBANK_STATEMENT_FIXTURE_TEXT,
} from "./fixtures/nedbankStatement.fixture.js";

const file = {
  originalname: "nedbank-july-2026.pdf",
  mimetype: "application/pdf",
};

test("Batch 06 Nedbank is classified as a supported native V2 bank", async () => {
  const classification = await classifyDocument({
    fileName: file.originalname,
    extractedText: NEDBANK_STATEMENT_FIXTURE_TEXT,
  });

  assert.equal(classification.documentType, "bank_statement");
  assert.equal(classification.documentSubtype, "nedbank_statement");
  assert.equal(classification.supported, true);
});

test("Batch 06 Nedbank uses observed running balances to resolve debit and credit signs", () => {
  const transactions = extractNedbankTransactions(
    NEDBANK_STATEMENT_FIXTURE_TEXT,
    1000
  );

  assert.deepEqual(transactions, NEDBANK_EXPECTED_TRANSACTIONS);
  assert.deepEqual(
    transactions.map((tx) => tx.amount),
    [-100, 500, -250, -50]
  );
});

test("Batch 06 Nedbank derives transaction amounts when the statement exposes balance only", () => {
  const transactions = extractNedbankTransactions(
    NEDBANK_BALANCE_ONLY_FIXTURE_TEXT,
    1000
  );

  assert.deepEqual(
    transactions.map((tx) => tx.amount),
    [-100, 500]
  );
  assert.deepEqual(
    transactions.map((tx) => tx.balance),
    [900, 1400]
  );
});

test("Batch 06 Nedbank reconstructs wrapped descriptions without treating references as money", () => {
  const transactions = extractNedbankTransactions(
    NEDBANK_STATEMENT_FIXTURE_TEXT,
    1000
  );

  assert.equal(
    transactions[2].description,
    "EFT Payment Supplier ABC Reference INV-7781"
  );
});

test("Batch 06 Nedbank preserves Dr running balances as negative values", () => {
  const transactions = extractNedbankTransactions(
    NEDBANK_NEGATIVE_BALANCE_FIXTURE_TEXT,
    50
  );

  assert.equal(transactions.length, 1);
  assert.equal(transactions[0].amount, -100);
  assert.equal(transactions[0].balance, -50);
});

test("Batch 06 Nedbank extraction returns authoritative metadata and transactions", async () => {
  const classification = await classifyDocument({
    fileName: file.originalname,
    extractedText: NEDBANK_STATEMENT_FIXTURE_TEXT,
  });

  const raw = buildBankStatementExtraction({
    file,
    classification,
    extractedText: NEDBANK_STATEMENT_FIXTURE_TEXT,
    textPreview: NEDBANK_STATEMENT_FIXTURE_TEXT.slice(0, 2000),
    extractionMeta: { sourceType: "fixture" },
  });

  assert.equal(raw.metadata.accountNumber, "1605123456");
  assert.equal(raw.metadata.clientName, "MR JOHN SAMPLE");
  assert.equal(raw.metadata.statementPeriodStart, "01/07/2026");
  assert.equal(raw.metadata.statementPeriodEnd, "31/07/2026");
  assert.equal(raw.metadata.openingBalance, 1000);
  assert.equal(raw.metadata.closingBalance, 1100);
  assert.deepEqual(raw.transactions, NEDBANK_EXPECTED_TRANSACTIONS);
});

test("Batch 06 Nedbank normalizer produces the canonical V2 bank statement contract", async () => {
  const classification = await classifyDocument({
    fileName: file.originalname,
    extractedText: NEDBANK_STATEMENT_FIXTURE_TEXT,
  });

  const raw = buildBankStatementExtraction({
    file,
    classification,
    extractedText: NEDBANK_STATEMENT_FIXTURE_TEXT,
  });
  const normalized = buildBankStatementNormalization(raw);

  assert.deepEqual(normalized, NEDBANK_EXPECTED_NORMALIZED);
  assert.deepEqual(validateBankStatementShape(normalized), {
    valid: true,
    issues: [],
  });
});

test("Batch 06 Nedbank validator passes a fully reconciled statement with score 1", async () => {
  const validation = await validateBankStatement(NEDBANK_EXPECTED_NORMALIZED);

  assert.equal(validation.valid, true);
  assert.equal(validation.status, "passed");
  assert.equal(validation.score, 1);
  assert.deepEqual(validation.issues, []);
});

test("Batch 06 Nedbank preserves a running-balance mismatch for review", async () => {
  const mismatchText = NEDBANK_STATEMENT_FIXTURE_TEXT.replace(
    "500.00 1,400.00 Cr",
    "500.00 1,390.00 Cr"
  );

  const result = await runParseJob({
    file,
    extractedText: mismatchText,
    extractionMeta: { sourceType: "fixture" },
  });

  assert.equal(result.status, "needs_review");
  assert.equal(result.result.data.transactions[1].amount, 500);
  assert.equal(result.result.data.transactions[1].balance, 1390);
  assert.ok(
    result.result.issues.some(
      (issue) => issue.issueType === "balance_continuity_mismatch"
    )
  );
});

test("Batch 06 Nedbank closing-balance mismatch is marked needs_review", async () => {
  const warningText = NEDBANK_STATEMENT_FIXTURE_TEXT.replace(
    "Closing balance R1,100.00 Cr",
    "Closing balance R1,099.00 Cr"
  );

  const result = await runParseJob({
    file,
    extractedText: warningText,
    extractionMeta: { sourceType: "fixture" },
  });

  assert.equal(result.status, "needs_review");
  assert.equal(result.result.data.closingBalance, 1099);
  assert.ok(
    result.result.issues.some(
      (issue) => issue.issueType === "closing_balance_mismatch"
    )
  );
});

test("Batch 06 Nedbank runParseJob completes end-to-end with canonical data", async () => {
  const result = await runParseJob({
    file,
    extractedText: NEDBANK_STATEMENT_FIXTURE_TEXT,
    extractionMeta: { sourceType: "fixture" },
  });

  assert.equal(result.status, "completed");
  assert.equal(result.result.validationStatus, "passed");
  assert.equal(result.result.validationScore, 1);
  assert.equal(result.result.data.bankName, "Nedbank");
  assert.equal(result.result.data.transactions.length, 4);
  assert.deepEqual(result.result.data, NEDBANK_EXPECTED_NORMALIZED);
});
