import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import {
  AI_CONTRACT_VERSION,
  AI_ERROR_CODES,
  AiError,
  buildOpenAiEnvelopeSchema,
  createAiProvider,
  createOpenAiProvider,
  getAiConfig,
  runAiTask,
} from "../ai/index.js";

const TASK = "provider_contract_test";
const DATA_SCHEMA = {
  type: "object",
  properties: {
    ok: { type: "boolean" },
    label: { type: ["string", "null"] },
  },
  required: ["ok", "label"],
  additionalProperties: false,
};

function envelope(overrides = {}) {
  return {
    contractVersion: AI_CONTRACT_VERSION,
    task: TASK,
    confidence: 0.99,
    data: { ok: true, label: "verified" },
    warnings: [],
    evidence: ["synthetic provider test"],
    ...overrides,
  };
}

function completedResponse(overrides = {}) {
  return {
    id: "resp_test_123",
    status: "completed",
    model: "gpt-test-model",
    output: [
      {
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: JSON.stringify(envelope()),
          },
        ],
      },
    ],
    usage: {
      input_tokens: 120,
      output_tokens: 35,
      total_tokens: 155,
    },
    ...overrides,
  };
}

async function startServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;

  return {
    baseUrl,
    async close() {
      if (!server.listening) return;
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function readJsonRequest(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function makeConfig(baseUrl, overrides = {}) {
  return getAiConfig({
    YOUSCAN_V2_AI_ENABLED: "true",
    YOUSCAN_V2_AI_PROVIDER: "openai",
    YOUSCAN_V2_AI_MODEL: "gpt-test-model",
    YOUSCAN_V2_OPENAI_API_KEY: "sk-test-secret-key",
    YOUSCAN_V2_OPENAI_BASE_URL: baseUrl,
    YOUSCAN_V2_AI_TIMEOUT_MS: "1000",
    ...overrides,
  });
}

test("Batch 09 OpenAI config keeps the API key non-enumerable", () => {
  const config = makeConfig("http://127.0.0.1:9999/v1");

  assert.equal(config.openaiApiKey, "sk-test-secret-key");
  assert.equal(config.openaiBaseUrl, "http://127.0.0.1:9999/v1");
  assert.equal(JSON.stringify(config).includes("sk-test-secret-key"), false);
  assert.equal(Object.keys(config).includes("openaiApiKey"), false);
});

test("Batch 09 OpenAI provider requires an explicit API key and model", () => {
  assert.throws(
    () =>
      createOpenAiProvider({
        model: "gpt-test-model",
        openaiBaseUrl: "https://api.openai.com/v1",
      }),
    (error) =>
      error instanceof AiError && error.code === AI_ERROR_CODES.CONFIG_INVALID
  );

  assert.throws(
    () =>
      createOpenAiProvider({
        openaiApiKey: "sk-test",
        openaiBaseUrl: "https://api.openai.com/v1",
      }),
    (error) =>
      error instanceof AiError && error.code === AI_ERROR_CODES.CONFIG_INVALID
  );
});

test("Batch 09 OpenAI provider refuses insecure non-local base URLs", () => {
  assert.throws(
    () =>
      createOpenAiProvider({
        model: "gpt-test-model",
        openaiApiKey: "sk-test",
        openaiBaseUrl: "http://example.com/v1",
      }),
    (error) =>
      error.code === AI_ERROR_CODES.CONFIG_INVALID &&
      error.message.includes("HTTPS")
  );
});

test("Batch 09 OpenAI envelope schema constrains contractVersion and task", () => {
  const schema = buildOpenAiEnvelopeSchema(TASK, DATA_SCHEMA);

  assert.deepEqual(schema.properties.contractVersion.enum, [AI_CONTRACT_VERSION]);
  assert.deepEqual(schema.properties.task.enum, [TASK]);
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.data, DATA_SCHEMA);
  assert.deepEqual(schema.required, [
    "contractVersion",
    "task",
    "confidence",
    "data",
    "warnings",
    "evidence",
  ]);
});

test("Batch 09 OpenAI provider requires a task-specific data schema", () => {
  const provider = createOpenAiProvider(
    { model: "gpt-test-model", openaiBaseUrl: "https://api.openai.com/v1" },
    { apiKey: "sk-test", fetchImpl: async () => assert.fail("fetch must not run") }
  );

  assert.rejects(
    () => provider.generateStructured({ task: TASK, input: "synthetic" }),
    (error) => error.code === AI_ERROR_CODES.CONFIG_INVALID
  );
});

test("Batch 09 OpenAI provider sends a strict Responses API request with store=false", async () => {
  let captured = null;
  const server = await startServer(async (req, res) => {
    captured = {
      method: req.method,
      url: req.url,
      authorization: req.headers.authorization,
      body: await readJsonRequest(req),
    };

    res.writeHead(200, {
      "content-type": "application/json",
      "x-request-id": "req_header_456",
    });
    res.end(JSON.stringify(completedResponse()));
  });

  try {
    const provider = createOpenAiProvider(makeConfig(server.baseUrl));
    const result = await provider.generateStructured({
      task: TASK,
      input: { synthetic: true },
      systemPrompt: "Use only supplied evidence.",
      responseSchema: DATA_SCHEMA,
    });

    assert.equal(captured.method, "POST");
    assert.equal(captured.url, "/v1/responses");
    assert.equal(captured.authorization, "Bearer sk-test-secret-key");
    assert.equal(captured.body.model, "gpt-test-model");
    assert.equal(captured.body.store, false);
    assert.equal(captured.body.input[0].role, "system");
    assert.equal(captured.body.input[0].content, "Use only supplied evidence.");
    assert.equal(captured.body.input[1].content, '{"synthetic":true}');
    assert.equal(captured.body.text.format.type, "json_schema");
    assert.equal(captured.body.text.format.strict, true);
    assert.deepEqual(captured.body.text.format.schema.properties.task.enum, [TASK]);

    assert.equal(result.requestId, "req_header_456");
    assert.equal(result.model, "gpt-test-model");
    assert.deepEqual(result.usage, {
      inputTokens: 120,
      outputTokens: 35,
      totalTokens: 155,
    });
    assert.equal(JSON.parse(result.content).data.ok, true);
  } finally {
    await server.close();
  }
});

test("Batch 09 provider registry creates the OpenAI adapter", () => {
  const provider = createAiProvider(makeConfig("http://127.0.0.1:9999/v1"));
  assert.equal(provider.name, "openai");
  assert.equal(typeof provider.generateStructured, "function");
});

test("Batch 09 runAiTask validates a live-provider-shaped structured response end-to-end", async () => {
  const logs = [];
  const server = await startServer(async (_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(completedResponse()));
  });

  try {
    const result = await runAiTask({
      task: TASK,
      input: "SYNTHETIC BANK STATEMENT TEST CONTENT",
      systemPrompt: "Return only verified synthetic facts.",
      responseSchema: DATA_SCHEMA,
      config: makeConfig(server.baseUrl),
      validateData: (data) => ({ valid: data.ok === true }),
      logger: (event) => logs.push(event),
    });

    assert.equal(result.data.ok, true);
    assert.equal(result.meta.provider, "openai");
    assert.equal(result.meta.usage.totalTokens, 155);
    assert.equal(logs.length, 1);
    assert.equal(logs[0].event, "v2_ai_task_completed");
    assert.equal(JSON.stringify(logs).includes("SYNTHETIC BANK STATEMENT"), false);
    assert.equal(JSON.stringify(logs).includes("sk-test-secret-key"), false);
  } finally {
    await server.close();
  }
});

test("Batch 09 OpenAI refusal is rejected and never treated as structured data", async () => {
  const server = await startServer((_req, res) => {
    const body = completedResponse({
      output: [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "refusal", refusal: "refused" }],
        },
      ],
    });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  });

  try {
    const provider = createOpenAiProvider(makeConfig(server.baseUrl));
    await assert.rejects(
      () =>
        provider.generateStructured({
          task: TASK,
          input: "synthetic",
          responseSchema: DATA_SCHEMA,
        }),
      (error) =>
        error.code === AI_ERROR_CODES.PROVIDER_REFUSED &&
        error.retryable === false
    );
  } finally {
    await server.close();
  }
});

