/**
 * YouScan V2
 * Scoring helpers for labelled/reference bank-statement datasets.
 *
 * IMPORTANT: AI-vs-deterministic agreement is not truth. Actual accuracy is
 * measured only when a trusted reference/fixture is supplied.
 */

import { compareAiToDeterministicBankStatement } from "./compareCandidate.js";
import { analyzeShadowDisagreements } from "./disagreementAnalysis.js";

function rate(matched, compared) {
  if (!compared) return null;
  return Math.round((matched / compared) * 10_000) / 10_000;
}

function fieldScore(comparison, section, field) {
  const stats = comparison?.[section]?.fieldStats?.[field];
  return stats
    ? {
        compared: stats.compared,
        matched: stats.matched,
        accuracy: rate(stats.matched, stats.compared),
      }
    : { compared: 0, matched: 0, accuracy: null };
}

export function scoreBankStatementAgainstReference({
  candidateCanonical,
  referenceCanonical,
  engine = "unknown",
  bankName = null,
  ignoreMetadataFields = [],
  ignoreTransactionFields = [],
} = {}) {
  const comparison = compareAiToDeterministicBankStatement({
    aiCanonical: candidateCanonical,
    deterministicCanonical: referenceCanonical,
    ignoreMetadataFields,
    ignoreTransactionFields,
  });
  const disagreement = analyzeShadowDisagreements(comparison);

  if (comparison.status === "not_comparable") {
    return {
      engine,
      bankName,
      comparable: false,
      exactMatch: false,
      accuracy: null,
      signals: null,
      fieldAccuracy: null,
      disagreement,
    };
  }

  return {
    engine,
    bankName,
    comparable: true,
    exactMatch: comparison.exactMatch,
    accuracy: comparison.matchScore,
    signals: comparison.signals,
    fieldAccuracy: {
      bankName: fieldScore(comparison, "metadata", "bankName"),
      accountNumber: fieldScore(comparison, "metadata", "accountNumber"),
      clientName: fieldScore(comparison, "metadata", "clientName"),
      statementPeriodStart: fieldScore(comparison, "metadata", "statementPeriodStart"),
      statementPeriodEnd: fieldScore(comparison, "metadata", "statementPeriodEnd"),
      openingBalance: fieldScore(comparison, "metadata", "openingBalance"),
      closingBalance: fieldScore(comparison, "metadata", "closingBalance"),
      transactionCount: {
        compared: 1,
        matched: comparison.transactions.countMatch ? 1 : 0,
        accuracy: comparison.transactions.countMatch ? 1 : 0,
      },
      transactionDate: fieldScore(comparison, "transactions", "date"),
      transactionDescription: fieldScore(comparison, "transactions", "description"),
      transactionAmount: fieldScore(comparison, "transactions", "amount"),
      transactionBalance: fieldScore(comparison, "transactions", "balance"),
    },
    disagreement,
  };
}
