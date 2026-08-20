import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { changePasswordForUser, resendVerificationForUser } from "../../services/account.service.js";
import { configuredAdminEmails, isAdminEmail } from "../../utils/adminAccess.js";

function accountDb(user) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      const text = String(sql).replace(/\s+/g, " ").trim();
      calls.push({ sql: text, params });
      if (text.startsWith("SELECT id, password_hash")) return { rows: [user], rowCount: 1 };
      if (text.startsWith("SELECT id, email, is_verified")) return { rows: [user], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
  };
}

test("Batch 19 change-password requires the current password and hashes the replacement", async () => {
  const db = accountDb({ id: 42, password_hash: "old-hash" });
  const bcryptImpl = {
    async compare(value, hash) {
      if (hash !== "old-hash") return false;
      return value === "correct-current";
    },
    async hash(value, rounds) {
      assert.equal(value, "new-password-123");
      assert.equal(rounds, 10);
      return "new-hash";
    },
  };
  await changePasswordForUser({
    userId: 42,
    currentPassword: "correct-current",
    newPassword: "new-password-123",
    dbPool: db,
    bcryptImpl,
  });
  assert.equal(db.calls.some((call) => call.sql.startsWith("UPDATE users SET password_hash") && call.params[0] === "new-hash"), true);
});

test("Batch 19 change-password rejects a wrong current password", async () => {
  const db = accountDb({ id: 42, password_hash: "old-hash" });
  await assert.rejects(
    changePasswordForUser({
      userId: 42,
      currentPassword: "wrong",
      newPassword: "new-password-123",
      dbPool: db,
      bcryptImpl: { compare: async () => false, hash: async () => assert.fail("hash must not run") },
    }),
    (error) => error.code === "CURRENT_PASSWORD_INVALID"
  );
});

test("Batch 19 resend-verification is idempotent for an already verified user", async () => {
  const db = accountDb({ id: 42, email: "user@example.test", is_verified: true });
  let sent = 0;
  const result = await resendVerificationForUser({
    userId: 42,
    dbPool: db,
    sendEmail: async () => { sent += 1; },
  });
  assert.equal(result.alreadyVerified, true);
  assert.equal(sent, 0);
});

test("Batch 19 resend-verification rotates the token and sends a new email", async () => {
  const db = accountDb({ id: 42, email: "user@example.test", is_verified: false });
  let sent = null;
  const result = await resendVerificationForUser({
    userId: 42,
    dbPool: db,
    randomBytes: () => Buffer.alloc(32, 7),
    sendEmail: async (email, token) => { sent = { email, token }; },
  });
  assert.equal(result.alreadyVerified, false);
  assert.equal(sent.email, "user@example.test");
  assert.equal(typeof sent.token, "string");
  assert.equal(sent.token.length, 64);
  assert.equal(db.calls.some((call) => call.sql.startsWith("UPDATE users SET verification_token")), true);
});

test("Batch 19 server-side admin authority supports configured multiple admin emails", () => {
  const env = { YOUSCAN_ADMIN_EMAILS: "one@example.test, Two@Example.test" };
  assert.deepEqual([...configuredAdminEmails(env)], ["one@example.test", "two@example.test"]);
  assert.equal(isAdminEmail("TWO@example.test", env), true);
  assert.equal(isAdminEmail("other@example.test", env), false);
});

test("Batch 19 frontend-required auth and billing endpoints are present in active route sources", () => {
  const auth = fs.readFileSync(new URL("../../routes/auth.routes.js", import.meta.url), "utf8");
  const billing = fs.readFileSync(new URL("../../routes/ozow.payment.routes.js", import.meta.url), "utf8");
  assert.equal(auth.includes('router.post("/resend-verification"'), true);
  assert.equal(auth.includes('router.post("/change-password"'), true);
  assert.equal(billing.includes('router.get("/status"'), true);
});
