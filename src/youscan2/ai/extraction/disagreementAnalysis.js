/**
 * YouScan V2
 * Privacy-safe disagreement taxonomy for AI shadow comparisons.
 *
 * This module only consumes field names/counts from compareCandidate.js and
 * never needs or returns customer values.
 */

export const AI_DISAGREEMENT_SEVERITIES = Object.freeze({
  CRITICAL: "critical",
  HIGH: "high",
  MEDIUM: "medium",
});

export const AI_DISAGREEMENT_CATEGORIES = Object.freeze({
  IDENTITY: "identity",
  PERIOD: "period",
  BALANCES: "balances",
  TRANSACTION_COUNT: "transaction_count",
  TRANSACTION_DATE: "transaction_date",
  TRANSACTION_DESCRIPTION: "transaction_description",
  TRANSACTION_AMOUNT: "transaction_amount",
  TRANSACTION_BALANCE: "transaction_balance",
});

const METADATA_RULES = Object.freeze({
  bankName: {
    category: AI_DISAGREEMENT_CATEGORIES.IDENTITY,
    severity: AI_DISAGREEMENT_SEVERITIES.CRITICAL,
  },
  accountNumber: {
    category: AI_DISAGREEMENT_CATEGORIES.IDENTITY,
    severity: AI_DISAGREEMENT_SEVERITIES.CRITICAL,
  },
  clientName: {
    category: AI_DISAGREEMENT_CATEGORIES.IDENTITY,
    severity: AI_DISAGREEMENT_SEVERITIES.MEDIUM,
  },
  statementPeriodStart: {
    category: AI_DISAGREEMENT_CATEGORIES.PERIOD,
    severity: AI_DISAGREEMENT_SEVERITIES.HIGH,
  },
  statementPeriodEnd: {
    category: AI_DISAGREEMENT_CATEGORIES.PERIOD,
    severity: AI_DISAGREEMENT_SEVERITIES.HIGH,
  },
  openingBalance: {
    category: AI_DISAGREEMENT_CATEGORIES.BALANCES,
    severity: AI_DISAGREEMENT_SEVERITIES.CRITICAL,
  },
  closingBalance: {
    category: AI_DISAGREEMENT_CATEGORIES.BALANCES,
    severity: AI_DISAGREEMENT_SEVERITIES.CRITICAL,
  },
});

const TRANSACTION_RULES = Object.freeze({
  date: {
    category: AI_DISAGREEMENT_CATEGORIES.TRANSACTION_DATE,
    severity: AI_DISAGREEMENT_SEVERITIES.HIGH,
  },
  description: {
    category: AI_DISAGREEMENT_CATEGORIES.TRANSACTION_DESCRIPTION,
    severity: AI_DISAGREEMENT_SEVERITIES.MEDIUM,
  },
  amount: {
    category: AI_DISAGREEMENT_CATEGORIES.TRANSACTION_AMOUNT,
    severity: AI_DISAGREEMENT_SEVERITIES.CRITICAL,
  },
  balance: {
    category: AI_DISAGREEMENT_CATEGORIES.TRANSACTION_BALANCE,
    severity: AI_DISAGREEMENT_SEVERITIES.CRITICAL,
  },
});

function increment(target, key, amount = 1) {
  target[key] = (target[key] || 0) + amount;
}

export function analyzeShadowDisagreements(comparison) {
  const byCategory = {};
  const bySeverity = {};
  const byField = {};
  const affectedRows = new Set();
  let issueCount = 0;

  if (!comparison || comparison.status === "not_comparable") {
    return {
      issueCount: 0,
      affectedTransactionRowCount: 0,
      byCategory,
      bySeverity,
      byField,
    };
  }

  for (const field of comparison.metadata?.mismatchFields || []) {
    const rule = METADATA_RULES[field];
    if (!rule) continue;
    issueCount += 1;
    increment(byCategory, rule.category);
    increment(bySeverity, rule.severity);
    increment(byField, field);
  }

  if (comparison.transactions?.countMatch === false) {
    issueCount += 1;
    increment(byCategory, AI_DISAGREEMENT_CATEGORIES.TRANSACTION_COUNT);
    increment(bySeverity, AI_DISAGREEMENT_SEVERITIES.CRITICAL);
    increment(byField, "transactionCount");
  }

  for (const row of comparison.transactions?.mismatchRows || []) {
    affectedRows.add(row.rowIndex);
    for (const field of row.fields || []) {
      const rule = TRANSACTION_RULES[field];
      if (!rule) continue;
      issueCount += 1;
      increment(byCategory, rule.category);
      increment(bySeverity, rule.severity);
      increment(byField, field);
    }
  }

  return {
    issueCount,
    affectedTransactionRowCount: affectedRows.size,
    byCategory,
    bySeverity,
    byField,
  };
}
