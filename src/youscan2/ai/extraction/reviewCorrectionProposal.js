/**
 * YouScan V2
 * Batch 15 explicit human review of AI correction proposals.
 *
 * Reviewing a proposal records a human decision only. There is deliberately no
 * apply/merge function in Batch 15, and applicationAuthorized remains false.
 */

import {
  AI_CORRECTION_ITEM_REVIEW_STATUSES,
  AI_CORRECTION_PROPOSAL_STATUSES,
  fingerprintDeterministicCanonical,
} from "./correctionProposal.js";

export const AI_CORRECTION_REVIEW_ACTIONS = Object.freeze({
  ACCEPT_AI: AI_CORRECTION_ITEM_REVIEW_STATUSES.ACCEPT_AI,
  RETAIN_DETERMINISTIC: AI_CORRECTION_ITEM_REVIEW_STATUSES.RETAIN_DETERMINISTIC,
});

function proposalError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function requireReviewerId(reviewerId) {
  const normalized = String(reviewerId || "").trim();
  if (!normalized) {
    throw proposalError(
      "V2_AI_PROPOSAL_REVIEWER_REQUIRED",
      "A reviewer identifier is required"
    );
  }
  return normalized;
}

function normalizeDecisions(decisions, knownItemIds) {
  if (!Array.isArray(decisions) || decisions.length === 0) {
    throw proposalError(
      "V2_AI_PROPOSAL_DECISIONS_REQUIRED",
      "At least one proposal-item review decision is required"
    );
  }

  const normalized = new Map();
  for (const decision of decisions) {
    const itemId = String(decision?.itemId || "").trim();
    const action = decision?.action;

    if (!knownItemIds.has(itemId)) {
      throw proposalError(
        "V2_AI_PROPOSAL_ITEM_UNKNOWN",
        `Unknown proposal item: ${itemId || "(empty)"}`
      );
    }

    if (normalized.has(itemId)) {
      throw proposalError(
        "V2_AI_PROPOSAL_DUPLICATE_DECISION",
        `Duplicate review decision for item: ${itemId}`
      );
    }

    if (!Object.values(AI_CORRECTION_REVIEW_ACTIONS).includes(action)) {
      throw proposalError(
        "V2_AI_PROPOSAL_ACTION_INVALID",
        `Invalid review action for item: ${itemId}`
      );
    }

    normalized.set(itemId, action);
  }

  return normalized;
}

function summarize(items) {
  const reviewedItemCount = items.filter(
    (item) => item.reviewStatus !== AI_CORRECTION_ITEM_REVIEW_STATUSES.PENDING
  ).length;
  const acceptedAiItemCount = items.filter(
    (item) => item.reviewStatus === AI_CORRECTION_ITEM_REVIEW_STATUSES.ACCEPT_AI
  ).length;
  const retainedDeterministicItemCount = items.filter(
    (item) =>
      item.reviewStatus === AI_CORRECTION_ITEM_REVIEW_STATUSES.RETAIN_DETERMINISTIC
  ).length;

  return {
    reviewedItemCount,
    acceptedAiItemCount,
    retainedDeterministicItemCount,
    status:
      reviewedItemCount === 0
        ? AI_CORRECTION_PROPOSAL_STATUSES.PENDING_REVIEW
        : reviewedItemCount === items.length
          ? AI_CORRECTION_PROPOSAL_STATUSES.REVIEWED
          : AI_CORRECTION_PROPOSAL_STATUSES.PARTIALLY_REVIEWED,
  };
}

export function reviewAiCorrectionProposal({
  proposal,
  currentDeterministicCanonical,
  reviewerId,
  decisions,
  reviewedAt = new Date().toISOString(),
} = {}) {
  if (!proposal || proposal.mode !== "human_review") {
    throw proposalError(
      "V2_AI_PROPOSAL_INVALID",
      "A valid AI correction proposal is required"
    );
  }

  if (!currentDeterministicCanonical) {
    throw proposalError(
      "V2_AI_PROPOSAL_CURRENT_RESULT_REQUIRED",
      "Current deterministic canonical data is required for stale-checking"
    );
  }

  const currentFingerprint = fingerprintDeterministicCanonical(
    currentDeterministicCanonical
  );
  if (currentFingerprint !== proposal.deterministicFingerprint) {
    throw proposalError(
      "V2_AI_PROPOSAL_STALE",
      "The deterministic result changed after this AI proposal was created"
    );
  }

  const normalizedReviewerId = requireReviewerId(reviewerId);
  const knownItemIds = new Set((proposal.items || []).map((item) => item.itemId));
  const normalizedDecisions = normalizeDecisions(decisions, knownItemIds);

  const items = (proposal.items || []).map((item) => {
    const action = normalizedDecisions.get(item.itemId);
    if (!action) return structuredClone(item);

    return {
      ...structuredClone(item),
      reviewStatus: action,
      review: {
        reviewerId: normalizedReviewerId,
        reviewedAt,
        action,
      },
    };
  });

  const summary = summarize(items);

  return {
    ...structuredClone(proposal),
    status: summary.status,
    reviewedAt,
    authoritativeSource: "deterministic",
    aiCanAutoApply: false,
    applicationAuthorized: false,
    applied: false,
    reviewedItemCount: summary.reviewedItemCount,
    acceptedAiItemCount: summary.acceptedAiItemCount,
    retainedDeterministicItemCount: summary.retainedDeterministicItemCount,
    items,
  };
}
