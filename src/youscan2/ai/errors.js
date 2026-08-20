/**
 * YouScan V2
 * AI-layer error contracts.
 */

export const AI_ERROR_CODES = Object.freeze({
  DISABLED: "V2_AI_DISABLED",
  CONFIG_INVALID: "V2_AI_CONFIG_INVALID",
  PROVIDER_INVALID: "V2_AI_PROVIDER_INVALID",
  PROVIDER_FAILED: "V2_AI_PROVIDER_FAILED",
  PROVIDER_REFUSED: "V2_AI_PROVIDER_REFUSED",
  PROVIDER_INCOMPLETE: "V2_AI_PROVIDER_INCOMPLETE",
  TIMEOUT: "V2_AI_TIMEOUT",
  INPUT_TOO_LARGE: "V2_AI_INPUT_TOO_LARGE",
  INVALID_RESPONSE: "V2_AI_INVALID_RESPONSE",
});

export class AiError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "AiError";
    this.code = code;
    this.retryable = Boolean(options.retryable);
    this.details = options.details || null;
  }
}

export function isAiError(error) {
  return error instanceof AiError;
}
