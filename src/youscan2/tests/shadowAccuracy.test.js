import assert from "node:assert/strict";
import test from "node:test";

import {
  AI_DISAGREEMENT_CATEGORIES,
  AI_DISAGREEMENT_SEVERITIES,
  aggregateBankStatementAccuracy,
  analyzeShadowDisagreements,
  compareAiToDeterministicBankStatement,
  scoreBankStatementAgainstReference,
} from "../ai/extraction/index.js";
import { runParseJob } from "../orchestrator/runParseJob.js";
import {
  ABSA_EXPECTED_NORMALIZED,
  ABSA_STATEMENT_FIXTURE_TEXT,
} from "./fixtures/absaStatement.fixture.js";
import {
  STANDARD_BANK_EXPECTED_NORMALIZED,
  STANDARD_BANK_STATEMENT_FIXTURE_TEXT,
} from "./fixtures/standardBankStatement.fixture.js";
import {
  FNB_EXPECTED_NORMALIZED,
  FNB_STATEMENT_FIXTURE_TEXT,
} from "./fixtures/fnbStatement.fixture.js";
import {
  CAPITEC_EXPECTED_NORMALIZED,
  CAPITEC_STATEMENT_FIXTURE_TEXT,
} from "./fixtures/capitecStatement.fixture.js";
import {
  NEDBANK_EXPECTED_NORMALIZED,
  NEDBANK_STATEMENT_FIXTURE_TEXT,
} from "./fixtures/nedbankStatement.fixture.js";
import {
  DISCOVERY_EXPECTED_NORMALIZED,
  DISCOVERY_STATEMENT_FIXTURE_TEXT,
} from "./fixtures/discoveryStatement.fixture.js";

const BANK_CASES = [
  {
    bankName: "ABSA",
    fileName: "absa-july-2026.pdf",
    text: ABSA_STATEMENT_FIXTURE_TEXT,
    expected: ABSA_EXPECTED_NORMALIZED,
  },
  {
    bankName: "Standard Bank",
    fileName: "standard-bank-july-2026.pdf",
    text: STANDARD_BANK_STATEMENT_FIXTURE_TEXT,
    expected: STANDARD_BANK_EXPECTED_NORMALIZED,
  },
  {
    bankName: "FNB",
    fileName: "fnb-july-2026.pdf",
    text: FNB_STATEMENT_FIXTURE_TEXT,
    expected: FNB_EXPECTED_NORMALIZED,
  },
  {
    bankName: "Capitec",
    fileName: "capitec-july-2026.pdf",
    text: CAPITEC_STATEMENT_FIXTURE_TEXT,
    expected: CAPITEC_EXPECTED_NORMALIZED,
  },
  {
    bankName: "Nedbank",
    fileName: "nedbank-july-2026.pdf",
    text: NEDBANK_STATEMENT_FIXTURE_TEXT,
    expected: NEDBANK_EXPECTED_NORMALIZED,
  },
  {
    bankName: "Discovery Bank",
    fileName: "discovery-july-2026.pdf",
    text: DISCOVERY_STATEMENT_FIXTURE_TEXT,
    expected: DISCOVERY_EXPECTED_NORMALIZED,
  },
];

function clone(value) {
  return structuredClone(value);
}

function exactScore(bankCase, engine = "ai-shadow") {
  return scoreBankStatementAgainstReference({
    candidateCanonical: clone(bankCase.expected),
    referenceCanonical: bankCase.expected,
    engine,
    bankName: bankCase.bankName,
  });
}

test("Batch 13 comparison exposes privacy-safe per-field agreement counts", () => {
  const candidate = clone(FNB_EXPECTED_NORMALIZED);
  candidate.transactions[0].amount = -99;

  const comparison = compareAiToDeterministicBankStatement({
    aiCanonical: candidate,
    deterministicCanonical: FNB_EXPECTED_NORMALIZED,
  });

  assert.equal(comparison.transactions.fieldStats.amount.compared, 4);
  assert.equal(comparison.transactions.fieldStats.amount.matched, 3);
  assert.equal(comparison.transactions.fieldStats.amount.agreementRate, 0.75);
  assert.equal(comparison.metadata.fieldStats.accountNumber.agreementRate, 1);
  assert.equal(comparison.signals.matched, comparison.signals.compared - 1);

  const serialized = JSON.stringify(comparison);
  assert.equal(serialized.includes("62123456789"), false);
  assert.equal(serialized.includes("ACME TRADING"), false);
  assert.equal(serialized.includes("-99"), false);
});

