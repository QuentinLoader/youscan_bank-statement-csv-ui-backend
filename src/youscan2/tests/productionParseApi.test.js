import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import express from "express";

import { createV2ParseRouter } from "../api/parse.routes.js";

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

function completedResult({ proposal = null } = {}) {
  return {
    jobId: "job-b17",
    status: "completed",
    classification: {
      documentType: "bank_statement",
      documentSubtype: "fnb",
      supported: true,
      confidence: 0.99,
      source: "heuristic",
      needsReview: false,
    },
    result: {
      jobId: "job-b17",
      data: canonical(),
      issues: [],
      status: "completed",
      validationStatus: "passed",
      validationScore: 1,
    },
    extractionMeta: { sourceType: "pdf", pages: 1 },
    shadowAi: proposal
      ? { mode: "shadow", status: "differences", authoritativeSource: "deterministic" }
      : null,
    aiDecision: proposal
      ? { outcome: "review_ai_difference", risk: "medium", authoritativeSource: "deterministic" }
      : null,
    aiCorrectionProposal: proposal,
  };
}

function proposal() {
  return {
    proposalId: "proposal-b17",
    mode: "human_review",
    status: "pending_review",
    authoritativeSource: "deterministic",
    decisionOutcome: "review_ai_difference",
    decisionRisk: "medium",
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
      },
    ],
  };
}

async function makeHarness({ runJob, consumeEntitlement, getReviewService } = {}) {
  const authenticate = (req, res, next) => {
    if (!String(req.headers.authorization || "").startsWith("Bearer ")) {
      return res.status(401).json({ message: "No token provided" });
    }
    req.user = { userId: "42" };
    next();
  };
  const checkAccess = (req, res, next) => {
    req.userRecord = { id: 42, plan_code: "PAYG_10" };
    next();
  };
  const limiter = (req, res, next) => next();

  const app = express();
  app.use(
    "/api/v2/parse",
    createV2ParseRouter({
      authenticate,
      checkAccess,
      limiter,
      extractText: async () => ({ text: "synthetic", meta: { sourceType: "text", pages: 1 } }),
      runJob: runJob || (async () => completedResult()),
      consumeEntitlement:
        consumeEntitlement ||
        (async () => ({ planCode: "PAYG_10", creditsDeducted: 1, remaining: 8, usageAction: "parse_statement_v2" })),
      getReviewService:
        getReviewService ||
        (() => ({ createCaseFromParseResult: async () => null })),
    })
  );

  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/api/v2/parse`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function oneFileForm(name = "statement.pdf") {
  const form = new FormData();
  form.append("files", new Blob(["synthetic"], { type: "application/pdf" }), name);
  return form;
}

function headers() {
  return { Authorization: "Bearer synthetic-token" };
}

test("Batch 17 V2 production parse API requires authentication", async () => {
  const h = await makeHarness();
  try {
    const response = await fetch(h.url, { method: "POST", body: oneFileForm() });
    assert.equal(response.status, 401);
  } finally {
    await h.close();
  }
});

test("Batch 17 V2 production parse API returns canonical data and charges exactly once", async () => {
  let consumed = 0;
  const h = await makeHarness({
    consumeEntitlement: async ({ userId }) => {
      consumed += 1;
      assert.equal(userId, "42");
      return { planCode: "PAYG_10", creditsDeducted: 1, remaining: 7, usageAction: "parse_statement_v2" };
    },
  });
  try {
    const form = new FormData();
    form.append("files", new Blob(["a"], { type: "application/pdf" }), "a.pdf");
    form.append("files", new Blob(["b"], { type: "application/pdf" }), "b.pdf");
    const response = await fetch(h.url, { method: "POST", headers: headers(), body: form });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.engine, "youscan-v2");
    assert.equal(body.authoritativeSource, "deterministic");
    assert.equal(body.fileCount, 2);
    assert.equal(body.transactions.length, 2);
    assert.deepEqual(body.transactions.map((row) => row.sourceFile), ["a.pdf", "b.pdf"]);
    assert.equal(body.billing.creditsDeducted, 1);
    assert.equal(consumed, 1);
  } finally {
    await h.close();
  }
});

test("Batch 17 failed or unsupported V2 results never consume a credit", async () => {
  let consumed = 0;
  const h = await makeHarness({
    runJob: async () => ({ status: "unsupported", message: "Unsupported" }),
    consumeEntitlement: async () => {
      consumed += 1;
      return {};
    },
  });
  try {
    const response = await fetch(h.url, { method: "POST", headers: headers(), body: oneFileForm() });
    assert.equal(response.status, 400);
    assert.equal(consumed, 0);
  } finally {
    await h.close();
  }
});

test("Batch 17 classification review with no canonical result is not billable", async () => {
  let consumed = 0;
  const h = await makeHarness({
    runJob: async () => ({ status: "needs_review", result: null }),
    consumeEntitlement: async () => {
      consumed += 1;
      return {};
    },
  });
  try {
    const response = await fetch(h.url, { method: "POST", headers: headers(), body: oneFileForm() });
    assert.equal(response.status, 422);
    const body = await response.json();
    assert.equal(body.error, "V2_REVIEW_REQUIRED_BEFORE_PARSE");
    assert.equal(consumed, 0);
  } finally {
    await h.close();
  }
});

test("Batch 17 AI proposal values are never returned by the normal parse response", async () => {
  const sensitiveProposal = proposal();
  const h = await makeHarness({
    runJob: async () => completedResult({ proposal: sensitiveProposal }),
    getReviewService: () => ({
      createCaseFromParseResult: async ({ userId }) => {
        assert.equal(userId, "42");
        return { caseId: "case-b17" };
      },
    }),
  });
  try {
    const response = await fetch(h.url, { method: "POST", headers: headers(), body: oneFileForm() });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.files[0].review.caseId, "case-b17");
    assert.equal(body.files[0].review.persisted, true);
    assert.equal(body.files[0].review.reviewTargets[0].field, "description");
    const serialized = JSON.stringify(body);
    assert.equal(serialized.includes('"proposedValue":"EFT"'), false);
    assert.equal(serialized.includes('"currentValue"'), false);
    assert.equal(serialized.includes('"aiCorrectionProposal"'), false);
  } finally {
    await h.close();
  }
});

test("Batch 17 temporary review persistence failure cannot mutate or suppress a successful deterministic parse", async () => {
  let consumed = 0;
  const h = await makeHarness({
    runJob: async () => completedResult({ proposal: proposal() }),
    consumeEntitlement: async () => {
      consumed += 1;
      return { planCode: "PAYG_10", creditsDeducted: 1, remaining: 6, usageAction: "parse_statement_v2" };
    },
    getReviewService: () => {
      const error = new Error("store unavailable");
      error.code = "V2_REVIEW_STORE_UNAVAILABLE";
      throw error;
    },
  });
  try {
    const response = await fetch(h.url, { method: "POST", headers: headers(), body: oneFileForm() });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(consumed, 1);
    assert.equal(body.files[0].result.data.bankName, "FNB");
    assert.equal(body.files[0].review.persisted, false);
    assert.equal(body.authoritativeSource, "deterministic");
  } finally {
    await h.close();
  }
});

test("Batch 17 removes the unauthenticated debug-text V2 test route from legacy /parse", () => {
  const source = fs.readFileSync(new URL("../../routes/parse.js", import.meta.url), "utf8");
  assert.equal(source.includes("test-youscan2"), false);
  assert.equal(source.includes("debugTextPreview"), false);
  assert.equal(source.includes("parseStatement"), true);
});
