/**
 * YouScan V2
 * PostgreSQL persistence for encrypted review cases and privacy-safe audit data.
 */

import crypto from "node:crypto";
import pool from "../../config/db.js";
import { reviewError } from "./errors.js";

function rowToRecord(row) {
  if (!row) return null;
  return {
    caseId: row.id,
    userId: row.user_id,
    parseJobId: row.parse_job_id,
    status: row.status,
    decisionRisk: row.decision_risk,
    decisionOutcome: row.decision_outcome,
    deterministicFingerprint: row.deterministic_fingerprint,
    safeSummary: row.safe_summary,
    encryptedPayload: row.encrypted_payload,
    version: row.version,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function rowToAudit(row) {
  return {
    eventId: row.id,
    caseId: row.review_case_id,
    actorUserId: row.actor_user_id,
    eventType: row.event_type,
    safeMetadata: row.safe_metadata,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

async function insertAudit(client, event) {
  if (!event) return;
  await client.query(
    `INSERT INTO youscan_v2_review_audit
      (id, review_case_id, actor_user_id, event_type, safe_metadata, created_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
    [
      event.eventId || crypto.randomUUID(),
      event.caseId,
      String(event.actorUserId),
      event.eventType,
      JSON.stringify(event.safeMetadata || {}),
      event.createdAt,
    ]
  );
}

export function createPostgresReviewRepository({ dbPool = pool } = {}) {
  return {
    async createCase({ record, auditEvent }) {
      const client = await dbPool.connect();
      try {
        await client.query("BEGIN");
        const result = await client.query(
          `INSERT INTO youscan_v2_review_cases
            (id, user_id, parse_job_id, status, decision_risk, decision_outcome,
             deterministic_fingerprint, safe_summary, encrypted_payload, version,
             created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12)
           RETURNING *`,
          [
            record.caseId,
            String(record.userId),
            record.parseJobId,
            record.status,
            record.decisionRisk,
            record.decisionOutcome,
            record.deterministicFingerprint,
            JSON.stringify(record.safeSummary || {}),
            record.encryptedPayload,
            record.version,
            record.createdAt,
            record.updatedAt,
          ]
        );
        await insertAudit(client, auditEvent);
        await client.query("COMMIT");
        return rowToRecord(result.rows[0]);
      } catch (error) {
        await client.query("ROLLBACK");
        if (error?.code === "23505") {
          throw reviewError(
            "V2_REVIEW_CASE_EXISTS",
            "Review case already exists",
            { status: 409, cause: error }
          );
        }
        throw error;
      } finally {
        client.release();
      }
    },

    async listCases({ userId, status = null, limit = 50, offset = 0 }) {
      const result = await dbPool.query(
        `SELECT *
         FROM youscan_v2_review_cases
         WHERE user_id = $1
           AND ($2::text IS NULL OR status = $2)
         ORDER BY created_at DESC
         LIMIT $3 OFFSET $4`,
        [String(userId), status, limit, offset]
      );
      return result.rows.map(rowToRecord);
    },

    async getCase({ caseId, userId }) {
      const result = await dbPool.query(
        `SELECT *
         FROM youscan_v2_review_cases
         WHERE id = $1 AND user_id = $2
         LIMIT 1`,
        [caseId, String(userId)]
      );
      return rowToRecord(result.rows[0]);
    },

    async updateCase({ caseId, userId, expectedVersion, record, auditEvent }) {
      const client = await dbPool.connect();
      try {
        await client.query("BEGIN");
        const locked = await client.query(
          `SELECT *
           FROM youscan_v2_review_cases
           WHERE id = $1 AND user_id = $2
           FOR UPDATE`,
          [caseId, String(userId)]
        );

        if (!locked.rows[0]) {
          await client.query("ROLLBACK");
          return null;
        }

        if (locked.rows[0].version !== expectedVersion) {
          throw reviewError(
            "V2_REVIEW_VERSION_CONFLICT",
            "Review case changed while the request was being processed",
            { status: 409 }
          );
        }

        const result = await client.query(
          `UPDATE youscan_v2_review_cases
           SET status = $1,
               decision_risk = $2,
               decision_outcome = $3,
               deterministic_fingerprint = $4,
               safe_summary = $5::jsonb,
               encrypted_payload = $6,
               version = $7,
               updated_at = $8
           WHERE id = $9 AND user_id = $10
           RETURNING *`,
          [
            record.status,
            record.decisionRisk,
            record.decisionOutcome,
            record.deterministicFingerprint,
            JSON.stringify(record.safeSummary || {}),
            record.encryptedPayload,
            record.version,
            record.updatedAt,
            caseId,
            String(userId),
          ]
        );

        await insertAudit(client, auditEvent);
        await client.query("COMMIT");
        return rowToRecord(result.rows[0]);
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Preserve the original failure.
        }
        throw error;
      } finally {
        client.release();
      }
    },

    async listAudit({ caseId, userId }) {
      const owner = await dbPool.query(
        `SELECT 1 FROM youscan_v2_review_cases WHERE id = $1 AND user_id = $2`,
        [caseId, String(userId)]
      );
      if (!owner.rows[0]) return null;

      const result = await dbPool.query(
        `SELECT *
         FROM youscan_v2_review_audit
         WHERE review_case_id = $1
         ORDER BY created_at ASC, id ASC`,
        [caseId]
      );
      return result.rows.map(rowToAudit);
    },

    async replaceCaseForCanonicalRefresh(args) {
      return this.updateCase(args);
    },
  };
}