test("Batch 13 amount disagreement is classified as critical transaction_amount", () => {
  const candidate = clone(FNB_EXPECTED_NORMALIZED);
  candidate.transactions[0].amount = -99;
  const comparison = compareAiToDeterministicBankStatement({
    aiCanonical: candidate,
    deterministicCanonical: FNB_EXPECTED_NORMALIZED,
  });
  const analysis = analyzeShadowDisagreements(comparison);

  assert.equal(analysis.issueCount, 1);
  assert.equal(analysis.byCategory[AI_DISAGREEMENT_CATEGORIES.TRANSACTION_AMOUNT], 1);
  assert.equal(analysis.bySeverity[AI_DISAGREEMENT_SEVERITIES.CRITICAL], 1);
  assert.equal(analysis.affectedTransactionRowCount, 1);
});

test("Batch 13 description disagreement is medium severity, not critical", () => {
  const candidate = clone(FNB_EXPECTED_NORMALIZED);
  candidate.transactions[2].description = "EFT PAYMENT SUPPLIER ABC";
  const analysis = analyzeShadowDisagreements(
    compareAiToDeterministicBankStatement({
      aiCanonical: candidate,
      deterministicCanonical: FNB_EXPECTED_NORMALIZED,
    })
  );

  assert.equal(
    analysis.byCategory[AI_DISAGREEMENT_CATEGORIES.TRANSACTION_DESCRIPTION],
    1
  );
  assert.equal(analysis.bySeverity[AI_DISAGREEMENT_SEVERITIES.MEDIUM], 1);
  assert.equal(analysis.bySeverity[AI_DISAGREEMENT_SEVERITIES.CRITICAL] || 0, 0);
});

test("Batch 13 transaction-count disagreement is critical", () => {
  const candidate = clone(FNB_EXPECTED_NORMALIZED);
  candidate.transactions.pop();
  const analysis = analyzeShadowDisagreements(
    compareAiToDeterministicBankStatement({
      aiCanonical: candidate,
      deterministicCanonical: FNB_EXPECTED_NORMALIZED,
    })
  );

  assert.equal(analysis.byCategory[AI_DISAGREEMENT_CATEGORIES.TRANSACTION_COUNT], 1);
  assert.equal(analysis.bySeverity[AI_DISAGREEMENT_SEVERITIES.CRITICAL], 1);
});

test("Batch 13 labelled reference scoring distinguishes accuracy from agreement", () => {
  const score = exactScore(BANK_CASES[2]);
  assert.equal(score.comparable, true);
  assert.equal(score.exactMatch, true);
  assert.equal(score.accuracy, 1);
  assert.equal(score.fieldAccuracy.transactionAmount.accuracy, 1);
  assert.equal(score.fieldAccuracy.transactionBalance.accuracy, 1);
});

test("Batch 13 labelled scoring reports a wrong amount without exposing the amount", () => {
  const candidate = clone(FNB_EXPECTED_NORMALIZED);
  candidate.transactions[1].amount = 499;
  const score = scoreBankStatementAgainstReference({
    candidateCanonical: candidate,
    referenceCanonical: FNB_EXPECTED_NORMALIZED,
    engine: "ai-shadow",
    bankName: "FNB",
  });

  assert.equal(score.exactMatch, false);
  assert.equal(score.fieldAccuracy.transactionAmount.accuracy, 0.75);
  assert.equal(score.disagreement.byField.amount, 1);
  assert.equal(JSON.stringify(score).includes("499"), false);
  assert.equal(JSON.stringify(score).includes("500"), false);
});

test("Batch 13 aggregate report reaches 100% on six exact labelled bank fixtures", () => {
  const report = aggregateBankStatementAccuracy(BANK_CASES.map((item) => exactScore(item)));

  assert.equal(report.sampleCount, 6);
  assert.equal(report.comparableSampleCount, 6);
  assert.equal(report.exactMatchCount, 6);
  assert.equal(report.exactMatchRate, 1);
  assert.equal(report.signals.accuracy, 1);
  assert.equal(Object.keys(report.banks).length, 6);
  assert.equal(report.fieldAccuracy.transactionAmount.accuracy, 1);
  assert.equal(report.fieldAccuracy.transactionBalance.accuracy, 1);
  assert.equal(report.disagreement.issueCount, 0);
});

