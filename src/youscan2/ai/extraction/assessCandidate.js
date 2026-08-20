/**
 * YouScan V2
 * Accuracy-first safety assessment for AI bank-statement extraction.
 *
 * Batch 11 never returns an "accepted" disposition. The best possible result
 * is ELIGIBLE_FOR_COMPARISON so a later batch must explicitly compare AI and
 * deterministic parser output before any merge can be considered.
 */

import { validateBankStatement } from "../../plugins/bankStatement/bankStatement.validator.js";
import { validateAiBankStatementExtractionData } from "./bankStatementContract.js";
import { verifyAiExtractionEvidence } from "./evidence.js";
import { projectAiBankStatementCandidate } from "./projectCandidate.js";

export const AI_EXTRACTION_DISPOSITIONS = Object.freeze({
  ELIGIBLE_FOR_COMPARISON: "eligible_for_comparison",
  NEEDS_REVIEW: "needs_review",
  REJECTED: "rejected",
});

function round2(value) {
  return Math.round(value * 100) / 100;
}

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function collectConfidenceIssues(candidate, threshold) {
  const issues = [];
  const fields = [
    ["bankName", candidate?.bankName],
    ["accountNumber", candidate?.accountNumber],
    ["clientName", candidate?.clientName],
    ["statementPeriodStart", candidate?.statementPeriodStart],
    ["statementPeriodEnd", candidate?.statementPeriodEnd],
    ["openingBalance", candidate?.openingBalance],
    ["closingBalance", candidate?.closingBalance],
  ];

  (candidate?.transactions || []).forEach((transaction, index) => {
    fields.push([`transactions[${index}].date`, transaction?.date]);
    fields.push([`transactions[${index}].description`, transaction?.description]);
    fields.push([`transactions[${index}].amount`, transaction?.amount]);
    fields.push([`transactions[${index}].balance`, transaction?.balance]);
  });

  for (const [fieldPath, field] of fields) {
    if (!field || field.value === null) continue;
    if (field.confidence < threshold) {
      issues.push({
        severity: "warning",
        issueType: "low_field_confidence",
        fieldPath,
        confidence: field.confidence,
      });
    }
  }

  return issues;
}

function detectExactDuplicateRows(transactions) {
  const issues = [];
  const seen = new Map();

  transactions.forEach((transaction, rowIndex) => {
    const fingerprint = JSON.stringify([
      transaction.date,
      String(transaction.description || "").trim().toLowerCase(),
      transaction.amount,
      transaction.balance,
    ]);

    if (seen.has(fingerprint)) {
      issues.push({
        severity: "warning",
        issueType: "possible_duplicate_transaction",
        rowIndex,
        duplicateOfRowIndex: seen.get(fingerprint),
      });
    } else {
      seen.set(fingerprint, rowIndex);
    }
  });

  return issues;
}


