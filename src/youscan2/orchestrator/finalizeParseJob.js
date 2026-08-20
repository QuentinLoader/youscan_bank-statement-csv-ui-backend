/**
 * YouScan V2
 * Final parse-job envelope builder.
 */

import { PARSE_JOB_STATUSES } from "../schemas/common.js";

const ALLOWED_FINAL_STATUSES = new Set([
  PARSE_JOB_STATUSES.COMPLETED,
  PARSE_JOB_STATUSES.FAILED,
  PARSE_JOB_STATUSES.NEEDS_REVIEW,
  PARSE_JOB_STATUSES.UNSUPPORTED,
]);

export function finalizeParseJob({
  job,
  status,
  classification = null,
  schema = null,
  result = null,
  extractionMeta = null,
  message = null,
  error = null,
}) {
  if (!job?.jobId) {
    throw new Error("INVALID_PARSE_JOB");
  }

  if (!ALLOWED_FINAL_STATUSES.has(status)) {
    throw new Error(`INVALID_FINAL_PARSE_STATUS:${status}`);
  }

  const completedAt = new Date().toISOString();
  const startedMs = Date.parse(job.startedAt);
  const completedMs = Date.parse(completedAt);

  return {
    jobId: job.jobId,
    status,
    classification,
    schema,
    result,
    extractionMeta: extractionMeta ?? job.extractionMeta ?? null,
    message,
    error,
    startedAt: job.startedAt,
    completedAt,
    durationMs:
      Number.isFinite(startedMs) && Number.isFinite(completedMs)
        ? Math.max(0, completedMs - startedMs)
        : null,
  };
}
