import assert from "node:assert/strict";
import test from "node:test";

import {
  AI_CONTRACT_VERSION,
  AI_ERROR_CODES,
  AI_TASKS,
  AiError,
  getAiConfig,
  normalizeUsage,
  runAiTask,
  validateAiEnvelope,
} from "../ai/index.js";
import { buildSafeAiLogEvent } from "../ai/safeLog.js";
import { parseStructuredJson } from "../ai/structuredJson.js";

function enabledConfig(overrides = {}) {
  return {
    enabled: true,
    provider: "mock",
    model: "mock-accurate-model",
    timeoutMs: 100,
    maxInputChars: 10_000,
    ...overrides,
  };
}

function validEnvelope(overrides = {}) {
  return {
    contractVersion: AI_CONTRACT_VERSION,
    task: AI_TASKS.CLASSIFY_DOCUMENT,
    confidence: 0.97,
    data: { documentType: "bank_statement" },
    warnings: [],
    evidence: ["bank statement structure detected"],
    ...overrides,
  };
}

function mockProvider(responseOrHandler) {
  return {
    name: "mock",
    async generateStructured(request) {
      if (typeof responseOrHandler === "function") {
        return responseOrHandler(request);
      }
      return responseOrHandler;
    },
  };
}

test("Batch 08 AI is disabled by default", () => {
  const config = getAiConfig({});
  assert.equal(config.enabled, false);
  assert.equal(config.provider, "disabled");
  assert.equal(config.model, null);
});

test("Batch 08 AI configuration requires an explicit provider when enabled", () => {
  assert.throws(
    () => getAiConfig({ YOUSCAN_V2_AI_ENABLED: "true" }),
    (error) => error instanceof AiError && error.code === AI_ERROR_CODES.CONFIG_INVALID
  );
});

test("Batch 08 AI configuration validates timeout and input limits", () => {
  const config = getAiConfig({
    YOUSCAN_V2_AI_ENABLED: "true",
    YOUSCAN_V2_AI_PROVIDER: "mock",
    YOUSCAN_V2_AI_MODEL: "model-a",
    YOUSCAN_V2_AI_TIMEOUT_MS: "12345",
    YOUSCAN_V2_AI_MAX_INPUT_CHARS: "54321",
  });

  assert.equal(config.enabled, true);
  assert.equal(config.provider, "mock");
  assert.equal(config.model, "model-a");
  assert.equal(config.timeoutMs, 12345);
  assert.equal(config.maxInputChars, 54321);
});

test("Batch 08 strict JSON accepts an object or valid JSON string", () => {
  const objectValue = validEnvelope();
  assert.equal(parseStructuredJson(objectValue), objectValue);
  assert.deepEqual(parseStructuredJson(JSON.stringify(objectValue)), objectValue);
});

test("Batch 08 strict JSON rejects markdown-wrapped or malformed model output", () => {
  assert.throws(
    () => parseStructuredJson('```json\\n{"ok":true}\\n```'),
    (error) => error.code === AI_ERROR_CODES.INVALID_RESPONSE
  );
  assert.throws(
    () => parseStructuredJson('{"broken":'),
    (error) => error.code === AI_ERROR_CODES.INVALID_RESPONSE
  );
});

test("Batch 08 structured envelope enforces task, confidence and arrays", () => {
  assert.equal(
    validateAiEnvelope(validEnvelope(), { task: AI_TASKS.CLASSIFY_DOCUMENT }).confidence,
    0.97
  );

  assert.throws(
    () => validateAiEnvelope(validEnvelope({ confidence: 1.2 }), { task: AI_TASKS.CLASSIFY_DOCUMENT }),
    (error) => error.code === AI_ERROR_CODES.INVALID_RESPONSE
  );

  assert.throws(
    () => validateAiEnvelope(validEnvelope({ task: AI_TASKS.EXTRACT_BANK_STATEMENT }), { task: AI_TASKS.CLASSIFY_DOCUMENT }),
    (error) => error.code === AI_ERROR_CODES.INVALID_RESPONSE
  );
});

test("Batch 08 task-specific validation can reject structurally valid AI data", () => {
  assert.throws(
    () =>
      validateAiEnvelope(validEnvelope(), {
        task: AI_TASKS.CLASSIFY_DOCUMENT,
        validateData: () => ({
          valid: false,
          message: "documentType is not allowed",
          issues: ["documentType"],
        }),
      }),
    (error) =>
      error.code === AI_ERROR_CODES.INVALID_RESPONSE &&
      error.details?.issues?.includes("documentType")
  );
});

test("Batch 08 token usage is normalized across provider naming conventions", () => {
  assert.deepEqual(
    normalizeUsage({ promptTokens: 100, completionTokens: 25 }),
    { inputTokens: 100, outputTokens: 25, totalTokens: 125 }
  );
});

