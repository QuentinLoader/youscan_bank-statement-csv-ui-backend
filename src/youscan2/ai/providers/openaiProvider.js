/**
 * YouScan V2
 * OpenAI Responses API adapter.
 *
 * Accuracy/privacy rules:
 * - Requires an explicit model and API key.
 * - Uses Responses API Structured Outputs with strict JSON Schema.
 * - Sends store:false for statement-processing requests.
 * - Rejects refusals, incomplete responses and ambiguous/multiple text outputs.
 * - Never includes upstream response bodies or document text in thrown errors.
 */

import { AI_CONTRACT_VERSION } from "../contracts.js";
import { AI_ERROR_CODES, AiError, isAiError } from "../errors.js";

const DEFAULT_SYSTEM_PROMPT = [
  "You are the YouScan V2 structured-analysis provider.",
  "Return only facts supported by the supplied input.",
  "Do not invent missing values.",
  "Express uncertainty through the confidence, warnings and evidence fields.",
].join(" ");

function requireNonEmptyString(value, message) {
  if (typeof value !== "string" || !value.trim()) {
    throw new AiError(AI_ERROR_CODES.CONFIG_INVALID, message);
  }
  return value.trim();
}

function validateBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new AiError(
      AI_ERROR_CODES.CONFIG_INVALID,
      "YOUSCAN_V2_OPENAI_BASE_URL must be a valid URL"
    );
  }

  const localHostnames = new Set(["localhost", "127.0.0.1", "::1"]);
  if (url.protocol !== "https:" && !localHostnames.has(url.hostname)) {
    throw new AiError(
      AI_ERROR_CODES.CONFIG_INVALID,
      "YOUSCAN_V2_OPENAI_BASE_URL must use HTTPS"
    );
  }

  return url.toString().replace(/\/+$/, "");
}

function normalizeSchemaName(task) {
  const safe = String(task || "task")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48) || "task";
  return `youscan_v2_${safe}`;
}

function validateDataSchema(responseSchema) {
  if (
    !responseSchema ||
    typeof responseSchema !== "object" ||
    Array.isArray(responseSchema) ||
    responseSchema.type !== "object"
  ) {
    throw new AiError(
      AI_ERROR_CODES.CONFIG_INVALID,
      "OpenAI structured tasks require a responseSchema with type=object"
    );
  }

  return responseSchema;
}

export function buildOpenAiEnvelopeSchema(task, responseSchema) {
  const dataSchema = validateDataSchema(responseSchema);

  return {
    type: "object",
    properties: {
      contractVersion: {
        type: "string",
        enum: [AI_CONTRACT_VERSION],
      },
      task: {
        type: "string",
        enum: [task],
      },
      confidence: {
        type: "number",
        minimum: 0,
        maximum: 1,
      },
      data: dataSchema,
      warnings: {
        type: "array",
        items: { type: "string" },
      },
      evidence: {
        type: "array",
        items: { type: "string" },
      },
    },
    required: [
      "contractVersion",
      "task",
      "confidence",
      "data",
      "warnings",
      "evidence",
    ],
    additionalProperties: false,
  };
}

function serializeInput(input) {
  if (typeof input === "string") return input;

  try {
    return JSON.stringify(input ?? null);
  } catch {
    throw new AiError(
      AI_ERROR_CODES.CONFIG_INVALID,
      "AI input must be serializable"
    );
  }
}

function extractRefusal(response) {
  for (const output of Array.isArray(response?.output) ? response.output : []) {
    if (output?.type !== "message") continue;
    for (const content of Array.isArray(output?.content) ? output.content : []) {
      if (content?.type === "refusal") {
        return true;
      }
    }
  }
  return false;
}

function extractSingleOutputText(response) {
  const texts = [];

  for (const output of Array.isArray(response?.output) ? response.output : []) {
    if (output?.type !== "message") continue;
    for (const content of Array.isArray(output?.content) ? output.content : []) {
      if (content?.type === "output_text" && typeof content.text === "string") {
        texts.push(content.text);
      }
    }
  }

  if (texts.length !== 1 || !texts[0].trim()) {
    throw new AiError(
      AI_ERROR_CODES.INVALID_RESPONSE,
      "OpenAI returned an unexpected structured-output shape"
    );
  }

  return texts[0];
}

