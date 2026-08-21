import test from "node:test";
import assert from "node:assert/strict";

import { classifyDocument } from "../classifier/classifyDocument.js";
import { extractAbsaTransactions } from "../extractor/absa/extractor.js";
import { buildBankStatementExtraction } from "../extractor/index.js";
import { buildBankStatementNormalization } from "../normalizer/index.js";
import { normalizeAbsaTransactions } from "../normalizer/absa/normalizer.js";
import { runParseJob } from "../orchestrator/runParseJob.js";
import { validateBankStatement } from "../plugins/bankStatement/bankStatement.validator.js";
import { validateBankStatementShape } from "../schemas/bankStatement.v1.js";
import {
  ABSA_EXPECTED_NORMALIZED,
  ABSA_EXPECTED_TRANSACTIONS,
  ABSA_STATEMENT_FIXTURE_TEXT,
} from "./fixtures/absaStatement.fixture.js";

const file = {
  originalname: "absa-july-2026.pdf",
  mimetype: "application/pdf",
};

test("Batch 02 ABSA header is preserved and does not truncate transactions", () => {
  const transactions = extractAbsaTransactions(ABSA_STATEMENT_FIXTURE_TEXT, 1000);
  assert.equal(transactions.length, 4);
  assert.deepEqual(transactions, ABSA_EXPECTED_TRANSACTIONS);
});

test("Batch 02 ABSA opening balance determines the first transaction sign", () => {
  const transactions = extractAbsaTransactions(ABSA_STATEMENT_FIXTURE_TEXT, 1000);
  assert.equal(transactions[0].amount, -100);
  assert.equal(transactions[0].balance, 900);
  assert.equal(transactions[1].amount, 500);
});

test("Batch 02 ABSA extractor reconstructs wrapped descriptions", () => {
  const transactions = extractAbsaTransactions(ABSA_STATEMENT_FIXTURE_TEXT, 1000);
  assert.equal(
    transactions[2].description,
    "EFT PAYMENT SUPPLIER ABC Reference INV-7781"
  );
  assert.equal(transactions[2].amount, -250);
});

test("Batch 02 ABSA extraction returns complete metadata and transactions", async () => {
  const classification = await classifyDocument({
    fileName: file.originalname,
    extractedText: ABSA_STATEMENT_FIXTURE_TEXT,
  });

  const raw = buildBankStatementExtraction({
    file,
    classification,
    extractedText: ABSA_STATEMENT_FIXTURE_TEXT,
    textPreview: ABSA_STATEMENT_FIXTURE_TEXT.slice(0, 2000),
    extractionMeta: { sourceType: "fixture" },
  });

  assert.equal(raw.metadata.accountNumber, "4012345678");
  assert.equal(raw.metadata.clientName, "ACME TRADING PTY LTD");
  assert.equal(raw.metadata.statementPeriodStart, "01/07/2026");
  assert.equal(raw.metadata.statementPeriodEnd, "31/07/2026");
  assert.equal(raw.metadata.openingBalance, 1000);
  assert.equal(raw.metadata.closingBalance, 1100);
  assert.deepEqual(raw.transactions, ABSA_EXPECTED_TRANSACTIONS);
});

test("Batch 02 ABSA normalizer produces the canonical V2 bank statement contract", async () => {
  const classification = await classifyDocument({
    fileName: file.originalname,
    extractedText: ABSA_STATEMENT_FIXTURE_TEXT,
  });

  const raw = buildBankStatementExtraction({
    file,
    classification,
    extractedText: ABSA_STATEMENT_FIXTURE_TEXT,
  });
  const normalized = buildBankStatementNormalization(raw);

  assert.deepEqual(normalized, ABSA_EXPECTED_NORMALIZED);
  assert.deepEqual(validateBankStatementShape(normalized), {
    valid: true,
    issues: [],
  });
});

