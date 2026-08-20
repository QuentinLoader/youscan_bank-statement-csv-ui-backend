import assert from "node:assert/strict";
import test from "node:test";

import { shapeBillingStatus } from "../../services/billingStatus.service.js";

test("Batch 19 billing status preserves FREE lifetime remaining", () => {
  const status = shapeBillingStatus({
    plan_code: "FREE",
    lifetime_parses_used: 12,
    subscription_status: "inactive",
  });
  assert.equal(status.lifetime_remaining, 3);
  assert.equal(status.credits_remaining, null);
  assert.equal(status.subscription_status, "active");
});

test("Batch 19 billing status preserves PAYG credits", () => {
  const status = shapeBillingStatus({ plan_code: "PAYG_10", credits_remaining: 7 });
  assert.equal(status.credits_remaining, 7);
  assert.equal(status.subscription_status, "active");
});

test("Batch 19 Monthly 25 status expires at renewal date even if stale credits remain", () => {
  const status = shapeBillingStatus(
    {
      plan_code: "MONTHLY_25",
      credits_remaining: 9,
      subscription_status: "active",
      renewal_date: "2026-08-01T00:00:00.000Z",
    },
    { now: new Date("2026-08-20T00:00:00.000Z") }
  );
  assert.equal(status.credits_remaining, 9);
  assert.equal(status.subscription_status, "expired");
});

test("Batch 19 Pro status remains active only with an active future renewal", () => {
  const active = shapeBillingStatus(
    { plan_code: "PRO_YEAR_UNLIMITED", subscription_status: "active", renewal_date: "2027-08-20T00:00:00.000Z" },
    { now: new Date("2026-08-20T00:00:00.000Z") }
  );
  assert.equal(active.subscription_status, "active");

  const expired = shapeBillingStatus(
    { plan_code: "PRO_YEAR_UNLIMITED", subscription_status: "active", renewal_date: "2026-08-01T00:00:00.000Z" },
    { now: new Date("2026-08-20T00:00:00.000Z") }
  );
  assert.equal(expired.subscription_status, "expired");
});
