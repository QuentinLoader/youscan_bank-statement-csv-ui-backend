/**
 * YouScan V2
 * Batch 15 AI correction-proposal domain model.
 *
 * A proposal is human-review material only. It can contain sensitive customer
 * values because a reviewer must be able to compare deterministic vs AI data,
 * so callers must never write the full object to general application logs.
 * Creating a proposal does not mutate or authorize changes to canonical data.
 */

import crypto from "node:crypto";
import { AI_DECISION_OUTCOMES } from "./decisionPolicy.js";
import { AI_SHADOW_STATUSES, getAiShadowInternalCanonical } from "./runShadowExtraction.js";

export const AI_CORRECTION_PROPOSAL_STATUSES = Object.freeze({
  PENDING_REVIEW: "pending_review",
  PARTIALLY_REVIEWED: "partially_reviewed",
  REVIEWED: "reviewed",
});

export const AI_CORRECTION_ITEM_REVIEW_STATUSES = Object.freeze({
  PENDING: "pending",
  ACCEPT_AI: "accept_ai",
  RETAIN_DETERMINISTIC: "retain_deterministic",
});

const FIELD_RISK = Object.freeze({
  bankName: "critical",
  accountNumber: "critical",
  clientName: "medium",
  statementPeriodStart: "high",
  statementPeriodEnd: "high",
  openingBalance: "critical",
  closingBalance: "critical",
  transactionCount: "critical",
  date: "high",
  description: "medium",
  amount: "critical",
  balance: "critical",
});

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableObject(value[key])])
    );
  }
  return value;
}

export function fingerprintDeterministicCanonical(canonical) {
  const serialized = JSON.stringify(stableObject(canonical || null));
  return crypto.createHash("sha256").update(serialized).digest("hex");
}

function metadataItem(field, deterministicCanonical, aiCanonical) {
  return {
    itemId: `metadata:${field}`,
    scope: "metadata",
    rowIndex: null,
    field,
    risk: FIELD_RISK[field] || "medium",
    currentValue: clone(deterministicCanonical?.[field] ?? null),
    proposedValue: clone(aiCanonical?.[field] ?? null),
    reviewStatus: AI_CORRECTION_ITEM_REVIEW_STATUSES.PENDING,
    review: null,
  };
}

function transactionItem(rowIndex, field, deterministicCanonical, aiCanonical) {
  return {
    itemId: `transaction:${rowIndex}:${field}`,
    scope: "transaction",
    rowIndex,
    field,
    risk: FIELD_RISK[field] || "medium",
    currentValue: clone(deterministicCanonical?.transactions?.[rowIndex]?.[field] ?? null),
    proposedValue: clone(aiCanonical?.transactions?.[rowIndex]?.[field] ?? null),
    reviewStatus: AI_CORRECTION_ITEM_REVIEW_STATUSES.PENDING,
    review: null,
  };
}

function transactionCountItem(deterministicCanonical, aiCanonical) {
  return {
    itemId: "transactions:transactionCount",
    scope: "transactions",
    rowIndex: null,
    field: "transactionCount",
    risk: FIELD_RISK.transactionCount,
    currentValue: Array.isArray(deterministicCanonical?.transactions)
      ? deterministicCanonical.transactions.length
      : 0,
    proposedValue: Array.isArray(aiCanonical?.transactions)
      ? aiCanonical.transactions.length
      : 0,
    reviewStatus: AI_CORRECTION_ITEM_REVIEW_STATUSES.PENDING,
    review: null,
  };
}

function proposalAllowed(aiDecision, shadowAi) {
  if (shadowAi?.status !== AI_SHADOW_STATUSES.DIFFERENCES) return false;
  return [
    AI_DECISION_OUTCOMES.REVIEW_AI_DIFFERENCE,
    AI_DECISION_OUTCOMES.MANUAL_REVIEW_REQUIRED,
  ].includes(aiDecision?.outcome);
}

export function createAiCorrectionProposal({
  shadowAi = null,
  aiDecision = null,
  deterministicCanonical = null,
  createdAt = new Date().toISOString(),
  proposalId = crypto.randomUUID(),
} = {}) {
  if (!proposalAllowed(aiDecision, shadowAi)) return null;
  if (!deterministicCanonical) return null;

  const aiCanonical = getAiShadowInternalCanonical(shadowAi);
  if (!aiCanonical) return null;

  const items = [];

  for (const field of shadowAi.comparison?.metadata?.mismatchFields || []) {
    items.push(metadataItem(field, deterministicCanonical, aiCanonical));
  }

  if (shadowAi.comparison?.transactions?.countMatch === false) {
    items.push(transactionCountItem(deterministicCanonical, aiCanonical));
  }

  for (const row of shadowAi.comparison?.transactions?.mismatchRows || []) {
    for (const field of row.fields || []) {
      items.push(transactionItem(row.rowIndex, field, deterministicCanonical, aiCanonical));
    }
  }

  if (!items.length) return null;

  return {
    proposalId,
    mode: "human_review",
    status: AI_CORRECTION_PROPOSAL_STATUSES.PENDING_REVIEW,
    createdAt,
    containsSensitiveValues: true,
    doNotLogValues: true,
    authoritativeSource: "deterministic",
    deterministicFingerprint: fingerprintDeterministicCanonical(deterministicCanonical),
    decisionOutcome: aiDecision.outcome,
    decisionRisk: aiDecision.risk,
    shadowStatus: shadowAi.status,
    requiresExplicitReview: true,
    aiCanAutoApply: false,
    applicationAuthorized: false,
    applied: false,
    itemCount: items.length,
    reviewedItemCount: 0,
    acceptedAiItemCount: 0,
    retainedDeterministicItemCount: 0,
    items,
  };
}

export function toSafeAiCorrectionProposalSummary(proposal) {
  if (!proposal) return null;
  return {
    proposalId: proposal.proposalId,
    mode: proposal.mode,
    status: proposal.status,
    authoritativeSource: proposal.authoritativeSource,
    decisionOutcome: proposal.decisionOutcome,
    decisionRisk: proposal.decisionRisk,
    requiresExplicitReview: proposal.requiresExplicitReview,
    aiCanAutoApply: false,
    applicationAuthorized: false,
    applied: false,
    itemCount: proposal.itemCount,
    reviewedItemCount: proposal.reviewedItemCount,
    acceptedAiItemCount: proposal.acceptedAiItemCount,
    retainedDeterministicItemCount: proposal.retainedDeterministicItemCount,
    reviewTargets: proposal.items.map((item) => ({
      itemId: item.itemId,
      scope: item.scope,
      rowIndex: item.rowIndex,
      field: item.field,
      risk: item.risk,
      reviewStatus: item.reviewStatus,
    })),
  };
}