function normalizeOpenAiUsage(usage) {
  if (!usage || typeof usage !== "object") return null;

  return {
    inputTokens: Number.isFinite(usage.input_tokens) ? usage.input_tokens : null,
    outputTokens: Number.isFinite(usage.output_tokens) ? usage.output_tokens : null,
    totalTokens: Number.isFinite(usage.total_tokens) ? usage.total_tokens : null,
  };
}

async function parseHttpJson(response) {
  try {
    return await response.json();
  } catch (cause) {
    throw new AiError(
      AI_ERROR_CODES.PROVIDER_FAILED,
      "OpenAI returned an unreadable response",
      {
        cause,
        retryable: response.status >= 500,
        details: { status: response.status },
      }
    );
  }
}

export function createOpenAiProvider(config, options = {}) {
  const apiKey = requireNonEmptyString(
    options.apiKey || config?.openaiApiKey,
    "OPENAI_API_KEY or YOUSCAN_V2_OPENAI_API_KEY is required for the OpenAI provider"
  );
  const model = requireNonEmptyString(
    options.model || config?.model,
    "YOUSCAN_V2_AI_MODEL is required for the OpenAI provider"
  );
  const baseUrl = validateBaseUrl(
    options.baseUrl || config?.openaiBaseUrl || "https://api.openai.com/v1"
  );
  const fetchImpl = options.fetchImpl || globalThis.fetch;

  if (typeof fetchImpl !== "function") {
    throw new AiError(
      AI_ERROR_CODES.CONFIG_INVALID,
      "The OpenAI provider requires a fetch implementation (Node.js 18+)"
    );
  }

  return Object.freeze({
    name: "openai",

    async generateStructured({
      task,
      input,
      systemPrompt = "",
      responseSchema,
      signal,
    }) {
      const normalizedTask = requireNonEmptyString(task, "AI task name is required");
      const envelopeSchema = buildOpenAiEnvelopeSchema(
        normalizedTask,
        responseSchema
      );
      const body = {
        model,
        store: false,
        input: [
          {
            role: "system",
            content: systemPrompt.trim() || DEFAULT_SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: serializeInput(input),
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: normalizeSchemaName(normalizedTask),
            strict: true,
            schema: envelopeSchema,
          },
        },
      };

      let httpResponse;
      try {
        httpResponse = await fetchImpl(`${baseUrl}/responses`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          redirect: "error",
          signal,
          body: JSON.stringify(body),
        });
      } catch (error) {
        if (isAiError(error)) throw error;
        throw error;
      }

      if (!httpResponse || typeof httpResponse.ok !== "boolean") {
        throw new AiError(
          AI_ERROR_CODES.PROVIDER_FAILED,
          "OpenAI provider returned an invalid HTTP response",
          { retryable: true }
        );
      }

      if (!httpResponse.ok) {
        // Deliberately do not read or propagate the provider response body. It
        // may contain request fragments or other sensitive diagnostic data.
        if (typeof httpResponse.body?.cancel === "function") {
          await httpResponse.body.cancel().catch(() => {});
        }
        throw new AiError(
          AI_ERROR_CODES.PROVIDER_FAILED,
          `OpenAI request failed with HTTP ${httpResponse.status}`,
          {
            retryable: httpResponse.status === 429 || httpResponse.status >= 500,
            details: { status: httpResponse.status },
          }
        );
      }

      const response = await parseHttpJson(httpResponse);

      if (response?.status === "incomplete") {
        throw new AiError(
          AI_ERROR_CODES.PROVIDER_INCOMPLETE,
          "OpenAI returned an incomplete structured response",
          {
            retryable: true,
            details: {
              reason: response?.incomplete_details?.reason || null,
            },
          }
        );
      }

      if (response?.status && response.status !== "completed") {
        throw new AiError(
          AI_ERROR_CODES.PROVIDER_FAILED,
          "OpenAI did not complete the structured response",
          {
            retryable: true,
            details: { status: response.status },
          }
        );
      }

      if (extractRefusal(response)) {
        throw new AiError(
          AI_ERROR_CODES.PROVIDER_REFUSED,
          "OpenAI refused the structured task",
          { retryable: false }
        );
      }

      const content = extractSingleOutputText(response);
      const requestId =
        (typeof httpResponse.headers?.get === "function" &&
          httpResponse.headers.get("x-request-id")) ||
        response?.id ||
        null;

      return {
        content,
        model: response?.model || model,
        requestId,
        usage: normalizeOpenAiUsage(response?.usage),
      };
    },
  });
}
