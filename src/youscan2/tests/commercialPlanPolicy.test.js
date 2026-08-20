import assert from "node:assert/strict";
import test from "node:test";

import { PRICING } from "../../config/pricing.js";
import {
  ParseEntitlementError,
  consumeSuccessfulV2Parse,
  evaluateParseEntitlement,
} from "../commercial/parseEntitlement.js";

test("Batch 17 preserves existing YouScan plan codes and prices", () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(PRICING.PLANS).map(([key, plan]) => [key, plan.price_cents])),
    { FREE: 0, PAYG_10: 2950, MONTHLY_25: 4850, PRO_YEAR_UNLIMITED: 48500 }
  );
});

test("Batch 17 FREE remains a 15-use lifetime parse entitlement", () => {
  assert.equal(evaluateParseEntitlement({ plan_code: "FREE", lifetime_parses_used: 14 }).mutation, "increment_lifetime");
  assert.throws(
    () => evaluateParseEntitlement({ plan_code: "FREE", lifetime_parses_used: 15 }),
    (error) => error instanceof ParseEntitlementError && error.code === "FREE_LIMIT_REACHED"
  );
});

test("Batch 19 PAYG_10 consumes one successful parse credit", () => {
  const decision = evaluateParseEntitlement({ plan_code: "PAYG_10", credits_remaining: 1 });
  assert.equal(decision.creditsDeducted, 1);
  assert.equal(decision.mutation, "decrement_credit");
});

test("Batch 19 MONTHLY_25 consumes credits only while the subscription is active", () => {
  const now = new Date("2026-08-20T00:00:00.000Z");
  const active = evaluateParseEntitlement(
    { plan_code: "MONTHLY_25", credits_remaining: 3, subscription_status: "active", renewal_date: "2026-09-20T00:00:00.000Z" },
    { now }
  );
  assert.equal(active.creditsDeducted, 1);
  assert.throws(
    () => evaluateParseEntitlement(
      { plan_code: "MONTHLY_25", credits_remaining: 3, subscription_status: "active", renewal_date: "2026-08-01T00:00:00.000Z" },
      { now }
    ),
    (error) => error.code === "SUBSCRIPTION_EXPIRED"
  );
});

test("Batch 17 PRO_YEAR_UNLIMITED remains unlimited only while active", () => {
  const active = evaluateParseEntitlement(
    { plan_code: "PRO_YEAR_UNLIMITED", subscription_status: "active", renewal_date: "2026-09-20T00:00:00.000Z" },
    { now: new Date("2026-08-20T00:00:00.000Z") }
  );
  assert.equal(active.creditsDeducted, 0);
  assert.throws(
    () => evaluateParseEntitlement(
      { plan_code: "PRO_YEAR_UNLIMITED", subscription_status: "active", renewal_date: "2026-08-01T00:00:00.000Z" },
      { now: new Date("2026-08-20T00:00:00.000Z") }
    ),
    (error) => error.code === "SUBSCRIPTION_EXPIRED"
  );
});

function fakeDb(user) {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      const normalized = String(sql).replace(/\s+/g, " ").trim();
      calls.push({ sql: normalized, params });
      if (normalized.startsWith("SELECT id, plan_code")) return { rows: [structuredClone(user)], rowCount: 1 };
      if (normalized.startsWith("UPDATE users") && normalized.includes("credits_remaining = credits_remaining - 1")) {
        return { rows: [{ credits_remaining: Number(user.credits_remaining) - 1 }], rowCount: 1 };
      }
      if (normalized.startsWith("UPDATE users") && normalized.includes("lifetime_parses_used = lifetime_parses_used + 1")) {
        return { rows: [{ lifetime_parses_used: Number(user.lifetime_parses_used || 0) + 1 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    },
    release() { calls.push({ sql: "RELEASE", params: [] }); },
  };
  return { calls, pool: { connect: async () => client } };
}

test("Batch 17 successful V2 consumption is atomic and logs parse_statement_v2", async () => {
  const db = fakeDb({ id: 42, plan_code: "PAYG_10", credits_remaining: 3, lifetime_parses_used: 0 });
  const result = await consumeSuccessfulV2Parse({ userId: 42, ipAddress: "127.0.0.1", dbPool: db.pool });
  assert.equal(result.creditsDeducted, 1);
  assert.equal(result.remaining, 2);
  assert.equal(result.usageAction, "parse_statement_v2");
  assert.equal(db.calls[0].sql, "BEGIN");
  assert.equal(db.calls.some((call) => call.sql.startsWith("INSERT INTO usage_logs") && call.params[1] === "parse_statement_v2"), true);
  assert.equal(db.calls.some((call) => call.sql === "COMMIT"), true);
});
