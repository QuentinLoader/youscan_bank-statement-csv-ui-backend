import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import express from "express";

import { createPaystackWebhookRouter } from "../../webhooks/paystack.webhook.js";
import { createBillingRouter } from "../../routes/billing.routes.js";
import {
  computePaystackSignature,
  safePaystackEventSummary,
  timingSafeHexEqual,
  verifyPaystackWebhookSignature,
} from "../../utils/paystackSecurity.js";

const secretKey = "sk_test_synthetic_paystack_secret_key_for_unit_tests";

function createMockDb({ existingRows = [], userEmail = "customer@example.test" } = {}) {
  const calls = [];
  const state = {
    rows: existingRows.map((row) => ({ ...row })),
  };

  async function runQuery(sql, params = []) {
    const text = String(sql).replace(/\s+/g, " ").trim();
    calls.push({ sql: text, params });

    if (text === "BEGIN" || text === "COMMIT" || text === "ROLLBACK") {
      return { rows: [], rowCount: 0 };
    }
    if (text.startsWith("SELECT id, email FROM users")) {
      return { rows: [{ id: params[0], email: userEmail }], rowCount: 1 };
    }
    if (text.startsWith("SELECT id, processed_at, status, user_id")) {
      const match = state.rows.filter((r) => r.transaction_reference === params[0]);
      return { rows: match, rowCount: match.length };
    }
    if (text.startsWith("SELECT plan_code, status, processed_at FROM payment_transactions")) {
      const match = state.rows.filter(
        (r) => String(r.user_id) === String(params[0]) && r.transaction_reference === params[1]
      );
      return { rows: match, rowCount: match.length };
    }
    if (text.startsWith("INSERT INTO payment_transactions")) {
      const isInit = text.includes("access_code");
      if (isInit) {
        state.rows.push({
          id: state.rows.length + 1,
          transaction_reference: params[0],
          access_code: params[1],
          user_id: params[2],
          plan_code: params[3],
          amount_cents: params[4],
          currency_code: params[5],
          customer_email: params[6],
          status: "pending",
          processed_at: null,
        });
      } else {
        state.rows.push({
          id: state.rows.length + 1,
          transaction_reference: params[0],
          provider_transaction_id: params[1],
          authorization_code: params[2],
          user_id: params[3],
          plan_code: params[4],
          amount_cents: params[5],
          currency_code: params[6],
          channel: params[7],
          customer_email: params[8],
          status: params[9],
          processed_at: params[11],
        });
      }
      return { rows: [], rowCount: 1 };
    }
    if (text.startsWith("UPDATE payment_transactions SET processed_at")) {
      const row = state.rows.find((r) => r.transaction_reference === params[0]);
      if (row && !row.processed_at) row.processed_at = new Date();
      return { rows: [], rowCount: row ? 1 : 0 };
    }
    if (text.startsWith("UPDATE payment_transactions SET provider_transaction_id")) {
      const row = state.rows.find((r) => r.transaction_reference === params[0]);
      if (row) {
        row.provider_transaction_id = params[1] || row.provider_transaction_id;
        row.authorization_code = params[2] || row.authorization_code;
        row.status = params[3];
        if (["success", "failed", "abandoned", "reversed"].includes(params[3]) && !row.processed_at) {
          row.processed_at = new Date();
        }
      }
      return { rows: [], rowCount: row ? 1 : 0 };
    }
    return { rows: [], rowCount: 1 };
  }

  return {
    calls,
    state,
    query: runQuery,
    async connect() {
      return {
        query: runQuery,
        release() {},
      };
    },
  };
}

function chargeSuccessEvent(overrides = {}) {
  return {
    event: "charge.success",
    data: {
      id: 987654321,
      domain: "live",
      status: "success",
      reference: "42_PAYG_10_1700000000000",
      amount: 2950,
      currency: "ZAR",
      channel: "card",
      customer: { email: "customer@example.test" },
      authorization: {
        authorization_code: "AUTH_synthetic123",
        last4: "4081",
      },
      ...overrides,
    },
  };
}

