import assert from "node:assert/strict";
import test from "node:test";
import express from "express";

import { PRICING } from "../../config/pricing.js";
import { createOzowWebhookRouter } from "../../webhooks/ozow.webhook.js";
import {
  generateOzowRequestHash,
  generateOzowWebhookHash,
  safeOzowEventSummary,
  timingSafeHashEqual,
} from "../../utils/ozowSecurity.js";

const privateKey = "synthetic-private-key-b17";

function requestPayload() {
  return {
    SiteCode: "SITE",
    CountryCode: "ZA",
    CurrencyCode: "ZAR",
    Amount: "29.50",
    TransactionReference: "42_PAYG_10_123456",
    BankReference: "YS-123456",
    Optional1: "",
    Optional2: "",
    Optional3: "",
    Optional4: "",
    Optional5: "",
    Customer: "",
    CancelURL: "https://example.test/cancel",
    ErrorURL: "https://example.test/error",
    SuccessURL: "https://example.test/success",
    NotifyURL: "https://example.test/notify",
    IsTest: "false",
  };
}

function webhookPayload(overrides = {}) {
  const payload = {
    SiteCode: "SITE",
    TransactionId: "OZ-1",
    TransactionReference: "42_PAYG_10_123456",
    Amount: "29.50",
    Status: "Complete",
    Optional1: "",
    Optional2: "",
    Optional3: "",
    Optional4: "",
    Optional5: "",
    CurrencyCode: "ZAR",
    IsTest: "false",
    BankReference: "YS-123456",
    BankName: "Synthetic Bank",
    ...overrides,
  };
  payload.Hash = generateOzowWebhookHash(payload, privateKey);
  return payload;
}

async function harness({ dbPool, env = {} } = {}) {
  const app = express();
  app.use(
    "/ozow",
    createOzowWebhookRouter({
      dbPool: dbPool || { connect: async () => assert.fail("DB must not be reached") },
      env: { OZOW_PRIVATE_KEY: privateKey, OZOW_SITE_CODE: "SITE", ...env },
      pricing: PRICING,
      logger: { info() {}, warn() {}, error() {} },
    })
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/ozow/webhook`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function postForm(url, payload) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(payload)) body.set(key, String(value));
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
}

test("Batch 17 Ozow request hashing is deterministic and never exposes the private key", () => {
  const hash = generateOzowRequestHash(requestPayload(), privateKey);
  assert.match(hash, /^[0-9a-f]{128}$/);
  assert.equal(hash.includes(privateKey), false);
  assert.equal(hash, generateOzowRequestHash(requestPayload(), privateKey));
});

test("Batch 17 Ozow hash comparison rejects malformed or changed hashes", () => {
  const hash = generateOzowWebhookHash(webhookPayload({ Hash: undefined }), privateKey);
  assert.equal(timingSafeHashEqual(hash, hash), true);
  assert.equal(timingSafeHashEqual(hash, `${hash.slice(0, -1)}0`), hash.endsWith("0"));
  assert.equal(timingSafeHashEqual(hash, "not-a-hash"), false);
});

test("Batch 17 invalid Ozow webhook hash is rejected before any database access", async () => {
  const h = await harness();
  try {
    const payload = webhookPayload();
    payload.Hash = "0".repeat(128);
    const response = await postForm(h.url, payload);
    assert.equal(response.status, 400);
    assert.equal(await response.text(), "INVALID_HASH");
  } finally {
    await h.close();
  }
});

test("Batch 17 valid hash with wrong configured amount is rejected before database access", async () => {
  const h = await harness();
  try {
    const payload = webhookPayload({ Amount: "30.50" });
    const response = await postForm(h.url, payload);
    assert.equal(response.status, 400);
  } finally {
    await h.close();
  }
});

test("Batch 17 verified Ozow test callbacks do not activate plans by default", async () => {
  const h = await harness();
  try {
    const payload = webhookPayload({ IsTest: "true" });
    const response = await postForm(h.url, payload);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "TEST_IGNORED");
  } finally {
    await h.close();
  }
});

test("Batch 17 Ozow safe event summary excludes amount, bank data, hash, and secrets", () => {
  const payload = webhookPayload();
  const safe = safeOzowEventSummary(payload);
  const serialized = JSON.stringify(safe);
  assert.equal(serialized.includes(payload.Amount), false);
  assert.equal(serialized.includes(payload.Hash), false);
  assert.equal(serialized.includes(payload.BankName), false);
  assert.equal(serialized.includes(privateKey), false);
});

function livePaymentDb({ alreadyComplete = false } = {}) {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      const text = String(sql).replace(/\s+/g, " ").trim();
      calls.push({ sql: text, params });
      if (text.startsWith("SELECT id, processed_at")) {
        return {
          rowCount: 1,
          rows: [
            {
              id: 1,
              processed_at: alreadyComplete ? new Date("2026-08-20T10:00:00.000Z") : null,
              status: alreadyComplete ? "Complete" : "Pending",
              user_id: 42,
              plan_code: "PAYG_10",
              amount: "29.50",
              currency_code: "ZAR",
            },
          ],
        };
      }
      return { rowCount: 1, rows: [] };
    },
    release() {
      calls.push({ sql: "RELEASE", params: [] });
    },
  };
  return { calls, pool: { connect: async () => client } };
}

test("Batch 17 valid live Ozow completion still applies the existing PAYG_10 plan flow", async () => {
  const db = livePaymentDb();
  const h = await harness({ dbPool: db.pool });
  try {
    const response = await postForm(h.url, webhookPayload());
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "OK");
    assert.equal(
      db.calls.some((call) => call.sql.startsWith("UPDATE users") && call.params[1] === "PAYG_10"),
      true
    );
    assert.equal(db.calls.some((call) => call.sql === "COMMIT"), true);
  } finally {
    await h.close();
  }
});

test("Batch 17 duplicate completed Ozow callback remains idempotent and does not apply credits twice", async () => {
  const db = livePaymentDb({ alreadyComplete: true });
  const h = await harness({ dbPool: db.pool });
  try {
    const response = await postForm(h.url, webhookPayload());
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "OK");
    assert.equal(db.calls.some((call) => call.sql.startsWith("UPDATE users")), false);
  } finally {
    await h.close();
  }
});