test("Batch 13 aggregate report weights accuracy by compared signals, not by bank name", () => {
  const scores = BANK_CASES.map((item) => exactScore(item));
  const modified = clone(FNB_EXPECTED_NORMALIZED);
  modified.transactions[0].amount = -99;
  scores[2] = scoreBankStatementAgainstReference({
    candidateCanonical: modified,
    referenceCanonical: FNB_EXPECTED_NORMALIZED,
    engine: "ai-shadow",
    bankName: "FNB",
  });

  const report = aggregateBankStatementAccuracy(scores);
  assert.equal(report.exactMatchCount, 5);
  assert.equal(report.exactMatchRate, 0.8333);
  assert.ok(report.signals.accuracy < 1);
  assert.equal(report.fieldAccuracy.transactionAmount.matched, 23);
  assert.equal(report.fieldAccuracy.transactionAmount.compared, 24);
  assert.equal(report.disagreement.byField.amount, 1);
  assert.equal(report.banks.FNB.exactMatchRate, 0);
  assert.equal(report.banks.ABSA.exactMatchRate, 1);
});

test("Batch 13 non-comparable samples are counted but excluded from accuracy denominator", () => {
  const good = exactScore(BANK_CASES[0]);
  const bad = scoreBankStatementAgainstReference({
    candidateCanonical: null,
    referenceCanonical: ABSA_EXPECTED_NORMALIZED,
    engine: "ai-shadow",
    bankName: "ABSA",
  });
  const report = aggregateBankStatementAccuracy([good, bad]);

  assert.equal(report.sampleCount, 2);
  assert.equal(report.comparableSampleCount, 1);
  assert.equal(report.nonComparableSampleCount, 1);
  assert.equal(report.exactMatchRate, 1);
});

test("Batch 13 cross-bank report remains privacy-safe", () => {
  const report = aggregateBankStatementAccuracy(BANK_CASES.map((item) => exactScore(item)));
  const serialized = JSON.stringify(report);

  for (const secret of [
    "4012345678",
    "10095473821",
    "62123456789",
    "1234567890",
    "1605123456",
    "123456789012",
    "ACME TRADING",
    "Coffee Shop",
  ]) {
    assert.equal(serialized.includes(secret), false);
  }
});

test("Batch 13 deterministic engine remains 100% accurate against all six labelled regression fixtures", async () => {
  const scores = [];

  for (const bankCase of BANK_CASES) {
    const result = await runParseJob({
      file: { originalname: bankCase.fileName, mimetype: "application/pdf" },
      extractedText: bankCase.text,
      extractionMeta: { sourceType: "batch13-labelled-fixture" },
    });

    assert.ok(["completed", "needs_review"].includes(result.status));
    assert.ok(result.result?.data);

    scores.push(
      scoreBankStatementAgainstReference({
        candidateCanonical: result.result.data,
        referenceCanonical: bankCase.expected,
        engine: "deterministic-v2",
        bankName: bankCase.bankName,
      })
    );
  }

  const report = aggregateBankStatementAccuracy(scores);
  assert.equal(report.sampleCount, 6);
  assert.equal(report.exactMatchCount, 6);
  assert.equal(report.signals.accuracy, 1);
  assert.equal(report.fieldAccuracy.transactionAmount.accuracy, 1);
  assert.equal(report.fieldAccuracy.transactionBalance.accuracy, 1);
});

test("Batch 13 multiple disagreements are grouped by category and severity", () => {
  const candidate = clone(FNB_EXPECTED_NORMALIZED);
  candidate.accountNumber = "different";
  candidate.statementPeriodEnd = "30/07/2026";
  candidate.transactions[0].date = "02/07/2026";
  candidate.transactions[0].amount = -99;
  candidate.transactions[0].balance = 901;
  candidate.transactions[1].description = "Different description";

  const score = scoreBankStatementAgainstReference({
    candidateCanonical: candidate,
    referenceCanonical: FNB_EXPECTED_NORMALIZED,
    bankName: "FNB",
  });

  assert.equal(score.disagreement.byCategory.identity, 1);
  assert.equal(score.disagreement.byCategory.period, 1);
  assert.equal(score.disagreement.byCategory.transaction_date, 1);
  assert.equal(score.disagreement.byCategory.transaction_amount, 1);
  assert.equal(score.disagreement.byCategory.transaction_balance, 1);
  assert.equal(score.disagreement.byCategory.transaction_description, 1);
  assert.equal(score.disagreement.bySeverity.critical, 3);
  assert.equal(score.disagreement.bySeverity.high, 2);
  assert.equal(score.disagreement.bySeverity.medium, 1);
});


