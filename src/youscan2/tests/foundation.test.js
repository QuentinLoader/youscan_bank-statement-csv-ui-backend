import test from "node:test";
import assert from "node:assert/strict";

import { classifyDocument } from "../classifier/classifyDocument.js";
import { extractBySubtype } from "../extractor/index.js";
import { DOCUMENT_SUBTYPES } from "../registry/documentTypes.js";
import {
  isImplementedV2BankSubtype,
  isRecognizedV2BankSubtype,
} from "../registry/bankSupport.js";
import { validateBankStatementShape } from "../schemas/bankStatement.v1.js";
import { createParseJob } from "../orchestrator/createParseJob.js";
import { finalizeParseJob } from "../orchestrator/finalizeParseJob.js";
import { runParseJob } from "../orchestrator/runParseJob.js";

test("V2 support registry recognizes all known banks and exposes only implemented adapters", () => {
  assert.equal(isRecognizedV2BankSubtype(DOCUMENT_SUBTYPES.FNB_STATEMENT), true);
  assert.equal(isImplementedV2BankSubtype(DOCUMENT_SUBTYPES.FNB_STATEMENT), true);
  assert.equal(isImplementedV2BankSubtype(DOCUMENT_SUBTYPES.ABSA_STATEMENT), true);
  assert.equal(isImplementedV2BankSubtype(DOCUMENT_SUBTYPES.CAPITEC_STATEMENT), true);
  assert.equal(isImplementedV2BankSubtype(DOCUMENT_SUBTYPES.NEDBANK_STATEMENT), true);
  assert.equal(isImplementedV2BankSubtype(DOCUMENT_SUBTYPES.DISCOVERY_STATEMENT), true);
  assert.equal(
    isImplementedV2BankSubtype(DOCUMENT_SUBTYPES.STANDARD_BANK_STATEMENT),
    true
  );
});

test("ABSA is classified as supported by the current V2 build", async () => {
  const result = await classifyDocument({
    fileName: "absa.pdf",
    extractedText: "ABSA transaction date debit credit balance opening balance",
  });

  assert.equal(result.documentSubtype, DOCUMENT_SUBTYPES.ABSA_STATEMENT);
  assert.equal(result.supported, true);
  assert.equal(result.classificationMethod, "heuristic");
  assert.equal(result.aiAttempted, false);
});

test("FNB is classified as supported after the Batch 04 V2 adapter", async () => {
  const result = await classifyDocument({
    fileName: "fnb.pdf",
    extractedText: "First National Bank transaction date debit credit balance",
  });

  assert.equal(result.documentSubtype, DOCUMENT_SUBTYPES.FNB_STATEMENT);
  assert.equal(result.supported, true);
  assert.equal(result.suggestedPipeline, "bank_statement_v2");
});


test("Capitec is classified as supported after the Batch 05 V2 adapter", async () => {
  const result = await classifyDocument({
    fileName: "capitec.pdf",
    extractedText: "Capitec Bank Limited opening balance transaction date debit credit balance",
  });

  assert.equal(result.documentSubtype, DOCUMENT_SUBTYPES.CAPITEC_STATEMENT);
  assert.equal(result.supported, true);
  assert.equal(result.suggestedPipeline, "bank_statement_v2");
});



test("Nedbank is classified as supported after the Batch 06 V2 adapter", async () => {
  const result = await classifyDocument({
    fileName: "nedbank.pdf",
    extractedText: "Nedbank opening balance transaction date debit credit balance",
  });

  assert.equal(result.documentSubtype, DOCUMENT_SUBTYPES.NEDBANK_STATEMENT);
  assert.equal(result.supported, true);
  assert.equal(result.suggestedPipeline, "bank_statement_v2");
});

test("Discovery Bank is classified as supported after the Batch 07 V2 adapter", async () => {
  const result = await classifyDocument({
    fileName: "discovery.pdf",
    extractedText: "Discovery Bank Limited Transaction Account 123456789012 opening balance closing balance",
  });

  assert.equal(result.documentSubtype, DOCUMENT_SUBTYPES.DISCOVERY_STATEMENT);
  assert.equal(result.supported, true);
  assert.equal(result.suggestedPipeline, "bank_statement_v2");
});

test("generic bank structure is not silently routed to ABSA", async () => {
  const result = await classifyDocument({
    extractedText: "opening balance closing balance transaction date debit credit balance",
  });

  assert.equal(result.documentSubtype, DOCUMENT_SUBTYPES.UNKNOWN);
  assert.equal(result.supported, false);
});

test("extractor refuses an unknown bank subtype instead of using another bank fallback", () => {
  assert.throws(
    () => extractBySubtype("sample", "future_bank_statement"),
    (error) => error?.code === "V2_BANK_SUBTYPE_NOT_IMPLEMENTED"
  );
});

test("canonical bank statement schema accepts a valid normalized result", () => {
  const result = validateBankStatementShape({
    bankName: "ABSA",
    accountNumber: "123456",
    clientName: "Test Client",
    statementPeriodStart: "01/01/2026",
    statementPeriodEnd: "31/01/2026",
    openingBalance: 1000,
    closingBalance: 900,
    sourceFileName: "statement.pdf",
    transactions: [
      {
        date: "02/01/2026",
        description: "Card purchase",
        amount: -100,
        balance: 900,
      },
    ],
  });

  assert.deepEqual(result, { valid: true, issues: [] });
});

test("canonical bank statement schema rejects invalid transaction amounts", () => {
  const result = validateBankStatementShape({
    bankName: "ABSA",
    accountNumber: null,
    clientName: null,
    statementPeriodStart: null,
    statementPeriodEnd: null,
    openingBalance: null,
    closingBalance: null,
    sourceFileName: null,
    transactions: [
      {
        date: null,
        description: "Broken row",
        amount: null,
        balance: null,
      },
    ],
  });

  assert.equal(result.valid, false);
  assert.match(result.issues.join("\n"), /amount must be a finite number/);
});

test("parse job lifecycle creates and finalizes a stable envelope", () => {
  const job = createParseJob({
    file: { originalname: "test.pdf", mimetype: "application/pdf" },
  });

  const final = finalizeParseJob({
    job,
    status: "unsupported",
    message: "test",
  });

  assert.equal(final.jobId, job.jobId);
  assert.equal(final.status, "unsupported");
  assert.equal(final.message, "test");
  assert.ok(final.startedAt);
  assert.ok(final.completedAt);
  assert.equal(typeof final.durationMs, "number");
});

test("runParseJob returns unsupported for strong generic bank structure with no known bank", async () => {
  const result = await runParseJob({
    file: { originalname: "unknown-bank.pdf", mimetype: "application/pdf" },
    extractedText: "opening balance closing balance transaction date debit credit balance",
    extractionMeta: { sourceType: "test" },
  });

  assert.equal(result.status, "unsupported");
  assert.equal(result.classification.documentSubtype, DOCUMENT_SUBTYPES.UNKNOWN);
  assert.equal(result.error, null);
});