test("Batch 02 ABSA validator passes a fully reconciled statement with score 1", async () => {
  const validation = await validateBankStatement(ABSA_EXPECTED_NORMALIZED);

  assert.equal(validation.valid, true);
  assert.equal(validation.status, "passed");
  assert.equal(validation.score, 1);
  assert.deepEqual(validation.issues, []);
});

test("Batch 02 ABSA validator flags a closing balance mismatch for review", async () => {
  const normalized = {
    ...ABSA_EXPECTED_NORMALIZED,
    closingBalance: 1099,
  };

  const validation = await validateBankStatement(normalized);

  assert.equal(validation.valid, true);
  assert.equal(validation.status, "passed_with_warnings");
  assert.ok(
    validation.issues.some(
      (issue) => issue.issueType === "closing_balance_mismatch"
    )
  );
});

test("Batch 02 ABSA validator rejects invalid calendar dates", async () => {
  const normalized = {
    ...ABSA_EXPECTED_NORMALIZED,
    transactions: [
      {
        ...ABSA_EXPECTED_TRANSACTIONS[0],
        date: "31/02/2026",
      },
    ],
    closingBalance: 900,
  };

  const validation = await validateBankStatement(normalized);

  assert.equal(validation.valid, false);
  assert.equal(validation.status, "failed");
  assert.ok(validation.issues.some((issue) => issue.issueType === "invalid_date"));
});

test("Batch 02 ABSA runParseJob completes end-to-end with canonical data", async () => {
  const result = await runParseJob({
    file,
    extractedText: ABSA_STATEMENT_FIXTURE_TEXT,
    extractionMeta: { sourceType: "fixture" },
  });

  assert.equal(result.status, "completed");
  assert.equal(result.result.validationStatus, "passed");
  assert.equal(result.result.validationScore, 1);
  assert.equal(result.result.data.bankName, "ABSA");
  assert.equal(result.result.data.transactions.length, 4);
  assert.deepEqual(result.result.data, ABSA_EXPECTED_NORMALIZED);
});

test("Batch 02 warning-producing bank results are marked needs_review", async () => {
  const warningText = ABSA_STATEMENT_FIXTURE_TEXT.replace(
    "Closing balance: 1,100.00",
    "Closing balance: 1,099.00"
  );

  const result = await runParseJob({
    file,
    extractedText: warningText,
    extractionMeta: { sourceType: "fixture" },
  });

  assert.equal(result.status, "needs_review");
  assert.equal(result.result.validationStatus, "passed_with_warnings");
  assert.ok(
    result.result.issues.some(
      (issue) => issue.issueType === "closing_balance_mismatch"
    )
  );
});

test("ABSA normalizer normalizes single-digit day and month to canonical DD/MM/YYYY", () => {
  const normalized = normalizeAbsaTransactions([
    {
      date: "1/01/2026",
      description: "TEST",
      amount: -10,
      balance: 100,
    },
    {
      date: "2/1/2026",
      description: "TEST",
      amount: 10,
      balance: 110,
    },
  ]);

  assert.equal(normalized[0].date, "01/01/2026");
  assert.equal(normalized[1].date, "02/01/2026");
});

test("ABSA balance reconciliation overrides debit-description heuristic", async () => {
  const normalized = {
    ...ABSA_EXPECTED_NORMALIZED,
    closingBalance: 1200,
    transactions: [
      ...ABSA_EXPECTED_TRANSACTIONS.slice(0, 3),
      {
        date: "04/07/2026",
        description: "Monthly Acc Fee",
        amount: 50,
        balance: 1200,
      },
    ],
  };

  const validation = await validateBankStatement(normalized);

  assert.equal(
    validation.issues.some(
      (issue) => issue.issueType === "possible_wrong_sign_debit"
    ),
    false
  );

  assert.equal(
    validation.issues.some(
      (issue) => issue.issueType === "balance_continuity_mismatch"
    ),
    false
  );
});
