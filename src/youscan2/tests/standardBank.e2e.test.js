import test from "node:test";
import assert from "node:assert/strict";

import { classifyDocument } from "../classifier/classifyDocument.js";
import { extractStandardBankTransactions } from "../extractor/standardBank/extractor.js";
import { buildBankStatementExtraction } from "../extractor/index.js";
import { buildBankStatementNormalization } from "../normalizer/index.js";
import { runParseJob } from "../orchestrator/runParseJob.js";
import { validateBankStatement } from "../plugins/bankStatement/bankStatement.validator.js";
import { validateBankStatementShape } from "../schemas/bankStatement.v1.js";
import {
  STANDARD_BANK_EXPECTED_NORMALIZED,
  STANDARD_BANK_EXPECTED_TRANSACTIONS,
  STANDARD_BANK_REVERSAL_FIXTURE_TEXT,
  STANDARD_BANK_STATEMENT_FIXTURE_TEXT,
} from "./fixtures/standardBankStatement.fixture.js";

const file = {
  originalname: "standard-bank-july-2026.pdf",
  mimetype: "application/pdf",
};

const period = {
  start: "01 July 2026",
  end: "31 July 2026",
};

test("Batch 03 Standard Bank is classified as a supported native V2 bank", async () => {
  const classification = await classifyDocument({
    fileName: file.originalname,
    extractedText: STANDARD_BANK_STATEMENT_FIXTURE_TEXT,
  });

  assert.equal(classification.documentType, "bank_statement");
  assert.equal(classification.documentSubtype, "standard_bank_statement");
  assert.equal(classification.supported, true);
});

test("Batch 03 Standard Bank opening/closing metadata rows are not transactions", () => {
  const transactions = extractStandardBankTransactions(
    STANDARD_BANK_STATEMENT_FIXTURE_TEXT,
    period,
    1000
  );

  assert.equal(transactions.length, 4);
  assert.deepEqual(transactions, STANDARD_BANK_EXPECTED_TRANSACTIONS);
});

test("Batch 03 Standard Bank uses running balances to infer debit and credit signs", () => {
  const transactions = extractStandardBankTransactions(
    STANDARD_BANK_STATEMENT_FIXTURE_TEXT,
    period,
    1000
  );

  assert.equal(transactions[0].amount, -100);
  assert.equal(transactions[1].amount, 500);
  assert.equal(transactions[2].amount, -250);
  assert.equal(transactions[3].amount, -50);
  assert.deepEqual(
    transactions.map((tx) => tx.balance),
    [900, 1400, 1150, 1100]
  );
});

test("Batch 03 Standard Bank reconstructs a description with a preceding ROL reference", () => {
  const transactions = extractStandardBankTransactions(
    STANDARD_BANK_STATEMENT_FIXTURE_TEXT,
    period,
    1000
  );

  assert.equal(
    transactions[2].description,
    "EFT PAYMENT SUPPLIER ABC ROL030726"
  );
  assert.equal(transactions[2].date, "03/07/2026");
});

test("Batch 03 Standard Bank excludes reversed transaction blocks", () => {
  const transactions = extractStandardBankTransactions(
    STANDARD_BANK_REVERSAL_FIXTURE_TEXT,
    period,
    1000
  );

  assert.equal(transactions.length, 1);
  assert.equal(transactions[0].description, "Monthly Acc Fee 060726");
  assert.equal(transactions[0].amount, -25);
  assert.equal(transactions[0].balance, 975);
});

test("Batch 03 Standard Bank extraction returns authoritative metadata and observed balances", async () => {
  const classification = await classifyDocument({
    fileName: file.originalname,
    extractedText: STANDARD_BANK_STATEMENT_FIXTURE_TEXT,
  });

  const raw = buildBankStatementExtraction({
    file,
    classification,
    extractedText: STANDARD_BANK_STATEMENT_FIXTURE_TEXT,
    textPreview: STANDARD_BANK_STATEMENT_FIXTURE_TEXT.slice(0, 2000),
    extractionMeta: { sourceType: "fixture" },
  });

  assert.equal(raw.metadata.accountNumber, "10095473821");
  assert.equal(raw.metadata.clientName, "MR. JOHN DOE");
  assert.equal(raw.metadata.statementPeriodStart, "01 July 2026");
  assert.equal(raw.metadata.statementPeriodEnd, "31 July 2026");
  assert.equal(raw.metadata.openingBalance, 1000);
  assert.equal(raw.metadata.closingBalance, 1100);
  assert.deepEqual(raw.transactions, STANDARD_BANK_EXPECTED_TRANSACTIONS);
});

test("Batch 03 Standard Bank normalizer produces the canonical V2 bank statement contract", async () => {
  const classification = await classifyDocument({
    fileName: file.originalname,
    extractedText: STANDARD_BANK_STATEMENT_FIXTURE_TEXT,
  });

  const raw = buildBankStatementExtraction({
    file,
    classification,
    extractedText: STANDARD_BANK_STATEMENT_FIXTURE_TEXT,
  });
  const normalized = buildBankStatementNormalization(raw);

  assert.deepEqual(normalized, STANDARD_BANK_EXPECTED_NORMALIZED);
  assert.deepEqual(validateBankStatementShape(normalized), {
    valid: true,
    issues: [],
  });
});

test("Batch 03 Standard Bank validator passes a fully reconciled statement with score 1", async () => {
  const validation = await validateBankStatement(
    STANDARD_BANK_EXPECTED_NORMALIZED
  );

  assert.equal(validation.valid, true);
  assert.equal(validation.status, "passed");
  assert.equal(validation.score, 1);
  assert.deepEqual(validation.issues, []);
});

test("Batch 03 Standard Bank preserves a balance mismatch for review instead of rewriting balances", async () => {
  const mismatchText = STANDARD_BANK_STATEMENT_FIXTURE_TEXT.replace(
    "500.00 1,400.00",
    "500.00 1,390.00"
  );

  const result = await runParseJob({
    file,
    extractedText: mismatchText,
    extractionMeta: { sourceType: "fixture" },
  });

  assert.equal(result.status, "needs_review");
  assert.equal(result.result.validationStatus, "passed_with_warnings");
  assert.equal(result.result.data.transactions[1].balance, 1390);
  assert.ok(
    result.result.issues.some(
      (issue) => issue.issueType === "balance_continuity_mismatch"
    )
  );
});

test("Batch 03 Standard Bank closing-balance mismatch is marked needs_review", async () => {
  const warningText = STANDARD_BANK_STATEMENT_FIXTURE_TEXT.replace(
    "Month-end Balance R1,100.00",
    "Month-end Balance R1,099.00"
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

test("Batch 03 Standard Bank runParseJob completes end-to-end with canonical data", async () => {
  const result = await runParseJob({
    file,
    extractedText: STANDARD_BANK_STATEMENT_FIXTURE_TEXT,
    extractionMeta: { sourceType: "fixture" },
  });

  assert.equal(result.status, "completed");
  assert.equal(result.result.validationStatus, "passed");
  assert.equal(result.result.validationScore, 1);
  assert.equal(result.result.data.bankName, "Standard Bank");
  assert.equal(result.result.data.transactions.length, 4);
  assert.deepEqual(result.result.data, STANDARD_BANK_EXPECTED_NORMALIZED);
});
