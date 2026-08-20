/**
 * YouScan V2
 * Shared canonical schema helpers.
 */

export const PARSE_JOB_STATUSES = Object.freeze({
  PROCESSING: "processing",
  COMPLETED: "completed",
  FAILED: "failed",
  NEEDS_REVIEW: "needs_review",
  UNSUPPORTED: "unsupported",
});

export const VALIDATION_STATUSES = Object.freeze({
  PASSED: "passed",
  PASSED_WITH_WARNINGS: "passed_with_warnings",
  FAILED: "failed",
});

export function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

export function isStringOrNull(value) {
  return value === null || typeof value === "string";
}
