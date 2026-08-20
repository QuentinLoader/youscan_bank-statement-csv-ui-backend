import assert from "node:assert/strict";
import test from "node:test";
import express from "express";

import { fingerprintDeterministicCanonical } from "../ai/extraction/correctionProposal.js";
import { createReviewCrypto } from "../review/crypto.js";
import { createMemoryReviewRepository } from "../review/memoryRepository.js";
import { createReviewRouter } from "../review/review.routes.js";
import { createReviewService } from "../review/reviewService.js";

function canonical() {
  return {
    bankName: "FNB",
    accountNumber: "62123456789",
    clientName: "Synthetic Customer",
    statementPeriodStart: "01/07/2026",
    statementPeriodEnd: "31/07/2026",
    openingBalance: 1000,
    closingBalance: 900,
    transactions: [
      { date: "01/07/2026", description: "EFT INV-7781", amount: -100, balance: 900 },
    ],
  };
}

function parseResult() {
  const data = canonical();
  return {
    jobId: "job-api-b16",
    result: { data },
    aiCorrectionProposal: {
      proposalId: "proposal-api-b16",
      mode: "human_review",
      status: "pending_review",
      authoritativeSource: "deterministic",
      deterministicFingerprint: fingerprintDeterministicCanonical(data),
      decisionOutcome: "review_ai_difference",
      decisionRisk: "medium",
      shadowStatus: "differences",
      requiresExplicitReview: true,
      aiCanAutoApply: false,
      applicationAuthorized: false,
      applied: false,
      itemCount: 1,
      reviewedItemCount: 0,
      acceptedAiItemCount: 0,
      retainedDeterministicItemCount: 0,
      items: [
        {
          itemId: "transaction:0:description",
          scope: "transaction",
          rowIndex: 0,
          field: "description",
          risk: "medium",
          currentValue: "EFT INV-7781",
          proposedValue: "EFT",
          reviewStatus: "pending",
          review: null,
        },
      ],
    },
  };
}

async function makeHarness() {
  const repository = createMemoryReviewRepository();
  const reviewCrypto = createReviewCrypto({ key: Buffer.alloc(32, 9) });
  let seq = 0;
  const service = createReviewService({
    repository,
    reviewCrypto,
    now: () => "2026-08-20T12:00:00.000Z",
    idFactory: () => `10000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`,
  });

  const fakeAuthenticate = (req, res, next) => {
    const header = String(req.headers.authorization || "");
    if (!header.startsWith("Bearer ")) {
      return res.status(401).json({ message: "No token provided" });
    }
    req.user = { userId: header.slice("Bearer ".length) };
    next();
  };

  const app = express();
  app.use(express.json());
  app.use("/api/v2/reviews", createReviewRouter({
    authenticate: fakeAuthenticate,
    getService: () => service,
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}/api/v2/reviews`;

  return {
    service,
    base,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function auth(userId = "user-1") {
  return { Authorization: `Bearer ${userId}`, "Content-Type": "application/json" };
}

test("Batch 16 review API requires authentication", async () => {
  const h = await makeHarness();
  try {
    const response = await fetch(h.base);
    assert.equal(response.status, 401);
  } finally {
    await h.close();
  }
});

test("Batch 16 review API lists only the authenticated user's privacy-safe cases", async () => {
  const h = await makeHarness();
  try {
    await h.service.createCaseFromParseResult({ userId: "user-1", parseResult: parseResult() });
    await h.service.createCaseFromParseResult({ userId: "user-2", parseResult: parseResult() });

    const response = await fetch(h.base, { headers: auth("user-1") });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.cases.length, 1);
    const serialized = JSON.stringify(body);
    assert.equal(serialized.includes("62123456789"), false);
    assert.equal(serialized.includes("INV-7781"), false);
  } finally {
    await h.close();
  }
});

test("Batch 16 review API returns sensitive comparison values only on authenticated case detail", async () => {
  const h = await makeHarness();
  try {
    const created = await h.service.createCaseFromParseResult({ userId: "user-1", parseResult: parseResult() });
    const response = await fetch(`${h.base}/${created.caseId}`, { headers: auth("user-1") });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.proposal.items[0].currentValue, "EFT INV-7781");

    const forbiddenByOwnership = await fetch(`${h.base}/${created.caseId}`, { headers: auth("user-2") });
    assert.equal(forbiddenByOwnership.status, 404);
  } finally {
    await h.close();
  }
});

test("Batch 16 review API records explicit item decisions using JWT identity", async () => {
  const h = await makeHarness();
  try {
    const created = await h.service.createCaseFromParseResult({ userId: "user-1", parseResult: parseResult() });
    const response = await fetch(`${h.base}/${created.caseId}/decisions`, {
      method: "POST",
      headers: auth("user-1"),
      body: JSON.stringify({
        reviewerId: "attacker-supplied-id",
        decisions: [{ itemId: "transaction:0:description", action: "retain_deterministic" }],
      }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status, "reviewed");
    assert.equal(body.proposal.items[0].review.reviewerId, "user-1");
    assert.equal(body.proposal.applicationAuthorized, false);
    assert.equal(body.proposal.applied, false);
  } finally {
    await h.close();
  }
});

test("Batch 16 review API exposes a privacy-safe audit trail", async () => {
  const h = await makeHarness();
  try {
    const created = await h.service.createCaseFromParseResult({ userId: "user-1", parseResult: parseResult() });
    await fetch(`${h.base}/${created.caseId}/decisions`, {
      method: "POST",
      headers: auth("user-1"),
      body: JSON.stringify({
        decisions: [{ itemId: "transaction:0:description", action: "accept_ai" }],
      }),
    });

    const response = await fetch(`${h.base}/${created.caseId}/audit`, { headers: auth("user-1") });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.events.length, 2);
    const serialized = JSON.stringify(body);
    assert.equal(serialized.includes("62123456789"), false);
    assert.equal(serialized.includes("INV-7781"), false);
    assert.equal(serialized.includes('"action":"accept_ai"'), true);
  } finally {
    await h.close();
  }
});

test("Batch 16 review API rejects attempts to change an already-reviewed item", async () => {
  const h = await makeHarness();
  try {
    const created = await h.service.createCaseFromParseResult({ userId: "user-1", parseResult: parseResult() });
    const url = `${h.base}/${created.caseId}/decisions`;
    const first = await fetch(url, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ decisions: [{ itemId: "transaction:0:description", action: "accept_ai" }] }),
    });
    assert.equal(first.status, 200);

    const second = await fetch(url, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ decisions: [{ itemId: "transaction:0:description", action: "retain_deterministic" }] }),
    });
    assert.equal(second.status, 409);
    const body = await second.json();
    assert.equal(body.error, "V2_REVIEW_ITEM_ALREADY_DECIDED");
  } finally {
    await h.close();
  }
});

test("Batch 16 review API has no apply endpoint", async () => {
  const h = await makeHarness();
  try {
    const created = await h.service.createCaseFromParseResult({ userId: "user-1", parseResult: parseResult() });
    const response = await fetch(`${h.base}/${created.caseId}/apply`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 404);
  } finally {
    await h.close();
  }
});

test("Batch 16 review API returns 404 for another user's audit trail", async () => {
  const h = await makeHarness();
  try {
    const created = await h.service.createCaseFromParseResult({ userId: "user-1", parseResult: parseResult() });
    const response = await fetch(`${h.base}/${created.caseId}/audit`, { headers: auth("user-2") });
    assert.equal(response.status, 404);
  } finally {
    await h.close();
  }
});