async function startServer(mountPath, router, { jsonMiddleware = false } = {}) {
  const app = express();
  if (jsonMiddleware) app.use(express.json());
  app.use(mountPath, router);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test("Paystack HMAC-SHA512 signature is deterministic and rejects tampered payloads", () => {
  const raw = JSON.stringify(chargeSuccessEvent());
  const sig = computePaystackSignature(raw, secretKey);

  assert.equal(sig.length, 128);
  assert.equal(verifyPaystackWebhookSignature(raw, sig, secretKey), true);
  assert.equal(verifyPaystackWebhookSignature(raw + " ", sig, secretKey), false);
  assert.equal(verifyPaystackWebhookSignature(raw, "not-a-valid-hex", secretKey), false);
  assert.equal(timingSafeHexEqual(sig, sig.slice(0, -1) + (sig.endsWith("a") ? "b" : "a")), false);
});

test("Paystack safe event summary excludes secret key, card details, and customer email", () => {
  const summary = safePaystackEventSummary(chargeSuccessEvent());
  const serialized = JSON.stringify(summary);
  assert.equal(summary.event, "charge.success");
  assert.equal(summary.reference, "42_PAYG_10_1700000000000");
  assert.equal(serialized.includes("AUTH_synthetic123"), false);
  assert.equal(serialized.includes("4081"), false);
  assert.equal(serialized.includes("customer@example.test"), false);
});

test("Invalid Paystack webhook signature is rejected before any database access", async () => {
  const db = createMockDb();
  const silentLogger = { info() {}, warn() {}, error() {} };
  const server = await startServer(
    "/paystack",
    createPaystackWebhookRouter({ dbPool: db, env: { PAYSTACK_SECRET_KEY: secretKey }, logger: silentLogger })
  );

  try {
    const res = await fetch(`${server.baseUrl}/paystack/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-paystack-signature": "0".repeat(128),
      },
      body: JSON.stringify(chargeSuccessEvent()),
    });
    assert.equal(res.status, 401);
    assert.equal(await res.text(), "INVALID_SIGNATURE");
    assert.equal(db.calls.length, 0);
  } finally {
    await server.close();
  }
});

test("Verified Paystack test-mode webhook does not activate plans by default", async () => {
  const db = createMockDb();
  const silentLogger = { info() {}, warn() {}, error() {} };
  const server = await startServer(
    "/paystack",
    createPaystackWebhookRouter({
      dbPool: db,
      env: { PAYSTACK_SECRET_KEY: secretKey, PAYSTACK_ALLOW_TEST_PAYMENTS: "false" },
      logger: silentLogger,
    })
  );

  try {
    const body = JSON.stringify(chargeSuccessEvent({ domain: "test" }));
    const res = await fetch(`${server.baseUrl}/paystack/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-paystack-signature": computePaystackSignature(body, secretKey),
      },
      body,
    });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "TEST_IGNORED");
    assert.equal(db.calls.length, 0);
  } finally {
    await server.close();
  }
});

