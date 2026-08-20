import assert from "node:assert/strict";
import test from "node:test";
import express from "express";

import { createAdminRouter } from "../../routes/admin.js";

function fakePool({ email = "admin@example.test", reviewTable = true } = {}) {
  return {
    async query(sql) {
      const text = String(sql).replace(/\s+/g, " ");
      if (text.includes("SELECT email FROM users")) return { rows: [{ email }] };
      if (text.includes("successful_payments_last_14_days")) {
        return { rows: [{ total_users: 10, successful_payments_last_14_days: 2, free_users: 5 }] };
      }
      if (text.includes("to_regclass")) {
        return { rows: [{ review_cases_table: reviewTable ? "youscan_v2_review_cases" : null }] };
      }
      if (text.includes("parse_statement_v2")) {
        return { rows: [{ v2_parse_requests_last_14_days: 7, v2_parse_requests_previous_14_days: 3 }] };
      }
      if (text.includes("FROM youscan_v2_review_cases")) {
        return {
          rows: [{
            v2_review_cases_total: 4,
            v2_review_cases_pending: 2,
            v2_review_cases_partially_reviewed: 1,
            v2_review_cases_reviewed: 1,
          }],
        };
      }
      throw new Error(`Unexpected query: ${text}`);
    },
  };
}

async function harness({ email = "admin@example.test", adminEmails = "admin@example.test", reviewTable = true } = {}) {
  const authenticate = (req, res, next) => {
    req.user = { userId: 42 };
    next();
  };
  const app = express();
  app.use(
    "/api/admin",
    createAdminRouter({
      dbPool: fakePool({ email, reviewTable }),
      authenticate,
      env: { YOUSCAN_ADMIN_EMAILS: adminEmails },
    })
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/api/admin/metrics`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test("Batch 17 admin metrics retain commercial metrics and add V2 parse/review metrics", async () => {
  const h = await harness();
  try {
    const response = await fetch(h.url);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.total_users, 10);
    assert.equal(body.successful_payments_last_14_days, 2);
    assert.equal(body.v2_parse_requests_last_14_days, 7);
    assert.equal(body.v2_review_cases_total, 4);
    assert.equal(body.v2_review_cases_pending, 2);
  } finally {
    await h.close();
  }
});

test("Batch 17 admin metrics tolerate a database where V2 review tables are not yet migrated", async () => {
  const h = await harness({ reviewTable: false });
  try {
    const response = await fetch(h.url);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.v2_review_cases_total, 0);
    assert.equal(body.v2_review_cases_pending, 0);
  } finally {
    await h.close();
  }
});

test("Batch 17 admin access remains allowlist protected", async () => {
  const h = await harness({ email: "user@example.test", adminEmails: "admin@example.test" });
  try {
    const response = await fetch(h.url);
    assert.equal(response.status, 403);
  } finally {
    await h.close();
  }
});