test("Batch 08 runAiTask refuses to execute when AI is disabled", async () => {
  let invoked = false;
  const provider = mockProvider(() => {
    invoked = true;
    return { content: validEnvelope() };
  });

  await assert.rejects(
    () =>
      runAiTask({
        task: AI_TASKS.CLASSIFY_DOCUMENT,
        input: "private statement text",
        config: { ...enabledConfig(), enabled: false },
        provider,
      }),
    (error) => error.code === AI_ERROR_CODES.DISABLED
  );

  assert.equal(invoked, false);
});

test("Batch 08 runAiTask returns only validated structured data plus safe metadata", async () => {
  const result = await runAiTask({
    task: AI_TASKS.CLASSIFY_DOCUMENT,
    input: "private statement text",
    config: enabledConfig(),
    provider: mockProvider({
      content: JSON.stringify(validEnvelope()),
      model: "provider-model",
      requestId: "req-123",
      usage: { inputTokens: 44, outputTokens: 11, totalTokens: 55 },
    }),
  });

  assert.equal(result.task, AI_TASKS.CLASSIFY_DOCUMENT);
  assert.equal(result.confidence, 0.97);
  assert.deepEqual(result.data, { documentType: "bank_statement" });
  assert.equal(result.meta.provider, "mock");
  assert.equal(result.meta.model, "provider-model");
  assert.equal(result.meta.requestId, "req-123");
  assert.deepEqual(result.meta.usage, {
    inputTokens: 44,
    outputTokens: 11,
    totalTokens: 55,
  });
  assert.equal(Object.hasOwn(result, "raw"), false);
  assert.equal(Object.hasOwn(result.meta, "raw"), false);
});

test("Batch 08 input size guard blocks oversized documents before the provider is called", async () => {
  let invoked = false;
  const provider = mockProvider(() => {
    invoked = true;
    return { content: validEnvelope() };
  });

  await assert.rejects(
    () =>
      runAiTask({
        task: AI_TASKS.CLASSIFY_DOCUMENT,
        input: "123456",
        config: enabledConfig({ maxInputChars: 5 }),
        provider,
      }),
    (error) => error.code === AI_ERROR_CODES.INPUT_TOO_LARGE
  );

  assert.equal(invoked, false);
});

test("Batch 08 malformed provider output is rejected rather than repaired", async () => {
  await assert.rejects(
    () =>
      runAiTask({
        task: AI_TASKS.CLASSIFY_DOCUMENT,
        input: "statement",
        config: enabledConfig(),
        provider: mockProvider({ content: 'Here is your JSON: {"confidence": 1}' }),
      }),
    (error) => error.code === AI_ERROR_CODES.INVALID_RESPONSE
  );
});

test("Batch 08 provider failures are normalized without exposing provider internals", async () => {
  await assert.rejects(
    () =>
      runAiTask({
        task: AI_TASKS.CLASSIFY_DOCUMENT,
        input: "statement",
        config: enabledConfig(),
        provider: mockProvider(() => {
          throw new Error("secret upstream failure body");
        }),
      }),
    (error) =>
      error.code === AI_ERROR_CODES.PROVIDER_FAILED &&
      error.message === "YouScan V2 AI provider call failed"
  );
});

test("Batch 08 AI timeout fails closed and is retryable", async () => {
  await assert.rejects(
    () =>
      runAiTask({
        task: AI_TASKS.CLASSIFY_DOCUMENT,
        input: "statement",
        config: enabledConfig({ timeoutMs: 15 }),
        provider: mockProvider(
          () => new Promise((resolve) => setTimeout(() => resolve({ content: validEnvelope() }), 100))
        ),
      }),
    (error) => error.code === AI_ERROR_CODES.TIMEOUT && error.retryable === true
  );
});

test("Batch 08 privacy-safe AI logs exclude document text, prompts and model output", async () => {
  const logs = [];
  const secretText = "ACCOUNT 123456 PRIVATE TRANSACTION";
  const prompt = "PRIVATE SYSTEM PROMPT";

  await runAiTask({
    task: AI_TASKS.CLASSIFY_DOCUMENT,
    input: secretText,
    systemPrompt: prompt,
    config: enabledConfig(),
    provider: mockProvider({
      content: validEnvelope(),
      usage: { promptTokens: 10, completionTokens: 5 },
    }),
    logger: (event) => logs.push(event),
  });

  assert.equal(logs.length, 1);
  const serialized = JSON.stringify(logs[0]);
  assert.equal(serialized.includes(secretText), false);
  assert.equal(serialized.includes(prompt), false);
  assert.equal(serialized.includes("bank statement structure detected"), false);
  assert.equal(logs[0].event, "v2_ai_task_completed");
  assert.equal(logs[0].totalTokens, 15);
});

test("Batch 08 safe logger drops fields outside its allowlist", () => {
  const event = buildSafeAiLogEvent({
    event: "v2_ai_task_completed",
    task: AI_TASKS.CLASSIFY_DOCUMENT,
    provider: "mock",
    documentText: "must not log",
    prompt: "must not log",
    rawOutput: "must not log",
  });

  assert.deepEqual(event, {
    event: "v2_ai_task_completed",
    task: AI_TASKS.CLASSIFY_DOCUMENT,
    provider: "mock",
  });
});
