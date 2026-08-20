/**
 * YouScan V2
 * Batch 14 advisory AI decision policy.
 *
 * Accuracy rule: AI can confirm, flag, or recommend review, but it cannot
 * change deterministic values, parse status, or perform an automatic merge.
 * Returned data is privacy-safe: field names and row indexes only.
 */

import { AI_SHADOW_STATUSES } from "./runShadowExtraction.js";

export const AI_DECISION_OUTCOMES = Object.freeze({
  DETERMINISTIC_CONFIRMED: "deterministic_confirmed",
  DETERMINISTIC_RETAINED: "deterministic_retained",
  REVIEW_AI_DIFFERENCE: "review_ai_difference",
  MANUAL_REVIEW_REQUIRED: "manual_review_required",
  NOT_AVAILABLE: "not_available",
});

export const AI_DECISION_RISK_LEVELS = Object.freeze({
  NONE: "none",
  MEDIUM: "medium",
  HIGH: "high",
  CRITICAL: "critical",
});

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function safeDeterministicSummary(status, issues = []) {
  return {
    status: status || null,
    issueCount: Array.isArray(issues) ? issues.length : 0,
    issueTypes: unique(
      (Array.isArray(issues) ? issues : []).map((issue) => issue?.issueType)
    ),
    affectedTransactionRows: unique(
      (Array.isArray(issues) ? issues : [])
        .map((issue) => issue?.rowIndex)
        .filter((rowIndex) => Number.isInteger(rowIndex))
    ).sort((a, b) => a - b),
  };
}

function safeReviewTargets(comparison) {
  if (!comparison) {
    return {
      metadataFields: [],
      transactionCountMismatch: false,
      transactionRows: [],
    };
  }

  return {
    metadataFields: [...(comparison.metadata?.mismatchFields || [])],
    transactionCountMismatch: comparison.transactions?.countMatch === false,
    transactionRows: (comparison.transactions?.mismatchRows || []).map((row) => ({
      rowIndex: row.rowIndex,
      fields: [...(row.fields || [])],
    })),
  };
}

function riskFromDisagreement(disagreement) {
  const bySeverity = disagreement?.bySeverity || {};
  if ((bySeverity.critical || 0) > 0) return AI_DECISION_RISK_LEVELS.CRITICAL;
  if ((bySeverity.high || 0) > 0) return AI_DECISION_RISK_LEVELS.HIGH;
  if ((bySeverity.medium || 0) > 0) return AI_DECISION_RISK_LEVELS.MEDIUM;
  return AI_DECISION_RISK_LEVELS.NONE;
}

function makeDecision({
  outcome,
  risk,
  reasonCodes,
  shadowAi,
  deterministicStatus,
  deterministicIssues,
}) {
  return {
    mode: "advisory",
    authoritativeSource: "deterministic",
    aiCanAutoCorrect: false,
    aiCanChangeParseStatus: false,
    outcome,
    risk,
    reasonCodes: unique(reasonCodes),
    deterministic: safeDeterministicSummary(
      deterministicStatus,
      deterministicIssues
    ),
    shadowStatus: shadowAi?.status || null,
    reviewTargets: safeReviewTargets(shadowAi?.comparison),
    disagreement: shadowAi?.disagreement
      ? {
          issueCount: shadowAi.disagreement.issueCount || 0,
          affectedTransactionRowCount:
            shadowAi.disagreement.affectedTransactionRowCount || 0,
          byCategory: { ...(shadowAi.disagreement.byCategory || {}) },
          bySeverity: { ...(shadowAi.disagreement.bySeverity || {}) },
          byField: { ...(shadowAi.disagreement.byField || {}) },
        }
      : null,
  };
}

/**
 * Build an advisory decision from a completed deterministic parse + shadow AI.
 *
 * This function intentionally has no access to the AI candidate values. It can
 * therefore never merge or overwrite them by design.
 */
