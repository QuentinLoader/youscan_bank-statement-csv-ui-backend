import { getAiConfig } from "./config.js";
import { AiError } from "./errors.js";
import { runAiTask } from "./runAiTask.js";

export const ANALYSIS_UNAVAILABLE_MESSAGE =
  "Document analysis is temporarily unavailable. Please try again later.";
export const ANALYSIS_UNAVAILABLE_CODE = "V2_AI_UNAVAILABLE";

export function analysisUnavailableError() {
  const error = new Error(ANALYSIS_UNAVAILABLE_MESSAGE);
  error.code = ANALYSIS_UNAVAILABLE_CODE;
  error.status = 503;
  return error;
}

// Only provider/configuration failures affect global health. Document-specific
// refusals, invalid output and input limits must still fail that document.
export function isProviderUnavailable(error) {
  return [
    "V2_AI_PROVIDER_FAILED", "V2_AI_PROVIDER_INCOMPLETE", "V2_AI_TIMEOUT", "V2_AI_CONFIG_INVALID",
    "V2_AI_DISABLED", "V2_AI_PROVIDER_INVALID", "V2_AI_QUOTA_EXHAUSTED",
    "V2_AI_RATE_LIMITED", "V2_PDF_VISION_FAILED",
  ].includes(error?.code);
}

async function probeProvider() {
  const config = getAiConfig();
  if (!config.enabled || !config.extractionEnabled || config.provider !== "openai") {
    throw new AiError("V2_AI_CONFIG_INVALID", "Required OpenAI extraction is not enabled");
  }
  await runAiTask({
    config,
    task: "availability",
    input: "Return data.ok=true, confidence=1, warnings=[], evidence=[].",
    responseSchema: {
      type: "object",
      properties: { ok: { type: "boolean", enum: [true] } },
      required: ["ok"], additionalProperties: false,
    },
    validateData: (data) => ({ valid: data?.ok === true }),
    maxOutputTokens: 2048,
  });
}

// MVP: one process-local cache for the deployed single-replica backend.
// No background traffic: a stale cache rechecks on demand, single flight.
export function createAnalysisAvailability({
  probe = probeProvider, now = Date.now, logger = console.error,
  healthyTtlMs = 300_000, retryMs = 60_000, accountRetryMs = 300_000,
} = {}) {
  let available = false;
  let checkedAt = null;
  let nextCheckAt = 0;
  let failureVersion = 0;
  let pending = null;
  let failure = null;

  function snapshot() {
    return {
      available,
      checkedAt,
      retryAfterSeconds: Math.max(0, Math.ceil((nextCheckAt - now()) / 1000)),
      message: available ? null : ANALYSIS_UNAVAILABLE_MESSAGE,
    };
  }

  function recordFailure(error) {
    failure = { code: error?.code, details: error?.details, status: error?.status };
    failureVersion += 1;
    available = false;
    checkedAt = now();
    const reason = error?.details?.providerCode || error?.details?.providerType ||
      error?.code || "provider_failed";
    const status = error?.details?.status || error?.status || null;
    const accountFailure = status === 401 || status === 403 ||
      reason === "insufficient_quota" || reason === "V2_AI_QUOTA_EXHAUSTED" ||
      ["V2_AI_CONFIG_INVALID", "V2_AI_DISABLED", "V2_AI_PROVIDER_INVALID"].includes(reason);
    nextCheckAt = checkedAt + (accountFailure ? accountRetryMs : retryMs);
    // Allowlisted metadata only: never log upstream messages, keys or documents.
    logger("V2 AI UNAVAILABLE:", JSON.stringify({
      code: error?.code || "provider_failed", reason, status,
      requestId: error?.details?.requestId || null,
      retryAt: nextCheckAt,
    }));
  }

  async function getAvailability() {
    if (now() < nextCheckAt) return snapshot();
    if (!pending) {
      const version = failureVersion;
      pending = (async () => {
        try {
          await probe();
          // An older in-flight success cannot clear a newer processing failure.
          if (failureVersion === version) {
            available = true;
            checkedAt = now();
            nextCheckAt = checkedAt + healthyTtlMs;
          }
        } catch (error) {
          recordFailure(error);
        }
        return snapshot();
      })().finally(() => { pending = null; });
    }
    return pending;
  }

  async function assertAvailable() {
    if (!(await getAvailability()).available) {
      const error = analysisUnavailableError();
      error.providerFailure = failure;
      throw error;
    }
  }

  return { getAvailability, assertAvailable, recordFailure,
    getCachedStatus: () => ({ ...snapshot(), stale: !checkedAt || now() >= nextCheckAt }) };
}

export const analysisAvailability = createAnalysisAvailability();
