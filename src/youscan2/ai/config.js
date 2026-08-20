/**
 * YouScan V2
 * AI configuration.
 *
 * Accuracy/safety rules:
 * - AI is disabled unless explicitly enabled.
 * - Classification fallback has its own feature flag and stays off by default.
 * - No provider or model is selected implicitly.
 * - Provider credentials are kept non-enumerable on the config object so an
 *   accidental JSON.stringify(config) cannot expose an API key.
 */

import { AI_ERROR_CODES, AiError } from "./errors.js";

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_INPUT_CHARS = 120_000;
const DEFAULT_CLASSIFICATION_MAX_INPUT_CHARS = 30_000;
const DEFAULT_CLASSIFICATION_MIN_CONFIDENCE = 0.92;
const DEFAULT_EXTRACTION_MIN_CONFIDENCE = 0.95;
const DEFAULT_EXTRACTION_FIELD_MIN_CONFIDENCE = 0.95;
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value).trim().toLowerCase() === "true";
}

function parsePositiveInteger(value, fallback, label) {
  if (value === undefined || value === null || value === "") return fallback;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new AiError(
      AI_ERROR_CODES.CONFIG_INVALID,
      `${label} must be a positive integer`
    );
  }

  return parsed;
}

function parseConfidenceThreshold(value, fallback, label) {
  if (value === undefined || value === null || value === "") return fallback;

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0.8 || parsed > 1) {
    throw new AiError(
      AI_ERROR_CODES.CONFIG_INVALID,
      `${label} must be a number between 0.8 and 1`
    );
  }

  return parsed;
}

function parseExtractionConfidenceThreshold(value, fallback, label) {
  if (value === undefined || value === null || value === "") return fallback;

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0.9 || parsed > 1) {
    throw new AiError(
      AI_ERROR_CODES.CONFIG_INVALID,
      `${label} must be a number between 0.9 and 1`
    );
  }

  return parsed;
}

function normalizeBaseUrl(value) {
  return String(value || DEFAULT_OPENAI_BASE_URL).trim().replace(/\/+$/, "");
}

export function getAiConfig(env = process.env) {
  const enabled = parseBoolean(env.YOUSCAN_V2_AI_ENABLED, false);
  const classifierEnabled = parseBoolean(
    env.YOUSCAN_V2_AI_CLASSIFIER_ENABLED,
    false
  );
  const extractionEnabled = parseBoolean(
    env.YOUSCAN_V2_AI_EXTRACTION_ENABLED,
    false
  );
  const provider = String(env.YOUSCAN_V2_AI_PROVIDER || "disabled")
    .trim()
    .toLowerCase();
  const model = String(env.YOUSCAN_V2_AI_MODEL || "").trim() || null;
  const timeoutMs = parsePositiveInteger(
    env.YOUSCAN_V2_AI_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS,
    "YOUSCAN_V2_AI_TIMEOUT_MS"
  );
  const maxInputChars = parsePositiveInteger(
    env.YOUSCAN_V2_AI_MAX_INPUT_CHARS,
    DEFAULT_MAX_INPUT_CHARS,
    "YOUSCAN_V2_AI_MAX_INPUT_CHARS"
  );
  const classificationMaxInputChars = parsePositiveInteger(
    env.YOUSCAN_V2_AI_CLASSIFICATION_MAX_INPUT_CHARS,
    DEFAULT_CLASSIFICATION_MAX_INPUT_CHARS,
    "YOUSCAN_V2_AI_CLASSIFICATION_MAX_INPUT_CHARS"
  );
  const classificationMinConfidence = parseConfidenceThreshold(
    env.YOUSCAN_V2_AI_CLASSIFICATION_MIN_CONFIDENCE,
    DEFAULT_CLASSIFICATION_MIN_CONFIDENCE,
    "YOUSCAN_V2_AI_CLASSIFICATION_MIN_CONFIDENCE"
  );
  const extractionMinConfidence = parseExtractionConfidenceThreshold(
    env.YOUSCAN_V2_AI_EXTRACTION_MIN_CONFIDENCE,
    DEFAULT_EXTRACTION_MIN_CONFIDENCE,
    "YOUSCAN_V2_AI_EXTRACTION_MIN_CONFIDENCE"
  );
  const extractionFieldMinConfidence = parseExtractionConfidenceThreshold(
    env.YOUSCAN_V2_AI_EXTRACTION_FIELD_MIN_CONFIDENCE,
    DEFAULT_EXTRACTION_FIELD_MIN_CONFIDENCE,
    "YOUSCAN_V2_AI_EXTRACTION_FIELD_MIN_CONFIDENCE"
  );
  const openaiBaseUrl = normalizeBaseUrl(env.YOUSCAN_V2_OPENAI_BASE_URL);
  const openaiApiKey = String(
    env.YOUSCAN_V2_OPENAI_API_KEY || env.OPENAI_API_KEY || ""
  ).trim() || null;

  if (enabled && (!provider || provider === "disabled")) {
    throw new AiError(
      AI_ERROR_CODES.CONFIG_INVALID,
      "YOUSCAN_V2_AI_PROVIDER must be configured when V2 AI is enabled"
    );
  }

  if (classifierEnabled && !enabled) {
    throw new AiError(
      AI_ERROR_CODES.CONFIG_INVALID,
      "YOUSCAN_V2_AI_ENABLED must be true when the V2 AI classifier is enabled"
    );
  }

  if (extractionEnabled && !enabled) {
    throw new AiError(
      AI_ERROR_CODES.CONFIG_INVALID,
      "YOUSCAN_V2_AI_ENABLED must be true when V2 AI extraction is enabled"
    );
  }

  const config = {
    enabled,
    classifierEnabled,
    extractionEnabled,
    provider,
    model,
    timeoutMs,
    maxInputChars,
    classificationMaxInputChars,
    classificationMinConfidence,
    extractionMinConfidence,
    extractionFieldMinConfidence,
    openaiBaseUrl,
  };

  Object.defineProperty(config, "openaiApiKey", {
    value: openaiApiKey,
    enumerable: false,
    configurable: false,
    writable: false,
  });

  return Object.freeze(config);
}
