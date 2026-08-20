/**
 * YouScan V2
 * In-memory parse job creation.
 *
 * Persistence/queueing is intentionally not introduced in Batch 01.
 */

import crypto from "crypto";
import { PARSE_JOB_STATUSES } from "../schemas/common.js";

export function createParseJob({ file = null, extractionMeta = null } = {}) {
  const startedAt = new Date().toISOString();

  return {
    jobId: crypto.randomUUID(),
    status: PARSE_JOB_STATUSES.PROCESSING,
    startedAt,
    file: {
      originalname: file?.originalname || "unknown",
      mimetype: file?.mimetype || null,
    },
    extractionMeta,
  };
}