test("Batch 13A labelled scoring can exclude fields that are not observable in source text", () => {
  const candidate = clone(DISCOVERY_EXPECTED_NORMALIZED);
  for (const transaction of candidate.transactions) transaction.balance = null;

  const unfiltered = scoreBankStatementAgainstReference({
    candidateCanonical: candidate,
    referenceCanonical: DISCOVERY_EXPECTED_NORMALIZED,
    engine: "ai-shadow",
    bankName: "Discovery Bank",
  });
  assert.equal(unfiltered.fieldAccuracy.transactionBalance.accuracy, 0);
  assert.equal(unfiltered.exactMatch, false);

  const sourceFaithful = scoreBankStatementAgainstReference({
    candidateCanonical: candidate,
    referenceCanonical: DISCOVERY_EXPECTED_NORMALIZED,
    engine: "ai-shadow",
    bankName: "Discovery Bank",
    ignoreTransactionFields: ["balance"],
  });

  assert.equal(sourceFaithful.fieldAccuracy.transactionBalance.compared, 0);
  assert.equal(sourceFaithful.fieldAccuracy.transactionBalance.accuracy, null);
  assert.equal(sourceFaithful.exactMatch, true);
  assert.equal(sourceFaithful.disagreement.issueCount, 0);
});

test("Batch 13A cross-bank aggregate keeps transaction-balance accuracy exact without scoring derived Discovery balances", () => {
  const scores = BANK_CASES.map((item) => {
    const candidate = clone(item.expected);
    const options = {};
    if (item.bankName === "Discovery Bank") {
      for (const transaction of candidate.transactions) transaction.balance = null;
      options.ignoreTransactionFields = ["balance"];
    }
    return scoreBankStatementAgainstReference({
      candidateCanonical: candidate,
      referenceCanonical: item.expected,
      engine: "ai-shadow",
      bankName: item.bankName,
      ...options,
    });
  });

  const report = aggregateBankStatementAccuracy(scores);
  assert.equal(report.fieldAccuracy.transactionBalance.compared, 20);
  assert.equal(report.fieldAccuracy.transactionBalance.matched, 20);
  assert.equal(report.fieldAccuracy.transactionBalance.accuracy, 1);
  assert.equal(report.signals.accuracy, 1);
});


test("Batch 13C recognized bank legal/brand aliases compare as the same canonical bank", () => {
  const aliases = [
    ["ABSA Bank Limited", ABSA_EXPECTED_NORMALIZED],
    ["The Standard Bank of South Africa Limited", STANDARD_BANK_EXPECTED_NORMALIZED],
    ["First National Bank", FNB_EXPECTED_NORMALIZED],
    ["Capitec Bank Limited", CAPITEC_EXPECTED_NORMALIZED],
    ["Nedbank Limited", NEDBANK_EXPECTED_NORMALIZED],
    ["Discovery Bank Limited", DISCOVERY_EXPECTED_NORMALIZED],
  ];

  for (const [alias, expected] of aliases) {
    const candidate = clone(expected);
    candidate.bankName = alias;
    const comparison = compareAiToDeterministicBankStatement({
      aiCanonical: candidate,
      deterministicCanonical: expected,
    });
    assert.equal(comparison.metadata.fieldStats.bankName.agreementRate, 1, alias);
  }
});

test("Batch 13C redundant standalone transaction-date token is ignored in description scoring", () => {
  const candidate = clone(STANDARD_BANK_EXPECTED_NORMALIZED);
  candidate.transactions[0].description = "Card Purchase Coffee Shop";
  candidate.transactions[1].description = "ACB CREDIT CUSTOMER PAYMENT";
  candidate.transactions[3].description = "Monthly Acc Fee";

  const score = scoreBankStatementAgainstReference({
    candidateCanonical: candidate,
    referenceCanonical: STANDARD_BANK_EXPECTED_NORMALIZED,
    engine: "ai-shadow",
    bankName: "Standard Bank",
  });

  assert.equal(score.fieldAccuracy.transactionDescription.compared, 4);
  assert.equal(score.fieldAccuracy.transactionDescription.matched, 4);
});

test("Batch 13C prefixed Standard Bank reference remains a real description discrepancy", () => {
  const candidate = clone(STANDARD_BANK_EXPECTED_NORMALIZED);
  candidate.transactions[2].description = "EFT PAYMENT SUPPLIER ABC";

  const score = scoreBankStatementAgainstReference({
    candidateCanonical: candidate,
    referenceCanonical: STANDARD_BANK_EXPECTED_NORMALIZED,
    engine: "ai-shadow",
    bankName: "Standard Bank",
  });

  assert.equal(score.fieldAccuracy.transactionDescription.compared, 4);
  assert.equal(score.fieldAccuracy.transactionDescription.matched, 3);
  assert.equal(score.disagreement.byField.description, 1);
});
