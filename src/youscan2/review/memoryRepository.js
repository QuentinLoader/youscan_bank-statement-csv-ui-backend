/**
 * YouScan V2
 * In-memory review repository for deterministic tests and local composition.
 */

import { reviewError } from "./errors.js";

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

export function createMemoryReviewRepository() {
  const cases = new Map();
  const audit = new Map();

  function appendAudit(event) {
    if (!event) return;
    const existing = audit.get(event.caseId) || [];
    existing.push(clone(event));
    audit.set(event.caseId, existing);
  }

  return {
    async createCase({ record, auditEvent }) {
      if (cases.has(record.caseId)) {
        throw reviewError(
          "V2_REVIEW_CASE_EXISTS",
          "Review case already exists",
          { status: 409 }
        );
      }
      cases.set(record.caseId, clone(record));
      appendAudit(auditEvent);
      return clone(record);
    },

    async listCases({ userId, status = null, limit = 50, offset = 0 }) {
      return [...cases.values()]
        .filter((record) => String(record.userId) === String(userId))
        .filter((record) => !status || record.status === status)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .slice(offset, offset + limit)
        .map(clone);
    },

    async getCase({ caseId, userId }) {
      const record = cases.get(caseId);
      if (!record || String(record.userId) !== String(userId)) return null;
      return clone(record);
    },

    async updateCase({ caseId, userId, expectedVersion, record, auditEvent }) {
      const current = cases.get(caseId);
      if (!current || String(current.userId) !== String(userId)) return null;
      if (current.version !== expectedVersion) {
        throw reviewError(
          "V2_REVIEW_VERSION_CONFLICT",
          "Review case changed while the request was being processed",
          { status: 409 }
        );
      }
      cases.set(caseId, clone(record));
      appendAudit(auditEvent);
      return clone(record);
    },

    async listAudit({ caseId, userId }) {
      const record = cases.get(caseId);
      if (!record || String(record.userId) !== String(userId)) return null;
      return (audit.get(caseId) || []).map(clone);
    },

    // Service-level support for future canonical edits. Not exposed by Batch 16 API.
    async replaceCaseForCanonicalRefresh({ caseId, userId, expectedVersion, record, auditEvent }) {
      return this.updateCase({ caseId, userId, expectedVersion, record, auditEvent });
    },

    // Test inspection only; callers must never log returned encrypted payloads.
    _unsafeGetStoredRecord(caseId) {
      return clone(cases.get(caseId));
    },
  };
}
