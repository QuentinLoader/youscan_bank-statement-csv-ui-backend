import test from "node:test";
import assert from "node:assert/strict";

import { classifyDocument } from "../classifier/classifyDocument.js";
import { extractFnbTransactions } from "../extractor/fnb/extractor.js";
import { buildBankStatementExtraction } from "../extractor/index.js";
import { buildBankStatementNormalization } from "../normalizer/index.js";
import { runParseJob } from "../orchestrator/runParseJob.js";
import { validateBankStatement } from "../plugins/bankStatement/bankStatement.validator.js";
import { validateBankStatementShape } from "../schemas/bankStatement.v1.js";
import {
  FNB_DEBIT_BALANCE_FIXTURE_TEXT,
  FNB_EXPECTED_NORMALIZED,
  FNB_EXPECTED_TRANSACTIONS,
  FNB_NO_AMOUNT_SIGN_FIXTURE_TEXT,
  FNB_STATEMENT_FIXTURE_TEXT,
} from "./fixtures/fnbStatement.fixture.js";

const file = {
  originalname: "fnb-july-2026.pdf",
  mimetype: "application/pdf",
};

const period = {
  start: "01 July 2026",
  end: "31 July 2026",
};

test("Batch 04 FNB is classified as a supported native V2 bank", async () => {
  const classification = await classifyDocument({
    fileName: file.originalname,
    extractedText: FNB_STATEMENT_FIXTURE_TEXT,
  });

  assert.equal(classification.documentType, "bank_statement");
  assert.equal(classification.documentSubtype, "fnb_statement");
  assert.equal(classification.supported, true);
});

test("Batch 04 FNB extractor preserves explicit Cr/Dr transaction signs", () => {
  const transactions = extractFnbTransactions(
    FNB_STATEMENT_FIXTURE_TEXT,
    period,
    1000
  );

  assert.equal(transactions.length, 4);
  assert.deepEqual(transactions, FNB_EXPECTED_TRANSACTIONS);
  assert.deepEqual(
    transactions.map((tx) => tx.amount),
    [-100, 500, -250, -50]
  );
});

test("Batch 04 FNB extractor reconstructs wrapped descriptions", () => {
  const transactions = extractFnbTransactions(
    FNB_STATEMENT_FIXTURE_TEXT,
    period,
    1000
  );

  assert.equal(
    transactions[2].description,
    "EFT PAYMENT SUPPLIER ABC Reference INV-7781"
  );
});