export function evaluateAiDecisionPolicy({
  shadowAi = null,
  deterministicStatus = null,
  deterministicIssues = [],
} = {}) {
  const deterministicNeedsReview = deterministicStatus === "needs_review";
  const deterministicFailed = deterministicStatus === "failed";

  if (!shadowAi) {
    return makeDecision({
      outcome: AI_DECISION_OUTCOMES.NOT_AVAILABLE,
      risk: deterministicFailed
        ? AI_DECISION_RISK_LEVELS.CRITICAL
        : deterministicNeedsReview
          ? AI_DECISION_RISK_LEVELS.HIGH
          : AI_DECISION_RISK_LEVELS.NONE,
      reasonCodes: ["shadow_ai_not_available"],
      shadowAi,
      deterministicStatus,
      deterministicIssues,
    });
  }

  // AI agreement never clears an existing deterministic validation problem.
  if (deterministicFailed || deterministicNeedsReview) {
    return makeDecision({
      outcome: AI_DECISION_OUTCOMES.MANUAL_REVIEW_REQUIRED,
      risk: deterministicFailed
        ? AI_DECISION_RISK_LEVELS.CRITICAL
        : AI_DECISION_RISK_LEVELS.HIGH,
      reasonCodes: [
        deterministicFailed
          ? "deterministic_parse_failed"
          : "deterministic_requires_review",
        shadowAi.status === AI_SHADOW_STATUSES.EXACT_MATCH
          ? "ai_agreement_does_not_clear_validation"
          : null,
      ],
      shadowAi,
      deterministicStatus,
      deterministicIssues,
    });
  }

  if (shadowAi.status === AI_SHADOW_STATUSES.EXACT_MATCH) {
    return makeDecision({
      outcome: AI_DECISION_OUTCOMES.DETERMINISTIC_CONFIRMED,
      risk: AI_DECISION_RISK_LEVELS.NONE,
      reasonCodes: ["ai_exactly_matches_deterministic"],
      shadowAi,
      deterministicStatus,
      deterministicIssues,
    });
  }

  if (shadowAi.status === AI_SHADOW_STATUSES.DIFFERENCES) {
    const risk = riskFromDisagreement(shadowAi.disagreement);

    if (
      risk === AI_DECISION_RISK_LEVELS.CRITICAL ||
      risk === AI_DECISION_RISK_LEVELS.HIGH
    ) {
      return makeDecision({
        outcome: AI_DECISION_OUTCOMES.MANUAL_REVIEW_REQUIRED,
        risk,
        reasonCodes: [
          risk === AI_DECISION_RISK_LEVELS.CRITICAL
            ? "critical_ai_deterministic_disagreement"
            : "high_ai_deterministic_disagreement",
        ],
        shadowAi,
        deterministicStatus,
        deterministicIssues,
      });
    }

    return makeDecision({
      outcome: AI_DECISION_OUTCOMES.REVIEW_AI_DIFFERENCE,
      risk: risk === AI_DECISION_RISK_LEVELS.NONE
        ? AI_DECISION_RISK_LEVELS.MEDIUM
        : risk,
      reasonCodes: ["noncritical_ai_deterministic_difference"],
      shadowAi,
      deterministicStatus,
      deterministicIssues,
    });
  }

  return makeDecision({
    outcome: AI_DECISION_OUTCOMES.DETERMINISTIC_RETAINED,
    risk: AI_DECISION_RISK_LEVELS.NONE,
    reasonCodes: [
      shadowAi.status === AI_SHADOW_STATUSES.NEEDS_REVIEW
        ? "ai_candidate_requires_review"
        : shadowAi.status === AI_SHADOW_STATUSES.REJECTED
          ? "ai_candidate_rejected"
          : shadowAi.status === AI_SHADOW_STATUSES.UNAVAILABLE
            ? "ai_unavailable"
            : shadowAi.status === AI_SHADOW_STATUSES.DISABLED
              ? "ai_disabled"
              : "ai_not_actionable",
    ],
    shadowAi,
    deterministicStatus,
    deterministicIssues,
  });
}