function parseCanonicalDate(value) {
  const match = String(value || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}

function checkStatementPeriod(canonical) {
  const issues = [];
  const startValue = canonical.statementPeriodStart;
  const endValue = canonical.statementPeriodEnd;
  const start = startValue ? parseCanonicalDate(startValue) : null;
  const end = endValue ? parseCanonicalDate(endValue) : null;

  if (startValue && !start) {
    issues.push({
      severity: "error",
      issueType: "invalid_statement_period_start",
    });
  }

  if (endValue && !end) {
    issues.push({
      severity: "error",
      issueType: "invalid_statement_period_end",
    });
  }

  if (start && end && start > end) {
    issues.push({
      severity: "error",
      issueType: "statement_period_reversed",
    });
  }

  if (start && end) {
    canonical.transactions.forEach((transaction, rowIndex) => {
      const transactionDate = transaction.date
        ? parseCanonicalDate(transaction.date)
        : null;
      if (transactionDate && (transactionDate < start || transactionDate > end)) {
        issues.push({
          severity: "warning",
          issueType: "transaction_outside_statement_period",
          rowIndex,
        });
      }
    });
  }

  return issues;
}

function checkStatementTotalReconciliation(canonical) {
  const { openingBalance, closingBalance, transactions } = canonical;
  if (
    typeof openingBalance !== "number" ||
    !Number.isFinite(openingBalance) ||
    typeof closingBalance !== "number" ||
    !Number.isFinite(closingBalance) ||
    !Array.isArray(transactions) ||
    transactions.some(
      (transaction) =>
        typeof transaction.amount !== "number" || !Number.isFinite(transaction.amount)
    )
  ) {
    return [];
  }

  const amountTotal = round2(
    transactions.reduce((sum, transaction) => sum + transaction.amount, 0)
  );
  const expectedClosingBalance = round2(openingBalance + amountTotal);
  const actualClosingBalance = round2(closingBalance);

  if (expectedClosingBalance === actualClosingBalance) return [];

  return [
    {
      severity: "warning",
      issueType: "statement_total_reconciliation_mismatch",
      expectedClosingBalance,
      actualClosingBalance,
      amountTotal,
    },
  ];
}

export async function assessAiBankStatementExtraction({
  candidate,
  envelopeConfidence,
  sourceText,
  sourceFileName = null,
  expectedBankName = null,
  minEnvelopeConfidence = 0.95,
  minFieldConfidence = 0.95,
} = {}) {
  const contract = validateAiBankStatementExtractionData(candidate);

  if (!contract.valid) {
    return {
      disposition: AI_EXTRACTION_DISPOSITIONS.REJECTED,
      eligibleForComparison: false,
      canonical: null,
      issues: contract.issues.map((message) => ({
        severity: "error",
        issueType: "ai_extraction_contract_error",
        message,
      })),
      summary: {
        errorCount: contract.issues.length,
        warningCount: 0,
      },
    };
  }

  const canonical = projectAiBankStatementCandidate(candidate, { sourceFileName });
  const issues = [];

  if (
    typeof envelopeConfidence !== "number" ||
    !Number.isFinite(envelopeConfidence) ||
    envelopeConfidence < minEnvelopeConfidence
  ) {
    issues.push({
      severity: "warning",
      issueType: "low_envelope_confidence",
      confidence: Number.isFinite(envelopeConfidence) ? envelopeConfidence : null,
      minimumRequired: minEnvelopeConfidence,
    });
  }

  issues.push(...collectConfidenceIssues(candidate, minFieldConfidence));

  const evidence = verifyAiExtractionEvidence(candidate, sourceText);
  issues.push(...evidence.issues);

  if (
    expectedBankName &&
    normalizeName(expectedBankName) !== normalizeName(canonical.bankName)
  ) {
    issues.push({
      severity: "warning",
      issueType: "bank_name_disagreement",
      expectedBankName,
      candidateBankName: canonical.bankName,
    });
  }

  issues.push(...detectExactDuplicateRows(canonical.transactions));
  issues.push(...checkStatementPeriod(canonical));
  issues.push(...checkStatementTotalReconciliation(canonical));

  const deterministicValidation = await validateBankStatement(canonical);
  deterministicValidation.issues.forEach((issue) => {
    issues.push({
      ...issue,
      issueType: `canonical_${issue.issueType}`,
    });
  });

  const errorCount = issues.filter((issue) => issue.severity === "error").length;
  const warningCount = issues.filter((issue) => issue.severity === "warning").length;

  const disposition =
    errorCount > 0
      ? AI_EXTRACTION_DISPOSITIONS.REJECTED
      : warningCount > 0
        ? AI_EXTRACTION_DISPOSITIONS.NEEDS_REVIEW
        : AI_EXTRACTION_DISPOSITIONS.ELIGIBLE_FOR_COMPARISON;

  return {
    disposition,
    eligibleForComparison:
      disposition === AI_EXTRACTION_DISPOSITIONS.ELIGIBLE_FOR_COMPARISON,
    canonical,
    issues,
    evidence: {
      checkedFieldCount: evidence.checkedFieldCount,
      verifiedFieldCount: evidence.verifiedFieldCount,
      valid: evidence.valid,
    },
    validation: {
      status: deterministicValidation.status,
      score: deterministicValidation.score,
      valid: deterministicValidation.valid,
    },
    summary: {
      errorCount,
      warningCount,
      transactionCount: canonical.transactions.length,
    },
  };
}
