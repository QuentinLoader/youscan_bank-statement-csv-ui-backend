import assert from "node:assert/strict";
import test from "node:test";
import { shapeBillingStatus, getPaymentConfirmation } from "../../services/billingStatus.service.js";
import { evaluateParseEntitlement, consumeSuccessfulV2Parse } from "../commercial/parseEntitlement.js";
import { PRICING } from "../../config/pricing.js";

const now = new Date("2026-10-06T12:00:00Z");
for (const plan of ["MONTHLY_25", "PRO_YEAR_UNLIMITED"]) {
  test(`${plan} fails closed at expiry, missing/invalid expiry or inactive payment status, without free fallback`, async () => {
    for (const patch of [
      { renewal_date: now.toISOString() }, { renewal_date: null }, { renewal_date: "invalid" },
      { renewal_date: "2027-10-06T12:00:00Z", subscription_status: "inactive" },
    ]) {
      const user = { id: 42, plan_code: plan, credits_remaining: 9, lifetime_parses_used: 4,
        subscription_status: "active", renewal_date: "2027-10-06T12:00:00Z", ...patch };
      const before = structuredClone(user);
      const billing = shapeBillingStatus(user, { now });
      assert.equal(billing.subscription_status, "expired");
      assert.equal(billing.plan_code, plan);
      assert.equal(billing.lifetime_remaining, null);
      assert.deepEqual(user, before);
      assert.throws(() => evaluateParseEntitlement(user, { now }), e => e.code === "SUBSCRIPTION_EXPIRED");
      const calls = [];
      const client = { query: async sql => { calls.push(sql); return { rows: [user], rowCount: 1 }; }, release() {} };
      await assert.rejects(consumeSuccessfulV2Parse({ userId: 42, now, dbPool: { connect: async () => client } }),
        e => e.code === "SUBSCRIPTION_EXPIRED");
      assert.equal(calls.some(sql => sql.includes("UPDATE users")), false);
      assert.equal(calls.includes("ROLLBACK"), true);
    }
    assert.equal(PRICING.PLANS[plan].recurring, false);
    assert.equal(PRICING.PLANS[plan].renewal, "manual");
  });
}

test("payment confirmation requires an owned, completed and processed transaction", async () => {
  for (const payment of [undefined, { status: "Pending" }, { status: "Failed" },
    { status: "Cancelled" }, { status: "Complete", processed_at: null },
    { status: "Complete", processed_at: now }]) {
    const calls = [];
    const result = await getPaymentConfirmation({ userId: 42, reference: "synthetic", dbPool: {
      query: async (sql, params) => { calls.push({ sql, params }); return { rows: payment ? [{ ...payment, plan_code: "MONTHLY_25" }] : [] }; },
    } });
    assert.equal(result.confirmed, Boolean(payment?.status === "Complete" && payment.processed_at));
    assert.match(calls[0].sql, /WHERE user_id = \$1 AND transaction_reference = \$2/);
    assert.deepEqual(calls[0].params, [42, "synthetic"]);
  }
  await assert.rejects(getPaymentConfirmation({ userId: 42 }), e => e.code === "PAYMENT_REFERENCE_REQUIRED");
});

test("PAYG does not expire with a historic subscription date or status", () => {
  const user = { plan_code: "PAYG_10", credits_remaining: 9, subscription_status: "expired", renewal_date: now.toISOString() };
  assert.equal(shapeBillingStatus(user, { now }).subscription_status, "active");
  assert.equal(evaluateParseEntitlement(user, { now }).planCode, "PAYG_10");
});
