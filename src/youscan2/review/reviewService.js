/**
 * YouScan V2
 * Persistent human-review application service.
 *
 * Batch 16 persists proposals and decisions but still has no apply/merge path.
 */

import crypto from "node:crypto";
import {
  AI_CORRECTION_ITEM_REVIEW_STATUSES,
  fingerprintDeterministicCanonical,
} from "../ai/extraction/correctionProposal.js";
import { reviewAiCorrectionProposal } from "../ai/extraction/reviewCorrectionProposal.js";
import { asReviewError, reviewError } from "./errors.js";
import { reviewPayloadAad } from "./crypto.js";
import { buildSafeAuditMetadata, buildSafeReviewCaseSummary } from "./safeSummary.js";

function requireId(value, code, message) {
  const normalized = String(value || "").trim();
  if (!normalized) throw reviewError(code, message, { status: 400 });
  return normalized;
}

function ensurePersistableProposal(proposal, deterministicCanonical) {
  if (!proposal || proposal.mode !== "human_review") {
    throw reviewError(
      "V2_REVIEW_PROPOSAL_REQUIRED",
      "A human-review AI correction proposal is required",
      { status: 400 }
    );
  }
  if (!deterministicCanonical) {
    throw reviewError(
      "V2_REVIEW_CANONICAL_REQUIRED",
      "Deterministic canonical data is required",
      { status: 400 }
    );
  }
  if (
    proposal.aiCanAutoApply !== false ||
    proposal.applicationAuthorized !== false ||
    proposal.applied !== false
  ) {
    throw reviewError(
      "V2_REVIEW_UNSAFE_PROPOSAL",
      "Only non-applicable human-review proposals may be persisted",
      { status: 400 }
    );
  }

  const fingerprint = fingerprintDeterministicCanonical(deterministicCanonical);
  if (proposal.deterministicFingerprint !== fingerprint) {
    throw reviewError(
      "V2_REVIEW_PROPOSAL_STALE",
      "The proposal does not match the deterministic result being persisted",
      { status: 409 }
    );
  }
}

function publicRecord(record) {
  return structuredClone(record.safeSummary);
}

function sanitizeLimit(value, fallback = 50) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, 100);
}

