import test from "node:test";
import assert from "node:assert/strict";

import { classifyDocument } from "../classifier/classifyDocument.js";
import { extractCapitecTransactions } from "../extractor/capitec/extractor.js";
import { buildBankStatementExtraction } from "../extractor/index.js";
import { buildBankStatementNormalization } from "../normalizer/index.js";
import { runParseJob } from "../orchestrator/runParseJob.js";
import { validateBankStatement } from "../plugins/bankStatement/bankStatement.validator.js";
import { validateBankStatementShape } from "../schemas/bankStatement.v1.js";
import {
  CAPITEC_EXPECTED_NORMALIZED,
  CAPITEC_EXPECTED_TRANSACTIONS,
  CAPITEC_EXPLICIT_NEGATIVE_AMOUNT_FIXTURE_TEXT,
  CAPITEC_NEGATIVE_BALANCE_FIXTURE_TEXT,
  CAPITEC_STATEMENT_FIXTURE_TEXT,
} from "./fixtures/capitecStatement.fixture.js";

const file = {
  originalname: "capitec-july-2026.pdf",
  mimetype: "application/pdf",
};

test("Batch 05 Capitec is classified as a supported native V2 bank", async () => {
  const classification = await classifyDocument({
    fileName: file.originalname,
    extractedText: CAPITEC_STATEMENT_FIXTURE_TEXT,
  });

  assert.equal(classification.documentType, "bank_statement");
  assert.equal(classification.documentSubtype, "capitec_statement");
  assert.equal(classification.supported, true);
});

test("Batch 05 Capitec uses running balances to resolve debit and credit signs", () => {
  const transactions = extractCapitecTransactions(
    CAPITEC_STATEMENT_FIXTURE_TEXT,
    1000
  );

  assert.deepEqual(transactions, CAPITEC_EXPECTED_TRANSACTIONS);
  assert.deepEqual(
    transactions.map((tx) => tx.amount),
    [-100, 500, -250, -50]
  );
});

test("Batch 05 Capitec reconstructs wrapped descriptions without treating references as money", () => {
  const transactions = extractCapitecTransactions(
    CAPITEC_STATEMENT_FIXTURE_TEXT,
    1000
  );

  assert.equal(
    transactions[2].description,
    "EFT Payment Supplier ABC Reference INV-7781"
  );
});

test("Batch 05 Capitec preserves negative running balances", () => {
  const transactions = extractCapitecTransactions(
    CAPITEC_NEGATIVE_BALANCE_FIXTURE_TEXT,
    50
  );

  assert.equal(transactions.length, 1);
  assert.equal(transactions[0].amount, -100);
  assert.equal(transactions[0].balance, -50);
});

test("Batch 05 Capitec prioritizes observed balance movement over an ambiguous printed amount sign", () => {
  const transactions = extractCapitecTransactions(
    CAPITEC_EXPLICIT_NEGATIVE_AMOUNT_FIXTURE_TEXT,
    1000
  );

  assert.deepEqual(
    transactions.map((tx) => tx.amount),
    [-100, 100]
  );
  assert.deepEqual(
    transactions.map((tx) => tx.balance),
    [900, 1000]
  );
});

test("Batch 05 Capitec extraction returns authoritative metadata and transactions", async () => {
  const classification = await classifyDocument({
    fileName: file.originalname,
    extractedText: CAPITEC_STATEMENT_FIXTURE_TEXT,
  });

  const raw = buildBankStatementExtraction({
    file,
    classification,
    extractedText: CAPITEC_STATEMENT_FIXTURE_TEXT,
    textPreview: CAPITEC_STATEMENT_FIXTURE_TEXT.slice(0, 2000),
    extractionMeta: { sourceType: "fixture" },
  });

  assert.equal(raw.metadata.accountNumber, "1234567890");
  assert.equal(raw.metadata.clientName, "MR JOHN SAMPLE");
  assert.equal(raw.metadata.statementPeriodStart, "01/07/2026");
  assert.equal(raw.metadata.statementPeriodEnd, "31/07/2026");
  assert.equal(raw.metadata.openingBalance, 1000);
  assert.equal(raw.metadata.closingBalance, 1100);
  assert.deepEqual(raw.transactions, CAPITEC_EXPECTED_TRANSACTIONS);
});

test("Batch 05 Capitec normalizer produces the canonical V2 bank statement contract", async () => {
  const classification = await classifyDocument({
    fileName: file.originalname,
    extractedText: CAPITEC_STATEMENT_FIXTURE_TEXT,
  });

  const raw = buildBankStatementExtraction({
    file,
    classification,
    extractedText: CAPITEC_STATEMENT_FIXTURE_TEXT,
  });
  const normalized = buildBankStatementNormalization(raw);

  assert.deepEqual(normalized, CAPITEC_EXPECTED_NORMALIZED);
  assert.deepEqual(validateBankStatementShape(normalized), {
    valid: true,
    issues: [],
  });
});

test("Batch 05 Capitec validator passes a fully reconciled statement with score 1", async () => {
  const validation = await validateBankStatement(CAPITEC_EXPECTED_NORMALIZED);

  assert.equal(validation.valid, true);
  assert.equal(validation.status, "passed");
  assert.equal(validation.score, 1);
  assert.deepEqual(validation.issues, []);
});

test("Batch 05 Capitec preserves a running-balance mismatch for review", async () => {
  const mismatchText = CAPITEC_STATEMENT_FIXTURE_TEXT.replace(
    "500.00 1,400.00",
    "500.00 1,390.00"
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

test("Batch 05 Capitec closing-balance mismatch is marked needs_review", async () => {
  const warningText = CAPITEC_STATEMENT_FIXTURE_TEXT.replace(
    "Closing Balance: R1,100.00",
    "Closing Balance: R1,099.00"
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

test("Batch 05 Capitec runParseJob completes end-to-end with canonical data", async () => {
  const result = await runParseJob({
    file,
    extractedText: CAPITEC_STATEMENT_FIXTURE_TEXT,
    extractionMeta: { sourceType: "fixture" },
  });

  assert.equal(result.status, "completed");
  assert.equal(result.result.validationStatus, "passed");
  assert.equal(result.result.validationScore, 1);
  assert.equal(result.result.data.bankName, "Capitec");
  assert.equal(result.result.data.transactions.length, 4);
  assert.deepEqual(result.result.data, CAPITEC_EXPECTED_NORMALIZED);
});
