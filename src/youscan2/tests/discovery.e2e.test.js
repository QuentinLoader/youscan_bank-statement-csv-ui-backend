import test from "node:test";
import assert from "node:assert/strict";

import { classifyDocument } from "../classifier/classifyDocument.js";
import { extractDiscoveryTransactions } from "../extractor/discovery/extractor.js";
import { buildBankStatementExtraction } from "../extractor/index.js";
import { buildBankStatementNormalization } from "../normalizer/index.js";
import { runParseJob } from "../orchestrator/runParseJob.js";
import { validateBankStatement } from "../plugins/bankStatement/bankStatement.validator.js";
import { validateBankStatementShape } from "../schemas/bankStatement.v1.js";
import {
  DISCOVERY_EXPECTED_NORMALIZED,
  DISCOVERY_EXPECTED_TRANSACTIONS,
  DISCOVERY_INVERTED_DATE_FIXTURE_TEXT,
  DISCOVERY_OBSERVED_BALANCE_FIXTURE_TEXT,
  DISCOVERY_QUOTED_MULTILINE_FIXTURE_TEXT,
  DISCOVERY_STATEMENT_FIXTURE_TEXT,
} from "./fixtures/discoveryStatement.fixture.js";

const file = {
  originalname: "discovery-july-2026.pdf",
  mimetype: "application/pdf",
};

test("Batch 07 Discovery Bank is classified as a supported native V2 bank", async () => {
  const classification = await classifyDocument({
    fileName: file.originalname,
    extractedText: DISCOVERY_STATEMENT_FIXTURE_TEXT,
  });

  assert.equal(classification.documentType, "bank_statement");
  assert.equal(classification.documentSubtype, "discovery_statement");
  assert.equal(classification.supported, true);
});

test("Batch 07 Discovery derives running balances from signed transaction amounts", () => {
  const transactions = extractDiscoveryTransactions(
    DISCOVERY_STATEMENT_FIXTURE_TEXT,
    1000
  );

  assert.deepEqual(transactions, DISCOVERY_EXPECTED_TRANSACTIONS);
});

test("Batch 07 Discovery supports quoted multiline transaction exports", () => {
  const transactions = extractDiscoveryTransactions(
    DISCOVERY_QUOTED_MULTILINE_FIXTURE_TEXT,
    1000
  );

  assert.deepEqual(
    transactions.map((tx) => ({
      date: tx.date,
      description: tx.description,
      amount: tx.amount,
      balance: tx.balance,
    })),
    [
      {
        date: "01/07/2026",
        description: "POS Purchase Coffee Shop Card",
        amount: -100,
        balance: 900,
      },
      {
        date: "02/07/2026",
        description: "Salary Deposit EFT",
        amount: 500,
        balance: 1400,
      },
    ]
  );
});

test("Batch 07 Discovery preserves printed running balances when they exist", () => {
  const transactions = extractDiscoveryTransactions(
    DISCOVERY_OBSERVED_BALANCE_FIXTURE_TEXT,
    1000
  );

  assert.deepEqual(
    transactions.map((tx) => tx.balance),
    [900, 1400]
  );
  assert.deepEqual(
    transactions.map((tx) => tx.amount),
    [-100, 500]
  );
});

test("Batch 07 Discovery repairs the legacy inverted month-year-day date form", () => {
  const transactions = extractDiscoveryTransactions(
    DISCOVERY_INVERTED_DATE_FIXTURE_TEXT,
    1000
  );

  assert.equal(transactions.length, 1);
  assert.equal(transactions[0].date, "27/07/2026");
  assert.equal(transactions[0].amount, -100);
  assert.equal(transactions[0].balance, 900);
});

test("Batch 07 Discovery extraction returns authoritative metadata and transactions", async () => {
  const classification = await classifyDocument({
    fileName: file.originalname,
    extractedText: DISCOVERY_STATEMENT_FIXTURE_TEXT,
  });

  const raw = buildBankStatementExtraction({
    file,
    classification,
    extractedText: DISCOVERY_STATEMENT_FIXTURE_TEXT,
    textPreview: DISCOVERY_STATEMENT_FIXTURE_TEXT.slice(0, 2000),
    extractionMeta: { sourceType: "fixture" },
  });

  assert.equal(raw.metadata.accountNumber, "123456789012");
  assert.equal(raw.metadata.clientName, "MR JOHN SAMPLE");
  assert.equal(raw.metadata.statementPeriodStart, "01 Jul 2026");
  assert.equal(raw.metadata.statementPeriodEnd, "31 Jul 2026");
  assert.equal(raw.metadata.openingBalance, 1000);
  assert.equal(raw.metadata.closingBalance, 1100);
  assert.deepEqual(raw.transactions, DISCOVERY_EXPECTED_TRANSACTIONS);
});

test("Batch 07 Discovery normalizer produces the canonical V2 bank statement contract", async () => {
  const classification = await classifyDocument({
    fileName: file.originalname,
    extractedText: DISCOVERY_STATEMENT_FIXTURE_TEXT,
  });

  const raw = buildBankStatementExtraction({
    file,
    classification,
    extractedText: DISCOVERY_STATEMENT_FIXTURE_TEXT,
  });
  const normalized = buildBankStatementNormalization(raw);

  assert.deepEqual(normalized, DISCOVERY_EXPECTED_NORMALIZED);
  assert.deepEqual(validateBankStatementShape(normalized), {
    valid: true,
    issues: [],
  });
});

test("Batch 07 Discovery validator passes a fully reconciled statement with score 1", async () => {
  const validation = await validateBankStatement(DISCOVERY_EXPECTED_NORMALIZED);

  assert.equal(validation.valid, true);
  assert.equal(validation.status, "passed");
  assert.equal(validation.score, 1);
  assert.deepEqual(validation.issues, []);
});

test("Batch 07 Discovery preserves an observed running-balance mismatch for review", async () => {
  const mismatchText = DISCOVERY_OBSERVED_BALANCE_FIXTURE_TEXT.replace(
    "R500.00 R1,400.00",
    "R500.00 R1,390.00"
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

test("Batch 07 Discovery closing-balance mismatch is marked needs_review", async () => {
  const warningText = DISCOVERY_STATEMENT_FIXTURE_TEXT.replace(
    "Closing balance R 1,100.00",
    "Closing balance R 1,099.00"
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

test("Batch 07 Discovery runParseJob completes end-to-end with canonical data", async () => {
  const result = await runParseJob({
    file,
    extractedText: DISCOVERY_STATEMENT_FIXTURE_TEXT,
    extractionMeta: { sourceType: "fixture" },
  });

  assert.equal(result.status, "completed");
  assert.equal(result.result.validationStatus, "passed");
  assert.equal(result.result.validationScore, 1);
  assert.equal(result.result.data.bankName, "Discovery Bank");
  assert.equal(result.result.data.transactions.length, 4);
  assert.deepEqual(result.result.data, DISCOVERY_EXPECTED_NORMALIZED);
});
