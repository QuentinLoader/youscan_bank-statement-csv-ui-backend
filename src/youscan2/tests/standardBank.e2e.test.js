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

test("Standard Bank supports money-first forward transaction context", () => {
  const moneyFirstFixture = `
The Standard Bank of South Africa Limited
BANK STATEMENT / TAX INVOICE
Account Number 1009 547 382 1
Statement from 01 July 2026 to 31 July 2026
BALANCE BROUGHT FORWARD 1,000.00
100.00 900.00
SBSA TEST 260701
Card Purchase Example
Month-end Balance R900.00
`;

  const transactions = extractStandardBankTransactions(
    moneyFirstFixture,
    period,
    1000
  );

  assert.equal(transactions.length, 1);

  assert.deepEqual(transactions[0], {
    date: "01/07/2026",
    description: "Card Purchase Example SBSA TEST 260701",
    amount: -100,
    balance: 900,
  });
});

test("Standard Bank prefers forward context over stale unpaid-fee context", () => {
  const moneyFirstFixture = `
The Standard Bank of South Africa Limited
BANK STATEMENT / TAX INVOICE
Account Number 1009 547 382 1
Statement from 01 July 2026 to 31 July 2026
BALANCE BROUGHT FORWARD 1,000.00

100.00 900.00
FEE-UNPAID ITEM

50.00 850.00
SBSA TEST 260702
Card Purchase Example

Month-end Balance R850.00
`;

  const transactions = extractStandardBankTransactions(
    moneyFirstFixture,
    period,
    1000
  );

  assert.equal(transactions.length, 2);

  assert.equal(transactions[1].date, "02/07/2026");
  assert.equal(
    transactions[1].description,
    "Card Purchase Example SBSA TEST 260702"
  );
  assert.equal(transactions[1].amount, -50);
  assert.equal(transactions[1].balance, 850);
});

test("Standard Bank normalizer preserves extractor-approved unpaid-fee transactions", async () => {
  const { normalizeStandardBankTransactions } = await import(
    "../normalizer/standardBank/normalizer.js"
  );

  const extractedTransactions = [
    {
      date: "01/07/2026",
      description: "FEE-UNPAID ITEM",
      amount: -100,
      balance: 900,
    },
    {
      date: "02/07/2026",
      description: "UNPAID FEE DEBICHECK D/O",
      amount: -50,
      balance: 850,
    },
  ];

  const normalized = normalizeStandardBankTransactions(
    extractedTransactions,
    "31 July 2026"
  );

  assert.equal(normalized.length, 2);
  assert.deepEqual(normalized, extractedTransactions);
});

test("Standard Bank preserves a legitimate leading thousands group in balances", async () => {
  const { parseStandardBankBalanceToken } = await import(
    "../extractor/shared/money.js"
  );

  assert.equal(
    parseStandardBankBalanceToken("12 345 678.90"),
    12345678.90
  );
});


test("Standard Bank native rows preserve debit, RTD credit and unpaid fee", async () => {
  const {
    extractStandardBankTransactions,
  } = await import(
    "../extractor/standardBank/extractor.js"
  );

  const {
    normalizeStandardBankTransactions,
  } = await import(
    "../normalizer/standardBank/normalizer.js"
  );

  const text = `
BALANCE BROUGHT FORWARD 12 08 1,252.94-
LOAN REPAYMENT 62.74- 12 12 1,315.68-
SBSA LOAN 10133962812 251212
RTD-NOT PROVIDED FOR 62.74 12 12 1,252.94-
SBSA LOAN 10133962812 251212
FEE-UNPAID ITEM ## 130.00- 12 12 1,382.94-
`;

  const extracted =
    extractStandardBankTransactions(
      text,
      {
        start:
          "08 December 2025",
        end:
          "08 January 2026",
      },
      -1252.94
    );

  assert.equal(
    extracted.length,
    3
  );

  assert.deepEqual(
    extracted.map(tx => ({
      date: tx.date,
      amount: tx.amount,
      balance: tx.balance,
    })),
    [
      {
        date: "12/12/2025",
        amount: -62.74,
        balance: -1315.68,
      },
      {
        date: "12/12/2025",
        amount: 62.74,
        balance: -1252.94,
      },
      {
        date: "12/12/2025",
        amount: -130,
        balance: -1382.94,
      },
    ]
  );

  const normalized =
    normalizeStandardBankTransactions(
      extracted,
      "08 January 2026"
    );

  assert.equal(
    normalized.length,
    3
  );
});


test("Standard Bank uses statement-date closing balance ahead of month-end balance", async () => {
  const {
    extractStandardBankOpeningBalance,
    extractStandardBankClosingBalance,
  } = await import(
    "../extractor/shared/metadata.js"
  );

  const text = `
Month-end Balance R2,681.42-
BALANCE BROUGHT FORWARD 12 08 1,252.94-
Balance outstanding at date of statement 3,071.42-
`;

  assert.equal(
    extractStandardBankOpeningBalance(text),
    -1252.94
  );

  assert.equal(
    extractStandardBankClosingBalance(text),
    -3071.42
  );
});