function sanitizeOffset(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

export function createReviewService({ repository, reviewCrypto, now = () => new Date().toISOString(), idFactory = () => crypto.randomUUID() }) {
  if (!repository) throw new Error("REVIEW_REPOSITORY_REQUIRED");
  if (!reviewCrypto) throw new Error("REVIEW_CRYPTO_REQUIRED");

  function decryptRecord(record) {
    return reviewCrypto.decryptJson(record.encryptedPayload, {
      aad: reviewPayloadAad({ caseId: record.caseId, userId: record.userId }),
    });
  }

  function encryptedPayload(recordIdentity, payload) {
    return reviewCrypto.encryptJson(payload, {
      aad: reviewPayloadAad(recordIdentity),
    });
  }

  return Object.freeze({
    async createCaseFromParseResult({ userId, parseResult }) {
      const normalizedUserId = requireId(
        userId,
        "V2_REVIEW_USER_REQUIRED",
        "Authenticated user identifier is required"
      );
      const proposal = parseResult?.aiCorrectionProposal;
      const deterministicCanonical = parseResult?.result?.data;
      ensurePersistableProposal(proposal, deterministicCanonical);

      const caseId = idFactory();
      const createdAt = now();
      const parseJobId = parseResult?.jobId || null;
      const version = 1;
      const safeSummary = buildSafeReviewCaseSummary({
        caseId,
        parseJobId,
        proposal,
        createdAt,
        updatedAt: createdAt,
        version,
      });

      const record = {
        caseId,
        userId: normalizedUserId,
        parseJobId,
        status: proposal.status,
        decisionRisk: proposal.decisionRisk || null,
        decisionOutcome: proposal.decisionOutcome || null,
        deterministicFingerprint: proposal.deterministicFingerprint,
        safeSummary,
        encryptedPayload: encryptedPayload(
          { caseId, userId: normalizedUserId },
          { proposal, deterministicCanonical }
        ),
        version,
        createdAt,
        updatedAt: createdAt,
      };

      const auditEvent = {
        eventId: idFactory(),
        caseId,
        actorUserId: normalizedUserId,
        eventType: "review_case_created",
        safeMetadata: buildSafeAuditMetadata({ proposal }),
        createdAt,
      };

      const saved = await repository.createCase({ record, auditEvent });
      return publicRecord(saved);
    },

    async listCases({ userId, status = null, limit = 50, offset = 0 }) {
      const normalizedUserId = requireId(userId, "V2_REVIEW_USER_REQUIRED", "Authenticated user identifier is required");
      const records = await repository.listCases({
        userId: normalizedUserId,
        status: status ? String(status) : null,
        limit: sanitizeLimit(limit),
        offset: sanitizeOffset(offset),
      });
      return records.map(publicRecord);
    },

    async getCase({ userId, caseId }) {
      const normalizedUserId = requireId(userId, "V2_REVIEW_USER_REQUIRED", "Authenticated user identifier is required");
      const normalizedCaseId = requireId(caseId, "V2_REVIEW_CASE_ID_REQUIRED", "Review case identifier is required");
      const record = await repository.getCase({ caseId: normalizedCaseId, userId: normalizedUserId });
      if (!record) {
        throw reviewError("V2_REVIEW_CASE_NOT_FOUND", "Review case not found", { status: 404 });
      }
      const payload = decryptRecord(record);
      return {
        ...publicRecord(record),
        proposal: structuredClone(payload.proposal),
      };
    },

    async reviewCase({ userId, caseId, decisions }) {
      const normalizedUserId = requireId(userId, "V2_REVIEW_USER_REQUIRED", "Authenticated user identifier is required");
      const normalizedCaseId = requireId(caseId, "V2_REVIEW_CASE_ID_REQUIRED", "Review case identifier is required");
      const record = await repository.getCase({ caseId: normalizedCaseId, userId: normalizedUserId });
      if (!record) {
        throw reviewError("V2_REVIEW_CASE_NOT_FOUND", "Review case not found", { status: 404 });
      }

      const payload = decryptRecord(record);
      const proposal = payload?.proposal;
      const deterministicCanonical = payload?.deterministicCanonical;

      for (const decision of Array.isArray(decisions) ? decisions : []) {
        const item = proposal?.items?.find((candidate) => candidate.itemId === decision?.itemId);
        if (item && item.reviewStatus !== AI_CORRECTION_ITEM_REVIEW_STATUSES.PENDING) {
          throw reviewError(
            "V2_REVIEW_ITEM_ALREADY_DECIDED",
            `Proposal item has already been reviewed: ${item.itemId}`,
            { status: 409 }
          );
        }
      }

      let reviewed;
      try {
        reviewed = reviewAiCorrectionProposal({
          proposal,
          currentDeterministicCanonical: deterministicCanonical,
          reviewerId: normalizedUserId,
          decisions,
          reviewedAt: now(),
        });
      } catch (error) {
        throw asReviewError(error);
      }

      const updatedAt = now();
      const nextVersion = record.version + 1;
      const safeSummary = buildSafeReviewCaseSummary({
        caseId: record.caseId,
        parseJobId: record.parseJobId,
        proposal: reviewed,
        createdAt: record.createdAt,
        updatedAt,
        version: nextVersion,
      });

      const updatedRecord = {
        ...record,
        status: reviewed.status,
        safeSummary,
        encryptedPayload: encryptedPayload(
          { caseId: record.caseId, userId: record.userId },
          { proposal: reviewed, deterministicCanonical }
        ),
        version: nextVersion,
        updatedAt,
      };

      const auditEvent = {
        eventId: idFactory(),
        caseId: record.caseId,
        actorUserId: normalizedUserId,
        eventType: "review_decisions_recorded",
        safeMetadata: buildSafeAuditMetadata({
          decisions,
          previousStatus: proposal.status,
          nextStatus: reviewed.status,
        }),
        createdAt: updatedAt,
      };

      const saved = await repository.updateCase({
        caseId: record.caseId,
        userId: normalizedUserId,
        expectedVersion: record.version,
        record: updatedRecord,
        auditEvent,
      });
      if (!saved) {
        throw reviewError("V2_REVIEW_CASE_NOT_FOUND", "Review case not found", { status: 404 });
      }

      return {
        ...publicRecord(saved),
        proposal: structuredClone(reviewed),
      };
    },

    async listAudit({ userId, caseId }) {
      const normalizedUserId = requireId(userId, "V2_REVIEW_USER_REQUIRED", "Authenticated user identifier is required");
      const normalizedCaseId = requireId(caseId, "V2_REVIEW_CASE_ID_REQUIRED", "Review case identifier is required");
      const events = await repository.listAudit({ caseId: normalizedCaseId, userId: normalizedUserId });
      if (!events) {
        throw reviewError("V2_REVIEW_CASE_NOT_FOUND", "Review case not found", { status: 404 });
      }
      return structuredClone(events);
    },

    // Internal service hook for a future canonical-edit workflow. It is
    // intentionally not exposed as an HTTP endpoint in Batch 16.
    async refreshDeterministicSnapshot({ userId, caseId, deterministicCanonical }) {
      const normalizedUserId = requireId(userId, "V2_REVIEW_USER_REQUIRED", "Authenticated user identifier is required");
      const normalizedCaseId = requireId(caseId, "V2_REVIEW_CASE_ID_REQUIRED", "Review case identifier is required");
      const record = await repository.getCase({ caseId: normalizedCaseId, userId: normalizedUserId });
      if (!record) {
        throw reviewError("V2_REVIEW_CASE_NOT_FOUND", "Review case not found", { status: 404 });
      }
      const payload = decryptRecord(record);
      const updatedAt = now();
      const nextVersion = record.version + 1;
      const fingerprint = fingerprintDeterministicCanonical(deterministicCanonical);
      const updatedRecord = {
        ...record,
        deterministicFingerprint: fingerprint,
        encryptedPayload: encryptedPayload(
          { caseId: record.caseId, userId: record.userId },
          { proposal: payload.proposal, deterministicCanonical }
        ),
        version: nextVersion,
        updatedAt,
        safeSummary: {
          ...record.safeSummary,
          version: nextVersion,
          updatedAt,
        },
      };
      const auditEvent = {
        eventId: idFactory(),
        caseId: record.caseId,
        actorUserId: normalizedUserId,
        eventType: "deterministic_snapshot_refreshed",
        safeMetadata: { fingerprintChanged: fingerprint !== record.deterministicFingerprint },
        createdAt: updatedAt,
      };
      const saved = await repository.replaceCaseForCanonicalRefresh({
        caseId: record.caseId,
        userId: normalizedUserId,
        expectedVersion: record.version,
        record: updatedRecord,
        auditEvent,
      });
      return publicRecord(saved);
    },
  });
}
