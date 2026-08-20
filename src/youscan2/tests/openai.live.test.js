import assert from "node:assert/strict";
import test from "node:test";

import {
  AI_CONTRACT_VERSION,
  getAiConfig,
  runAiTask,
} from "../ai/index.js";

const LIVE_ENABLED =
  String(process.env.YOUSCAN_V2_AI_LIVE_TEST || "").toLowerCase() === "true";

const LIVE_TASK = "provider_live_smoke_test";
const LIVE_SCHEMA = {
  type: "object",
  properties: {
    ok: { type: "boolean", enum: [true] },
    source: { type: "string", enum: ["synthetic"] },
  },
  required: ["ok", "source"],
  additionalProperties: false,
};

test(
  "Batch 09 optional live OpenAI structured-output smoke test",
  { skip: !LIVE_ENABLED },
  async () => {
    const config = getAiConfig();
    assert.equal(config.enabled, true);
    assert.equal(config.provider, "openai");

    const result = await runAiTask({
      task: LIVE_TASK,
      input: "Synthetic provider connectivity test. No customer or bank data is included.",
      systemPrompt: [
        "This is a provider connectivity test using synthetic input only.",
        `Return contractVersion ${AI_CONTRACT_VERSION}, task ${LIVE_TASK}, confidence 1,`,
        'data {"ok":true,"source":"synthetic"}, and empty warnings/evidence arrays.',
      ].join(" "),
      responseSchema: LIVE_SCHEMA,
      config,
      validateData: (data) => ({
        valid: data.ok === true && data.source === "synthetic",
      }),
    });

    assert.equal(result.contractVersion, AI_CONTRACT_VERSION);
    assert.equal(result.task, LIVE_TASK);
    assert.deepEqual(result.data, { ok: true, source: "synthetic" });
    assert.equal(result.meta.provider, "openai");
    assert.ok(result.meta.model);
  }
);
