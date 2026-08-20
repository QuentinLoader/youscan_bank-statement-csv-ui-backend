/**
 * YouScan V2
 * Provider-neutral structured AI task runner.
 *
 * This module is intentionally not wired into classification or extraction in
 * Batch 08. It establishes the safe execution boundary for later AI batches.
 */

import { getAiConfig } from "./config.js";
import { normalizeUsage, validateAiEnvelope } from "./contracts.js";
import { AI_ERROR_CODES, AiError, isAiError } from "./errors.js";
import { createAiProvider } from "./providerRegistry.js";
import { emitSafeAiLog } from "./safeLog.js";
import { parseStructuredJson } from "./structuredJson.js";

function serializedLength(input) {
  if (typeof input === "string") return input.length;

  try {
    return JSON.stringify(input ?? null).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function validateProvider(provider) {
  if (
    !provider ||
    typeof provider.name !== "string" ||
    typeof provider.generateStructured !== "function"
  ) {
    throw new AiError(
      AI_ERROR_CODES.PROVIDER_INVALID,
      "A valid YouScan V2 AI provider is required"
    );
  }
}

async function callWithTimeout(provider, request, timeoutMs) {
  const controller = new AbortController();
  let timer;

  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(
        new AiError(
          AI_ERROR_CODES.TIMEOUT,
          `YouScan V2 AI task exceeded ${timeoutMs}ms`,
          { retryable: true }
        )
      );
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      provider.generateStructured({ ...request, signal: controller.signal }),
      timeoutPromise,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function runAiTask({
  task,
  input,
  systemPrompt = "",
  responseSchema = null,
  validateData = null,
  config = null,
  provider = null,
  logger = null,
}) {
  const resolvedConfig = config || getAiConfig();

  if (!resolvedConfig.enabled) {
    throw new AiError(AI_ERROR_CODES.DISABLED, "YouScan V2 AI is disabled");
  }

  if (typeof task !== "string" || !task.trim()) {
    throw new AiError(
      AI_ERROR_CODES.CONFIG_INVALID,
      "AI task name is required"
    );
  }

  const inputLength = serializedLength(input);
  if (inputLength > resolvedConfig.maxInputChars) {
    throw new AiError(
      AI_ERROR_CODES.INPUT_TOO_LARGE,
      `AI task input exceeds the configured ${resolvedConfig.maxInputChars} character limit`
    );
  }

  const resolvedProvider = provider || createAiProvider(resolvedConfig);
  validateProvider(resolvedProvider);

  const startedAt = Date.now();

  try {
    const providerResponse = await callWithTimeout(
      resolvedProvider,
      {
        task,
        model: resolvedConfig.model,
        input,
        systemPrompt,
        responseSchema,
      },
      resolvedConfig.timeoutMs
    );

    const parsed = parseStructuredJson(providerResponse?.content);
    const envelope = validateAiEnvelope(parsed, { task, validateData });
    const usage = normalizeUsage(providerResponse?.usage);
    const durationMs = Math.max(0, Date.now() - startedAt);

    const result = {
      ...envelope,
      meta: {
        provider: resolvedProvider.name,
        model: providerResponse?.model || resolvedConfig.model || null,
        requestId: providerResponse?.requestId || null,
        durationMs,
        usage,
      },
    };

    emitSafeAiLog(logger, {
      event: "v2_ai_task_completed",
      task,
      provider: result.meta.provider,
      model: result.meta.model,
      requestId: result.meta.requestId,
      durationMs,
      ...usage,
      confidence: envelope.confidence,
      warningCount: envelope.warnings.length,
    });

    return result;
  } catch (error) {
    const normalizedError = isAiError(error)
      ? error
      : new AiError(
          AI_ERROR_CODES.PROVIDER_FAILED,
          "YouScan V2 AI provider call failed",
          { cause: error, retryable: true }
        );

    emitSafeAiLog(logger, {
      event: "v2_ai_task_failed",
      task,
      provider: resolvedProvider.name,
      model: resolvedConfig.model,
      durationMs: Math.max(0, Date.now() - startedAt),
      errorCode: normalizedError.code,
      retryable: normalizedError.retryable,
    });

    throw normalizedError;
  }
}
