/**
 * YouScan V2
 * Persistent review workflow errors.
 */

export class V2ReviewError extends Error {
  constructor(code, message, { status = 400, cause = null } = {}) {
    super(message);
    this.name = "V2ReviewError";
    this.code = code;
    this.status = status;
    if (cause) this.cause = cause;
  }
}

export function reviewError(code, message, options = {}) {
  return new V2ReviewError(code, message, options);
}

export function asReviewError(error) {
  if (error instanceof V2ReviewError) return error;

  const code = String(error?.code || "");
  if (code === "V2_AI_PROPOSAL_STALE") {
    return reviewError(code, error.message, { status: 409, cause: error });
  }
  if (code.startsWith("V2_AI_PROPOSAL_")) {
    return reviewError(code, error.message, { status: 400, cause: error });
  }

  return reviewError(
    "V2_REVIEW_INTERNAL_ERROR",
    "The review workflow could not complete the request",
    { status: 500, cause: error }
  );
}
