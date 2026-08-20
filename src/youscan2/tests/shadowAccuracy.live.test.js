import assert from "node:assert/strict";
import test from "node:test";

import { getAiConfig } from "../ai/config.js";
import {
  aggregateBankStatementAccuracy,
  aiBankStatementExtractor,
  assessAiBankStatementExtraction,
  scoreBankStatementAgainstReference,
} from "../ai/extraction/index.js";
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

const liveEnabled =
  String(process.env.YOUSCAN_V2_AI_ACCURACY_LIVE_TEST || "").toLowerCase() ===
  "true";
const liveTest = liveEnabled ? test : test.skip;


const SOURCE_OBSERVABILITY = Object.freeze({
  // The synthetic Discovery source prints transaction amounts but not a
  // per-row running balance. The deterministic parser legitimately derives
  // balances, while the AI extraction policy deliberately forbids deriving
  // unprinted balances. Exclude that non-observable field from labelled AI
  // extraction accuracy rather than penalising source-faithful nulls.
  "Discovery Bank": Object.freeze({ ignoreTransactionFields: ["balance"] }),
});

const CASES = [
  ["ABSA", "synthetic-absa.pdf", ABSA_STATEMENT_FIXTURE_TEXT, ABSA_EXPECTED_NORMALIZED],
  [
    "Standard Bank",
    "synthetic-standard-bank.pdf",
    STANDARD_BANK_STATEMENT_FIXTURE_TEXT,
    STANDARD_BANK_EXPECTED_NORMALIZED,
  ],
  ["FNB", "synthetic-fnb.pdf", FNB_STATEMENT_FIXTURE_TEXT, FNB_EXPECTED_NORMALIZED],
  [
    "Capitec",
    "synthetic-capitec.pdf",
    CAPITEC_STATEMENT_FIXTURE_TEXT,
    CAPITEC_EXPECTED_NORMALIZED,
  ],
  [
    "Nedbank",
    "synthetic-nedbank.pdf",
    NEDBANK_STATEMENT_FIXTURE_TEXT,
    NEDBANK_EXPECTED_NORMALIZED,
  ],
  [
    "Discovery Bank",
    "synthetic-discovery.pdf",
    DISCOVERY_STATEMENT_FIXTURE_TEXT,
    DISCOVERY_EXPECTED_NORMALIZED,
  ],
];

liveTest("Batch 13 optional live OpenAI cross-bank labelled accuracy test", async () => {
  const config = getAiConfig();
  assert.equal(config.enabled, true);
  assert.equal(config.extractionEnabled, true);

  const scores = [];

  for (const [bankName, sourceFileName, text, expected] of CASES) {
    const aiResult = await aiBankStatementExtractor({
      extractedText: text,
      config,
    });

    const assessment = await assessAiBankStatementExtraction({
      candidate: aiResult.data,
      envelopeConfidence: aiResult.confidence,
      sourceText: text,
      sourceFileName,
      expectedBankName: bankName,
      minEnvelopeConfidence: config.extractionMinConfidence,
      minFieldConfidence: config.extractionFieldMinConfidence,
    });

    assert.ok(assessment.canonical, `${bankName}: AI candidate was not projectable`);

    scores.push(
      scoreBankStatementAgainstReference({
        candidateCanonical: assessment.canonical,
        referenceCanonical: expected,
        engine: "openai-shadow",
        bankName,
        ...(SOURCE_OBSERVABILITY[bankName] || {}),
      })
    );
  }

  const report = aggregateBankStatementAccuracy(scores);

  // Always print privacy-safe diagnostics BEFORE the accuracy assertions. This
  // ensures a failed live gate identifies the bank/field category that missed
  // without exposing any names, account numbers, descriptions or money values.
  const bankDiagnostics = scores.map((score) => ({
    bankName: score.bankName,
    comparable: score.comparable,
    exactMatch: score.exactMatch,
    accuracy: score.accuracy,
    fieldAccuracy: score.fieldAccuracy,
    disagreement: score.disagreement,
  }));

  console.log(
    "B13B_PRIVACY_SAFE_BANK_DIAGNOSTICS",
    JSON.stringify(bankDiagnostics)
  );
  console.log("B13B_PRIVACY_SAFE_ACCURACY_REPORT", JSON.stringify(report));

  // Accuracy gate for synthetic labelled fixtures. Critical monetary/count
  // fields must be exact even if harmless description formatting differs.
  assert.equal(report.sampleCount, 6);
  assert.equal(report.comparableSampleCount, 6);
  assert.equal(report.fieldAccuracy.transactionCount.accuracy, 1);
  assert.equal(report.fieldAccuracy.transactionAmount.accuracy, 1);
  assert.equal(report.fieldAccuracy.transactionBalance.accuracy, 1);
  assert.equal(report.fieldAccuracy.openingBalance.accuracy, 1);
  assert.equal(report.fieldAccuracy.closingBalance.accuracy, 1);
  assert.ok(
    report.signals.accuracy >= 0.98,
    `Overall labelled accuracy ${report.signals.accuracy} is below 0.98; inspect B13B_PRIVACY_SAFE_BANK_DIAGNOSTICS above.`
  );
});
