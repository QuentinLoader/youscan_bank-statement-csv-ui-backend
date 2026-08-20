/**
 * YouScan V2
 * Privacy-safe AI telemetry.
 *
 * Raw document text, prompts, model output and extracted financial data must
 * never be placed in these events.
 */

const ALLOWED_FIELDS = new Set([
  "event",
  "task",
  "provider",
  "model",
  "requestId",
  "durationMs",
  "inputTokens",
  "outputTokens",
  "totalTokens",
  "confidence",
  "warningCount",
  "errorCode",
  "retryable",
]);

export function buildSafeAiLogEvent(fields = {}) {
  const event = {};

  for (const [key, value] of Object.entries(fields)) {
    if (ALLOWED_FIELDS.has(key) && value !== undefined) {
      event[key] = value;
    }
  }

  return event;
}

export function emitSafeAiLog(logger, fields) {
  if (typeof logger !== "function") return;
  logger(buildSafeAiLogEvent(fields));
}
