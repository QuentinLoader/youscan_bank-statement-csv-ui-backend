import assert from "node:assert/strict";
import test from "node:test";
import { createAnalysisAvailability, ANALYSIS_UNAVAILABLE_MESSAGE } from "../ai/availability.js";
import { AiError } from "../ai/errors.js";
import { runParseJob } from "../orchestrator/runParseJob.js";
import { FNB_STATEMENT_FIXTURE_TEXT } from "./fixtures/fnbStatement.fixture.js";
import { makeShadowAiEnvelope } from "./fixtures/aiBankStatementShadow.fixture.js";

test("availability coalesces checks and caches health across page loads", async () => {
  let time = 1;
  let calls = 0;
  const service = createAnalysisAvailability({
    now: () => time, probe: async () => { calls++; }, logger: () => {},
  });
  const results = await Promise.all(Array.from({ length: 20 }, () => service.getAvailability()));
  assert.ok(results.every((result) => result.available));
  assert.equal(calls, 1);
  time += 299_999;
  await service.assertAvailable();
  assert.equal(calls, 1);
  time++;
  await service.assertAvailable();
  assert.equal(calls, 2);
});

for (const [reason, status, cooldown] of [
  ["insufficient_quota", 429, 300_000],
  ["invalid_api_key", 401, 300_000],
  ["rate_limit_exceeded", 429, 60_000],
  ["V2_AI_TIMEOUT", null, 60_000],
]) {
  test(`availability preserves ${reason}, blocks requests, and recovers after cooldown`, async () => {
    let time = 1;
    let failing = true;
    let calls = 0;
    const logs = [];
    const failure = new AiError(status ? "V2_AI_PROVIDER_FAILED" : reason, "private provider message", {
      details: { providerCode: status ? reason : null, status, requestId: "req-test" },
    });
    const service = createAnalysisAvailability({
      now: () => time, logger: (...args) => logs.push(args),
      probe: async () => { calls++; if (failing) throw failure; },
    });
    assert.equal((await service.getAvailability()).available, false);
    await assert.rejects(service.assertAvailable, (error) => error.status === 503);
    assert.equal(calls, 1);
    const publicState = JSON.stringify(await service.getAvailability());
    assert.ok(publicState.includes(ANALYSIS_UNAVAILABLE_MESSAGE));
    assert.ok(!publicState.includes(reason));
    assert.ok(JSON.stringify(logs).includes(reason));
    assert.ok(!JSON.stringify(logs).includes("private provider message"));
    time += cooldown - 1;
    failing = false;
    assert.equal((await service.getAvailability()).available, false);
    time++;
    assert.equal((await service.getAvailability()).available, true);
    assert.equal(calls, 2);
  });
}

test("a stale in-flight probe success cannot clear a newer analysis failure", async () => {
  let finish;
  const service = createAnalysisAvailability({
    probe: () => new Promise((resolve) => { finish = resolve; }), logger: () => {},
  });
  const pending = service.getAvailability();
  service.recordFailure(new AiError("V2_AI_TIMEOUT", "timeout"));
  finish();
  assert.equal((await pending).available, false);
});

const config = {
  enabled: true, extractionEnabled: true, provider: "mock", model: "mock",
  timeoutMs: 25, maxInputChars: 120_000,
  extractionMinConfidence: 0.95, extractionFieldMinConfidence: 0.95,
};

test("required AI classification failure trips health instead of becoming a document review", async () => {
  const availability = createAnalysisAvailability({ probe: async () => {}, logger: () => {} });
  const result = await runParseJob({
    file: { originalname: "unknown.txt" }, extractedText: "Unclassified document text",
    requireAi: true, availability,
    classificationOptions: {
      aiConfig: { ...config, classifierEnabled: true, classificationMinConfidence: 0.92 },
      aiProvider: { name: "mock", generateStructured: async () => {
        throw new AiError("V2_AI_PROVIDER_FAILED", "auth", { details: { status: 401 } });
      } },
    },
  });
  assert.equal(result.error.code, "V2_AI_UNAVAILABLE");
  assert.equal(result.result, null);
  assert.equal((await availability.getAvailability()).available, false);
});

for (const failure of [
  new AiError("V2_AI_PROVIDER_FAILED", "HTTP 429", { details: { providerCode: "insufficient_quota", status: 429 } }),
  new AiError("V2_AI_TIMEOUT", "timeout"),
  new AiError("V2_AI_INVALID_RESPONSE", "invalid output"),
]) {
  test(`required AI ${failure.code} cannot complete a deterministic parse`, async () => {
    let calls = 0;
    const availability = createAnalysisAvailability({ probe: async () => {}, logger: () => {} });
    const result = await runParseJob({
      file: { originalname: "fnb.txt" }, extractedText: FNB_STATEMENT_FIXTURE_TEXT,
      requireAi: true, availability,
      shadowAiOptions: { config, provider: {
        name: "mock", generateStructured: async () => { calls++; throw failure; },
      } },
    });
    assert.equal(calls, 1);
    assert.equal(result.status, "failed");
    assert.equal(result.result, null);
    assert.equal(result.aiCompleted, undefined);
    if (failure.code !== "V2_AI_INVALID_RESPONSE") {
      assert.equal((await availability.getAvailability()).available, false);
      const again = await runParseJob({
        file: { originalname: "fnb.txt" }, extractedText: FNB_STATEMENT_FIXTURE_TEXT,
        requireAi: true, availability,
      });
      assert.equal(again.error.code, "V2_AI_UNAVAILABLE");
    }
  });
}

test("disabled required AI fails closed; successful AI retains the normal result", async () => {
  const availability = createAnalysisAvailability({ probe: async () => {}, logger: () => {} });
  const args = { file: { originalname: "fnb.txt" }, extractedText: FNB_STATEMENT_FIXTURE_TEXT,
    requireAi: true, availability };
  const disabled = await runParseJob({ ...args, shadowAiOptions: { config: { ...config, enabled: false } } });
  assert.equal(disabled.status, "failed");
  assert.equal(disabled.result, null);
  const healthy = createAnalysisAvailability({ probe: async () => {}, logger: () => {} });
  const success = await runParseJob({ ...args, availability: healthy, shadowAiOptions: {
    config, provider: { name: "mock", generateStructured: async () => ({
      content: JSON.stringify(makeShadowAiEnvelope()), requestId: "req-success",
    }) },
  } });
  assert.equal(success.status, "completed");
  assert.equal(success.aiCompleted, true);
  assert.equal(success.shadowAi.ai.requestId, "req-success");
  assert.equal(success.result.data.transactions.length, 4);
});
