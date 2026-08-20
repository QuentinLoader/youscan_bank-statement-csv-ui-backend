/**
 * YouScan V2
 * Privacy-safe projections for persistent review cases and audit responses.
 */

import { toSafeAiCorrectionProposalSummary } from "../ai/extraction/correctionProposal.js";

function cloneObject(value) {
  return value && typeof value === "object" ? structuredClone(value) : value;
}

export function buildSafeReviewCaseSummary({
  caseId,
  parseJobId = null,
  proposal,
  createdAt,
  updatedAt,
  version = 1,
}) {
  const proposalSummary = toSafeAiCorrectionProposalSummary(proposal);
  return {
    caseId,
    parseJobId,
    status: proposalSummary?.status || null,
    decisionOutcome: proposalSummary?.decisionOutcome || null,
    decisionRisk: proposalSummary?.decisionRisk || null,
    authoritativeSource: "deterministic",
    aiCanAutoApply: false,
    applicationAuthorized: false,
    applied: false,
    itemCount: proposalSummary?.itemCount || 0,
    reviewedItemCount: proposalSummary?.reviewedItemCount || 0,
    acceptedAiItemCount: proposalSummary?.acceptedAiItemCount || 0,
    retainedDeterministicItemCount:
      proposalSummary?.retainedDeterministicItemCount || 0,
    reviewTargets: cloneObject(proposalSummary?.reviewTargets || []),
    createdAt,
    updatedAt,
    version,
  };
}

export function buildSafeAuditMetadata({
  proposal = null,
  decisions = null,
  previousStatus = null,
  nextStatus = null,
} = {}) {
  const metadata = {};

  if (proposal) {
    metadata.proposalId = proposal.proposalId || null;
    metadata.itemCount = proposal.itemCount || 0;
    metadata.decisionRisk = proposal.decisionRisk || null;
    metadata.decisionOutcome = proposal.decisionOutcome || null;
  }

  if (Array.isArray(decisions)) {
    metadata.decisionCount = decisions.length;
    metadata.decisions = decisions.map((decision) => ({
      itemId: String(decision?.itemId || ""),
      action: decision?.action || null,
    }));
  }

  if (previousStatus !== null) metadata.previousStatus = previousStatus;
  if (nextStatus !== null) metadata.nextStatus = nextStatus;

  return metadata;
}