test("Batch 04 FNB infers amount direction from running balances when Cr/Dr is absent", () => {
  const transactions = extractFnbTransactions(
    FNB_NO_AMOUNT_SIGN_FIXTURE_TEXT,
    period,
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

test("Batch 04 FNB preserves debit running balances as negative values", () => {
  const transactions = extractFnbTransactions(
    FNB_DEBIT_BALANCE_FIXTURE_TEXT,
    period,
    50
  );

  assert.equal(transactions.length, 1);
  assert.equal(transactions[0].amount, -100);
  assert.equal(transactions[0].balance, -50);
});

test("Batch 04 FNB extraction returns complete authoritative metadata and transactions", async () => {
  const classification = await classifyDocument({
    fileName: file.originalname,
    extractedText: FNB_STATEMENT_FIXTURE_TEXT,
  });

  const raw = buildBankStatementExtraction({
    file,
    classification,
    extractedText: FNB_STATEMENT_FIXTURE_TEXT,
    textPreview: FNB_STATEMENT_FIXTURE_TEXT.slice(0, 2000),
    extractionMeta: { sourceType: "fixture" },
  });

  assert.equal(raw.metadata.accountNumber, "62123456789");
  assert.equal(raw.metadata.clientName, "ACME TRADING PTY LTD");
  assert.equal(raw.metadata.statementPeriodStart, "01 July 2026");
  assert.equal(raw.metadata.statementPeriodEnd, "31 July 2026");
  assert.equal(raw.metadata.openingBalance, 1000);
  assert.equal(raw.metadata.closingBalance, 1100);
  assert.deepEqual(raw.transactions, FNB_EXPECTED_TRANSACTIONS);
});

test("Batch 04 FNB normalizer produces the canonical V2 bank statement contract", async () => {
  const classification = await classifyDocument({
    fileName: file.originalname,
    extractedText: FNB_STATEMENT_FIXTURE_TEXT,
  });

  const raw = buildBankStatementExtraction({
    file,
    classification,
    extractedText: FNB_STATEMENT_FIXTURE_TEXT,
  });
  const normalized = buildBankStatementNormalization(raw);

  assert.deepEqual(normalized, FNB_EXPECTED_NORMALIZED);
  assert.deepEqual(validateBankStatementShape(normalized), {
    valid: true,
    issues: [],
  });
});

test("Batch 04 FNB validator passes a fully reconciled statement with score 1", async () => {
  const validation = await validateBankStatement(FNB_EXPECTED_NORMALIZED);

  assert.equal(validation.valid, true);
  assert.equal(validation.status, "passed");
  assert.equal(validation.score, 1);
  assert.deepEqual(validation.issues, []);
});

test("Batch 04 FNB preserves a running-balance mismatch for review", async () => {
  const mismatchText = FNB_STATEMENT_FIXTURE_TEXT.replace(
    "500.00 Cr 1,400.00 Cr",
    "500.00 Cr 1,390.00 Cr"
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

test("Batch 04 FNB closing-balance mismatch is marked needs_review", async () => {
  const warningText = FNB_STATEMENT_FIXTURE_TEXT.replace(
    "Closing Balance 1,100.00 Cr",
    "Closing Balance 1,099.00 Cr"
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

test("Batch 04 FNB runParseJob completes end-to-end with canonical data", async () => {
  const result = await runParseJob({
    file,
    extractedText: FNB_STATEMENT_FIXTURE_TEXT,
    extractionMeta: { sourceType: "fixture" },
  });

  assert.equal(result.status, "completed");
  assert.equal(result.result.validationStatus, "passed");
  assert.equal(result.result.validationScore, 1);
  assert.equal(result.result.data.bankName, "FNB");
  assert.equal(result.result.data.transactions.length, 4);
  assert.deepEqual(result.result.data, FNB_EXPECTED_NORMALIZED);
});

test("FNB extractor accepts dates glued directly to descriptions", () => {
  const gluedDateFixture = `
First National Bank
Gold Business Account : 62123456789
*ACME TRADING PTY LTD
Statement Period : 01 July 2026 to 31 July 2026
Opening Balance 1,000.00 Cr
Transactions in RAND
01 JulCard Purchase Coffee Shop 100.00 Dr 900.00 Cr
02 JulCUSTOMER PAYMENT 500.00 Cr 1,400.00 Cr
Closing Balance 1,400.00 Cr
`;

  const transactions = extractFnbTransactions(
    gluedDateFixture,
    period,
    1000
  );

  assert.equal(transactions.length, 2);
  assert.equal(transactions[0].date, "01/07/2026");
  assert.equal(transactions[1].date, "02/07/2026");
  assert.equal(transactions[0].amount, -100);
  assert.equal(transactions[0].balance, 900);
  assert.equal(transactions[1].amount, 500);
  assert.equal(transactions[1].balance, 1400);
});

test("FNB extractor accepts concatenated amount and balance tokens", () => {
  const concatenatedMoneyFixture = `
First National Bank
Gold Business Account : 62123456789
*ACME TRADING PTY LTD
Statement Period : 01 July 2026 to 31 July 2026
Opening Balance 1,000.00 Cr
Transactions in RAND
01 JulCard Purchase Coffee Shop 100.00Dr900.00Cr
02 JulCUSTOMER PAYMENT 500.00Cr1,400.00Cr
Closing Balance 1,400.00 Cr
`;

  const transactions = extractFnbTransactions(
    concatenatedMoneyFixture,
    period,
    1000
  );

  assert.equal(transactions.length, 2);

  assert.deepEqual(transactions[0], {
    date: "01/07/2026",
    description: "Card Purchase Coffee Shop",
    amount: -100,
    balance: 900,
  });

  assert.deepEqual(transactions[1], {
    date: "02/07/2026",
    description: "CUSTOMER PAYMENT",
    amount: 500,
    balance: 1400,
  });
});

test("FNB extractor accepts amount immediately after description text", () => {
  const gluedDescriptionAmountFixture = `
First National Bank
Gold Business Account : 62123456789
*ACME TRADING PTY LTD
Statement Period : 01 July 2026 to 31 July 2026
Opening Balance 1,000.00 Cr
Transactions in RAND
01 JulCard Purchase Coffee Shop100.00Dr900.00Cr
02 JulCUSTOMER PAYMENT500.00Cr1,400.00Cr
Closing Balance 1,400.00 Cr
`;

  const transactions = extractFnbTransactions(
    gluedDescriptionAmountFixture,
    period,
    1000
  );

  assert.equal(transactions.length, 2);

  assert.deepEqual(transactions[0], {
    date: "01/07/2026",
    description: "Card Purchase Coffee Shop",
    amount: -100,
    balance: 900,
  });

  assert.deepEqual(transactions[1], {
    date: "02/07/2026",
    description: "CUSTOMER PAYMENT",
    amount: 500,
    balance: 1400,
  });
});

test("FNB extractor excludes non-financial informational entries", () => {
  const informationalFixture = `
First National Bank
Gold Business Account : 62123456789
*ACME TRADING PTY LTD
Statement Period : 01 July 2026 to 31 July 2026
Opening Balance 1,000.00 Cr
Transactions in RAND
01 JulInternet Trf From Customer 100.00 Cr 1,100.00 Cr
02 JulSchd Trxn No Av Bal Pmt To Rain Wifi 0.00 1,100.00 Cr
03 JulBalalert Weekly 0.00 1,100.00 Cr
04 JulPredet Limit Alert 0.00 1,100.00 Cr
Closing Balance 1,100.00 Cr
`;

  const transactions = extractFnbTransactions(
    informationalFixture,
    period,
    1000
  );

  assert.equal(transactions.length, 1);
  assert.equal(transactions[0].date, "01/07/2026");
  assert.equal(transactions[0].amount, 100);
  assert.equal(transactions[0].balance, 1100);
});