test("Batch 09 incomplete OpenAI responses fail closed", async () => {
  const server = await startServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        id: "resp_incomplete",
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
        output: [],
      })
    );
  });

  try {
    const provider = createOpenAiProvider(makeConfig(server.baseUrl));
    await assert.rejects(
      () =>
        provider.generateStructured({
          task: TASK,
          input: "synthetic",
          responseSchema: DATA_SCHEMA,
        }),
      (error) =>
        error.code === AI_ERROR_CODES.PROVIDER_INCOMPLETE &&
        error.retryable === true &&
        error.details?.reason === "max_output_tokens"
    );
  } finally {
    await server.close();
  }
});

test("Batch 09 ambiguous multiple output_text items are rejected", async () => {
  const response = completedResponse();
  response.output[0].content.push({
    type: "output_text",
    text: JSON.stringify(envelope()),
  });

  const server = await startServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(response));
  });

  try {
    const provider = createOpenAiProvider(makeConfig(server.baseUrl));
    await assert.rejects(
      () =>
        provider.generateStructured({
          task: TASK,
          input: "synthetic",
          responseSchema: DATA_SCHEMA,
        }),
      (error) => error.code === AI_ERROR_CODES.INVALID_RESPONSE
    );
  } finally {
    await server.close();
  }
});

