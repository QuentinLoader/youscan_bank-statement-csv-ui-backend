/**
 * YouScan V2
 * Strict structured-output parser.
 *
 * Accuracy rule: do not attempt to "repair" malformed model output. If a
 * provider claims to return structured JSON, invalid JSON is rejected.
 */

import { AI_ERROR_CODES, AiError } from "./errors.js";

export function parseStructuredJson(content) {
  if (content !== null && typeof content === "object" && !Array.isArray(content)) {
    return content;
  }

  if (typeof content !== "string") {
    throw new AiError(
      AI_ERROR_CODES.INVALID_RESPONSE,
      "AI provider response must contain a JSON object or JSON string"
    );
  }

  const trimmed = content.trim();

  if (!trimmed || trimmed.startsWith("```") || trimmed.endsWith("```")) {
    throw new AiError(
      AI_ERROR_CODES.INVALID_RESPONSE,
      "AI provider response is not strict JSON"
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (cause) {
    throw new AiError(
      AI_ERROR_CODES.INVALID_RESPONSE,
      "AI provider returned malformed JSON",
      { cause }
    );
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AiError(
      AI_ERROR_CODES.INVALID_RESPONSE,
      "AI provider response JSON must be an object"
    );
  }

  return parsed;
}
