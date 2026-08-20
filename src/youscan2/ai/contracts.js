/**
 * YouScan V2
 * Provider-neutral structured AI contracts.
 */

import { AI_ERROR_CODES, AiError } from "./errors.js";

export const AI_CONTRACT_VERSION = "1.0";

export const AI_TASKS = Object.freeze({
  CLASSIFY_DOCUMENT: "classify_document",
  EXTRACT_BANK_STATEMENT: "extract_bank_statement",
});

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function invalid(message, details = null) {
  throw new AiError(AI_ERROR_CODES.INVALID_RESPONSE, message, { details });
}

export function validateAiEnvelope(value, { task, validateData } = {}) {
  if (!isPlainObject(value)) {
    invalid("AI response must be a JSON object");
  }

  if (value.contractVersion !== AI_CONTRACT_VERSION) {
    invalid(`AI response contractVersion must be ${AI_CONTRACT_VERSION}`);
  }

  if (typeof value.task !== "string" || !value.task) {
    invalid("AI response task is required");
  }

  if (task && value.task !== task) {
    invalid("AI response task does not match the requested task", {
      expectedTask: task,
      receivedTask: value.task,
    });
  }

  if (
    typeof value.confidence !== "number" ||
    !Number.isFinite(value.confidence) ||
    value.confidence < 0 ||
    value.confidence > 1
  ) {
    invalid("AI response confidence must be a number between 0 and 1");
  }

  if (!isPlainObject(value.data)) {
    invalid("AI response data must be a JSON object");
  }

  if (!Array.isArray(value.warnings) || !value.warnings.every((item) => typeof item === "string")) {
    invalid("AI response warnings must be an array of strings");
  }

  if (!Array.isArray(value.evidence) || !value.evidence.every((item) => typeof item === "string")) {
    invalid("AI response evidence must be an array of strings");
  }

  if (typeof validateData === "function") {
    const dataValidation = validateData(value.data);

    if (dataValidation === false) {
      invalid("AI response data failed task-specific validation");
    }

    if (dataValidation && typeof dataValidation === "object" && dataValidation.valid === false) {
      invalid(dataValidation.message || "AI response data failed task-specific validation", {
        issues: dataValidation.issues || null,
      });
    }
  }

  return {
    contractVersion: value.contractVersion,
    task: value.task,
    confidence: value.confidence,
    data: value.data,
    warnings: [...value.warnings],
    evidence: [...value.evidence],
  };
}

export function normalizeUsage(usage = null) {
  if (!usage || typeof usage !== "object") {
    return {
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
    };
  }

  const inputTokens = Number.isFinite(usage.inputTokens)
    ? usage.inputTokens
    : Number.isFinite(usage.promptTokens)
      ? usage.promptTokens
      : null;

  const outputTokens = Number.isFinite(usage.outputTokens)
    ? usage.outputTokens
    : Number.isFinite(usage.completionTokens)
      ? usage.completionTokens
      : null;

  const totalTokens = Number.isFinite(usage.totalTokens)
    ? usage.totalTokens
    : inputTokens !== null && outputTokens !== null
      ? inputTokens + outputTokens
      : null;

  return { inputTokens, outputTokens, totalTokens };
}