test("Batch 09 HTTP 429 is retryable without exposing the provider response body", async () => {
  const secretBody = "SENSITIVE UPSTREAM DIAGNOSTIC";
  const server = await startServer((_req, res) => {
    res.writeHead(429, { "content-type": "text/plain" });
    res.end(secretBody);
  });

  try {
    const provider = createOpenAiProvider(makeConfig(server.baseUrl));
    await assert.rejects(
      () =>
        provider.generateStructured({
          task: TASK,
          input: "synthetic",
          responseSchema: DATA_SCHEMA,
        }),
      (error) => {
        assert.equal(error.code, AI_ERROR_CODES.PROVIDER_FAILED);
        assert.equal(error.retryable, true);
        assert.equal(error.details?.status, 429);
        assert.equal(error.message.includes(secretBody), false);
        return true;
      }
    );
  } finally {
    await server.close();
  }
});

test("Batch 09 HTTP authentication failures are not marked retryable", async () => {
  const server = await startServer((_req, res) => {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "do not expose this" } }));
  });

  try {
    const provider = createOpenAiProvider(makeConfig(server.baseUrl));
    await assert.rejects(
      () =>
        provider.generateStructured({
          task: TASK,
          input: "synthetic",
          responseSchema: DATA_SCHEMA,
        }),
      (error) =>
        error.code === AI_ERROR_CODES.PROVIDER_FAILED &&
        error.retryable === false &&
        error.details?.status === 401
    );
  } finally {
    await server.close();
  }
});

test("Batch 09 malformed successful HTTP JSON is rejected without repair", async () => {
  const server = await startServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{not-json");
  });

  try {
    const provider = createOpenAiProvider(makeConfig(server.baseUrl));
    await assert.rejects(
      () =>
        provider.generateStructured({
          task: TASK,
          input: "synthetic",
          responseSchema: DATA_SCHEMA,
        }),
      (error) => error.code === AI_ERROR_CODES.PROVIDER_FAILED
    );
  } finally {
    await server.close();
  }
});

test("Batch 09 real HTTP adapter obeys the V2 timeout boundary", async () => {
  const server = await startServer(async (_req, res) => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (!res.destroyed) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(completedResponse()));
    }
  });

  try {
    await assert.rejects(
      () =>
        runAiTask({
          task: TASK,
          input: "synthetic",
          responseSchema: DATA_SCHEMA,
          config: makeConfig(server.baseUrl, {
            YOUSCAN_V2_AI_TIMEOUT_MS: "15",
          }),
        }),
      (error) =>
        error.code === AI_ERROR_CODES.TIMEOUT && error.retryable === true
    );
  } finally {
    await server.close();
  }
});