test("Amount mismatch in Paystack webhook is rejected before crediting user", async () => {
  const db = createMockDb();
  const silentLogger = { info() {}, warn() {}, error() {} };
  const server = await startServer(
    "/paystack",
    createPaystackWebhookRouter({ dbPool: db, env: { PAYSTACK_SECRET_KEY: secretKey }, logger: silentLogger })
  );

  try {
    const body = JSON.stringify(chargeSuccessEvent({ amount: 100 }));
    const res = await fetch(`${server.baseUrl}/paystack/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-paystack-signature": computePaystackSignature(body, secretKey),
      },
      body,
    });
    assert.equal(res.status, 400);
    assert.equal(await res.text(), "REJECTED");
    assert.equal(db.calls.some((c) => c.sql.startsWith("UPDATE users")), false);
  } finally {
    await server.close();
  }
});

test("Valid live Paystack charge.success applies PAYG_10 credits and duplicate webhook is idempotent", async () => {
  const db = createMockDb({
    existingRows: [
      {
        id: 1,
        transaction_reference: "42_PAYG_10_1700000000000",
        user_id: 42,
        plan_code: "PAYG_10",
        amount_cents: 2950,
        currency_code: "ZAR",
        status: "pending",
        processed_at: null,
      },
    ],
  });
  const silentLogger = { info() {}, warn() {}, error() {} };
  const server = await startServer(
    "/paystack",
    createPaystackWebhookRouter({ dbPool: db, env: { PAYSTACK_SECRET_KEY: secretKey }, logger: silentLogger })
  );

  try {
    const body = JSON.stringify(chargeSuccessEvent());
    const headers = {
      "Content-Type": "application/json",
      "x-paystack-signature": computePaystackSignature(body, secretKey),
    };

    const first = await fetch(`${server.baseUrl}/paystack/webhook`, { method: "POST", headers, body });
    assert.equal(first.status, 200);
    assert.equal(await first.text(), "OK");
    assert.equal(db.calls.filter((c) => c.sql.startsWith("UPDATE users")).length, 1);
    assert.equal(db.state.rows[0].authorization_code, "AUTH_synthetic123");

    const second = await fetch(`${server.baseUrl}/paystack/webhook`, { method: "POST", headers, body });
    assert.equal(second.status, 200);
    assert.equal(await second.text(), "OK");
    // Must not credit the user twice on replay.
    assert.equal(db.calls.filter((c) => c.sql.startsWith("UPDATE users")).length, 1);
  } finally {
    await server.close();
  }
});

test("Billing create-payment initializes Paystack checkout and verify fallback confirms pending transaction", async () => {
  const db = createMockDb();
  const silentLogger = { info() {}, warn() {}, error() {} };
  let initializedReference = null;

  const billingRouter = createBillingRouter({
    dbPool: db,
    env: {
      PAYSTACK_SECRET_KEY: secretKey,
      APP_URL: "https://youscan.addvision.co.za",
    },
    authenticate: (req, _res, next) => {
      req.user = { userId: 42 };
      next();
    },
    initializeTransaction: async ({ email, amountCents, currency, reference, callbackUrl }) => {
      assert.equal(email, "customer@example.test");
      assert.equal(amountCents, 4850);
      assert.equal(currency, "ZAR");
      assert.equal(callbackUrl, "https://youscan.addvision.co.za/payment-return");
      initializedReference = reference;
      return {
        authorizationUrl: "https://checkout.paystack.com/synthetic-access",
        accessCode: "acc_synthetic",
        reference,
      };
    },
    verifyTransaction: async ({ reference }) => ({
      id: 555111,
      domain: "live",
      status: "success",
      reference,
      amount: 4850,
      currency: "ZAR",
      channel: "card",
      customer: { email: "customer@example.test" },
      authorization: { authorization_code: "AUTH_monthly123" },
    }),
    logger: silentLogger,
  });

  const server = await startServer("/billing", billingRouter, { jsonMiddleware: true });
  try {
    const createRes = await fetch(`${server.baseUrl}/billing/create-payment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planCode: "MONTHLY_25" }),
    });
    assert.equal(createRes.status, 200);
    const created = await createRes.json();
    assert.equal(created.authorization_url, "https://checkout.paystack.com/synthetic-access");
    assert.equal(created.reference, initializedReference);

    const statusRes = await fetch(
      `${server.baseUrl}/billing/payment-status?reference=${encodeURIComponent(initializedReference)}`
    );
    assert.equal(statusRes.status, 200);
    const statusBody = await statusRes.json();
    assert.deepEqual(statusBody, { confirmed: true, plan_code: "MONTHLY_25" });
    assert.equal(db.calls.filter((c) => c.sql.startsWith("UPDATE users")).length, 1);
  } finally {
    await server.close();
  }
});
