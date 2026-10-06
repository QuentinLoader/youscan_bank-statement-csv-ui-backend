import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import express from "express";

import { createV2ParseRouter } from "../api/parse.routes.js";
import { createAnalysisAvailability, analysisUnavailableError, ANALYSIS_UNAVAILABLE_MESSAGE } from "../ai/availability.js";
import { AiError } from "../ai/errors.js";
import { runParseJob } from "../orchestrator/runParseJob.js";
import { getAiConfig } from "../ai/config.js";
import { AI_BANK_STATEMENT_SOURCE_TEXT, makeValidAiBankStatementCandidate } from "./fixtures/aiBankStatementExtraction.fixture.js";
import { makeShadowAiEnvelope } from "./fixtures/aiBankStatementShadow.fixture.js";

test("production API exposes only the assessed AI candidate and AI provenance", async () => {
  const config = getAiConfig({ YOUSCAN_V2_AI_ENABLED: "true", YOUSCAN_V2_AI_EXTRACTION_ENABLED: "true",
    YOUSCAN_V2_AI_PROVIDER: "openai", YOUSCAN_V2_AI_MODEL: "synthetic" });
  const candidate = makeValidAiBankStatementCandidate();
  const h = await makeHarness({ runJob: (args) => runParseJob({ ...args,
    extractedText: AI_BANK_STATEMENT_SOURCE_TEXT,
    aiOptions: { config, provider: { name: "mock", generateStructured: async () => ({
      content: JSON.stringify(makeShadowAiEnvelope(candidate)), requestId: "synthetic",
    }) } },
  }) });
  try {
    const response = await fetch(h.url, { method: "POST", headers: headers(), body: oneFileForm() });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.authoritativeSource, "ai");
    assert.equal(body.files[0].authoritativeSource, "ai");
    assert.equal(body.files[0].result.authoritativeSource, "ai");
    assert.equal(body.files[0].classification.source, "ai");
    assert.equal(body.files[0].result.data.transactions[0].description, candidate.transactions[0].description.value);
    assert.equal(body.files[0].review, null);
    assert.equal(body.files[0].ai.mode, undefined);
    assert.equal(body.billing.creditsDeducted, 0);
  } finally { await h.close(); }
});

test("production rejects a legacy deterministic result even after successful shadow AI", async () => {
  const h = await makeHarness({ runJob: async () => ({ ...completedResult(),
    authoritativeSource: "deterministic", result: { ...completedResult().result, authoritativeSource: "deterministic" },
  }) });
  try {
    const response = await fetch(h.url, { method: "POST", headers: headers(), body: oneFileForm() });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).transactions, undefined);
  } finally { await h.close(); }
});

test('production rejects batches larger than three before extracting any file', async () => {
  let jobs = 0;
  const h = await makeHarness({ runJob: async () => { jobs++; return completedResult(); } });
  try {
    const form = oneFileForm();
    for (let i = 0; i < 3; i++) form.append('files', new Blob(['synthetic'], { type: 'application/pdf' }), `statement-${i}.pdf`);
    const response = await fetch(h.url, { method: 'POST', headers: headers(), body: form });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, 'V2_BATCH_LIMIT');
    assert.equal(jobs, 0);
  } finally { await h.close(); }
});

test("availability endpoint authenticates, caches checks, and exposes only customer status", async () => {
  let probes = 0;
  const availability = createAnalysisAvailability({
    probe: async () => { probes++; throw new AiError("V2_AI_PROVIDER_FAILED", "private", {
      details: { status: 429, providerCode: "insufficient_quota" },
    }); }, logger: () => {},
  });
  const h = await makeHarness({ availability });
  try {
    assert.equal((await fetch(`${h.url}/availability`)).status, 401);
    assert.equal(probes, 0);
    for (let i = 0; i < 3; i++) {
      const response = await fetch(`${h.url}/availability`, { headers: headers() });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      const body = await response.json();
      assert.equal(body.available, false);
      assert.equal(body.message, ANALYSIS_UNAVAILABLE_MESSAGE);
      assert.ok(!JSON.stringify(body).includes("insufficient_quota"));
    }
    assert.equal(probes, 1);
  } finally { await h.close(); }
});

test("unavailable gate blocks before multipart parsing and before running jobs", async () => {
  let jobs = 0;
  const h = await makeHarness({
    availability: { assertAvailable: async () => { throw analysisUnavailableError(); } },
    runJob: async () => { jobs++; return completedResult(); },
  });
  try {
    const response = await fetch(h.url, { method: "POST", headers: {
      ...headers(), "Content-Type": "multipart/form-data; boundary=bad",
    }, body: "malformed multipart body" });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).message, ANALYSIS_UNAVAILABLE_MESSAGE);
    assert.equal(jobs, 0);
  } finally { await h.close(); }
});

test("production cannot return deterministic-only results even if an injected job claims completion", async () => {
  const h = await makeHarness({ runJob: async () => ({ ...completedResult(), aiCompleted: false }) });
  try {
    const response = await fetch(h.url, { method: "POST", headers: headers(), body: oneFileForm() });
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.transactions, undefined);
    assert.equal(body.billing, undefined);
  } finally { await h.close(); }
});

test("provider failure after health check trips gate and stops remaining files and later batches", async () => {
  let jobs = 0;
  const availability = createAnalysisAvailability({ probe: async () => {}, logger: () => {} });
  const h = await makeHarness({ availability, runJob: async ({ requireAi }) => {
    assert.equal(requireAi, true);
    jobs++;
    throw new AiError("V2_AI_PROVIDER_FAILED", "provider failed", {
      details: { status: 401, providerCode: "invalid_api_key" },
    });
  } });
  try {
    const form = oneFileForm();
    form.append("files", new Blob(["second"]), "second.pdf");
    const response = await fetch(h.url, { method: "POST", headers: headers(), body: form });
    assert.equal(response.status, 503);
    assert.equal(jobs, 1);
    assert.equal((await availability.getAvailability()).available, false);
    const again = await fetch(h.url, { method: "POST", headers: headers(), body: oneFileForm() });
    assert.equal(again.status, 503);
    assert.equal(jobs, 1);
  } finally { await h.close(); }
});

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
      {
        date: "01/07/2026",
        description: "EFT INV-7781",
        amount: -100,
        balance: 900,
      },
    ],
  };
}

function completedResult({
  proposal = null,
  jobId = "job-b17",
} = {}) {
  return {
    jobId,
    status: "completed",
    aiCompleted: true,
    authoritativeSource: "ai",
    aiExtraction: { status: "completed", meta: { provider: "mock" } },
    classification: {
      documentType: "bank_statement",
      documentSubtype: "fnb",
      supported: true,
      confidence: 0.99,
      source: "heuristic",
      needsReview: false,
    },
    result: {
      jobId,
      authoritativeSource: "ai",
      data: canonical(),
      issues: [],
      status: "completed",
      validationStatus: "passed",
      validationScore: 1,
    },
    extractionMeta: {
      sourceType: "pdf",
      pages: 1,
    },
    shadowAi: proposal
      ? {
          mode: "shadow",
          status: "differences",
          authoritativeSource: "deterministic",
          ai: { provider: "openai", requestId: "synthetic-request" },
        }
      : { status: "exact_match", ai: { provider: "openai", requestId: "synthetic-request" } },
    aiDecision: proposal
      ? {
          outcome: "review_ai_difference",
          risk: "medium",
          authoritativeSource: "deterministic",
        }
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

async function makeHarness({
  runJob,
  getReviewService,
  recordExportHandler,
  checkAccess: suppliedCheckAccess,
  availability = {
    getAvailability: async () => ({ available: true }),
    assertAvailable: async () => {}, recordFailure: () => {},
  },
} = {}) {
  const authenticate = (req, res, next) => {
    if (
      !String(req.headers.authorization || "").startsWith(
        "Bearer "
      )
    ) {
      return res.status(401).json({
        message: "No token provided",
      });
    }

    req.user = {
      userId: "42",
    };

    next();
  };

  const checkAccess =
    suppliedCheckAccess ||
    ((req, res, next) => {
      req.userRecord = {
        id: 42,
        plan_code: "PAYG_10",
      };

      next();
    });

  const limiter = (req, res, next) => next();

  const defaultRecordExportHandler = async (req, res) => {
    return res.status(200).json({
      success: true,
      first_export: true,
      already_exported: false,
      allowance_consumed: true,
      credits_deducted: 1,
      job_id: req.body?.jobId || null,
    });
  };

  const app = express();

  /*
   * Production server.js installs express.json() before the V2 routes.
   * The test harness must do the same for /export JSON requests.
   */
  app.use(express.json());

  app.use(
    "/api/v2/parse",
    createV2ParseRouter({
      authenticate,
      checkAccess,
      limiter,
      availability,

      extractText: async () => ({
        text: "synthetic",
        meta: {
          sourceType: "text",
          pages: 1,
        },
      }),

      runJob:
        runJob ||
        (async () => completedResult()),

      getReviewService:
        getReviewService ||
        (() => ({
          createCaseFromParseResult: async () => null,
        })),

      recordExportHandler:
        recordExportHandler ||
        defaultRecordExportHandler,
    })
  );

  const server = app.listen(
    0,
    "127.0.0.1"
  );

  await new Promise((resolve) =>
    server.once("listening", resolve)
  );

  const { port } = server.address();

  const baseUrl =
    `http://127.0.0.1:${port}/api/v2/parse`;

  return {
    url: baseUrl,
    exportUrl: `${baseUrl}/export`,
    close: () =>
      new Promise((resolve) =>
        server.close(resolve)
      ),
  };
}

function oneFileForm(
  name = "statement.pdf"
) {
  const form = new FormData();

  form.append(
    "files",
    new Blob(
      ["synthetic"],
      {
        type: "application/pdf",
      }
    ),
    name
  );

  return form;
}

function headers() {
  return {
    Authorization:
      "Bearer synthetic-token",
  };
}

function jsonHeaders() {
  return {
    ...headers(),
    "Content-Type": "application/json",
  };
}

test(
  "Batch 17 V2 production parse API requires authentication",
  async () => {
    const h = await makeHarness();

    try {
      const response = await fetch(
        h.url,
        {
          method: "POST",
          body: oneFileForm(),
        }
      );

      assert.equal(
        response.status,
        401
      );
    } finally {
      await h.close();
    }
  }
);

test(
  "Batch 17 V2 production parse API returns canonical data and defers charging until export",
  async () => {
    let call = 0;

    const h = await makeHarness({
      runJob: async () => {
        call += 1;

        return completedResult({
          jobId:
            call === 1
              ? "job-a"
              : "job-b",
        });
      },
    });

    try {
      const form = new FormData();

      form.append(
        "files",
        new Blob(
          ["a"],
          {
            type: "application/pdf",
          }
        ),
        "a.pdf"
      );

      form.append(
        "files",
        new Blob(
          ["b"],
          {
            type: "application/pdf",
          }
        ),
        "b.pdf"
      );

      const response = await fetch(
        h.url,
        {
          method: "POST",
          headers: headers(),
          body: form,
        }
      );

      assert.equal(
        response.status,
        200
      );

      const body =
        await response.json();

      assert.equal(
        body.engine,
        "youscan-v2"
      );

      assert.equal(
        body.authoritativeSource,
        "ai"
      );

      assert.equal(
        body.fileCount,
        2
      );

      assert.equal(
        body.transactions.length,
        2
      );

      assert.deepEqual(
        body.transactions.map(
          (row) => row.sourceFile
        ),
        ["a.pdf", "b.pdf"]
      );

      assert.deepEqual(
        body.files.map(
          (file) => file.jobId
        ),
        ["job-a", "job-b"]
      );

      /*
       * New commercial rule:
       * parsing itself consumes nothing.
       */
      assert.equal(
        body.billing.chargingModel,
        "EXPORT"
      );

      assert.equal(
        body.billing.deferredUntilExport,
        true
      );

      assert.equal(
        body.billing.creditsDeducted,
        0
      );
    } finally {
      await h.close();
    }
  }
);

test(
  "Batch 17 failed or unsupported V2 results do not produce a billable parse",
  async () => {
    const h = await makeHarness({
      runJob: async () => ({
        status: "unsupported",
        message: "Unsupported",
      }),
    });

    try {
      const response = await fetch(
        h.url,
        {
          method: "POST",
          headers: headers(),
          body: oneFileForm(),
        }
      );

      assert.equal(
        response.status,
        400
      );

      const body =
        await response.json();

      assert.equal(
        body.error,
        "V2_UNSUPPORTED_DOCUMENT"
      );
    } finally {
      await h.close();
    }
  }
);

test(
  "Batch 17 classification review with no canonical result is not exportable",
  async () => {
    const h = await makeHarness({
      runJob: async () => ({
        status: "needs_review",
        result: null,
      }),
    });

    try {
      const response = await fetch(
        h.url,
        {
          method: "POST",
          headers: headers(),
          body: oneFileForm(),
        }
      );

      assert.equal(
        response.status,
        422
      );

      const body =
        await response.json();

      assert.equal(
        body.error,
        "V2_REVIEW_REQUIRED_BEFORE_PARSE"
      );
    } finally {
      await h.close();
    }
  }
);

test(
  "Batch 17 AI proposal values are never returned by the normal parse response",
  async () => {
    const sensitiveProposal =
      proposal();

    const h = await makeHarness({
      runJob: async () =>
        completedResult({
          proposal:
            sensitiveProposal,
        }),

      getReviewService: () => ({
        createCaseFromParseResult:
          async ({ userId }) => {
            assert.equal(
              userId,
              "42"
            );

            return {
              caseId: "case-b17",
            };
          },
      }),
    });

    try {
      const response = await fetch(
        h.url,
        {
          method: "POST",
          headers: headers(),
          body: oneFileForm(),
        }
      );

      assert.equal(
        response.status,
        200
      );

      const body =
        await response.json();

      assert.equal(
        body.files[0].review.caseId,
        "case-b17"
      );

      assert.equal(
        body.files[0].review.persisted,
        true
      );

      assert.equal(
        body.files[0].review
          .reviewTargets[0].field,
        "description"
      );

      const serialized =
        JSON.stringify(body);

      assert.equal(
        serialized.includes(
          '"proposedValue":"EFT"'
        ),
        false
      );

      assert.equal(
        serialized.includes(
          '"currentValue"'
        ),
        false
      );

      assert.equal(
        serialized.includes(
          '"aiCorrectionProposal"'
        ),
        false
      );
    } finally {
      await h.close();
    }
  }
);

test(
  "Batch 17 temporary review persistence failure cannot mutate or suppress a successful deterministic parse",
  async () => {
    const h = await makeHarness({
      runJob: async () =>
        completedResult({
          proposal: proposal(),
        }),

      getReviewService: () => {
        const error =
          new Error(
            "store unavailable"
          );

        error.code =
          "V2_REVIEW_STORE_UNAVAILABLE";

        throw error;
      },
    });

    try {
      const response = await fetch(
        h.url,
        {
          method: "POST",
          headers: headers(),
          body: oneFileForm(),
        }
      );

      assert.equal(
        response.status,
        200
      );

      const body =
        await response.json();

      assert.equal(
        body.billing.chargingModel,
        "EXPORT"
      );

      assert.equal(
        body.billing.deferredUntilExport,
        true
      );

      assert.equal(
        body.billing.creditsDeducted,
        0
      );

      assert.equal(
        body.files[0].jobId,
        "job-b17"
      );

      assert.equal(
        body.files[0].result.data.bankName,
        "FNB"
      );

      assert.equal(
        body.files[0].review.persisted,
        false
      );

      assert.equal(
        body.authoritativeSource,
        "ai"
      );
    } finally {
      await h.close();
    }
  }
);

test(
  "Batch 21 V2 export endpoint requires authentication",
  async () => {
    const h = await makeHarness();

    try {
      const response = await fetch(
        h.exportUrl,
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            jobId: "job-b17",
            fileName:
              "statement.pdf",
          }),
        }
      );

      assert.equal(
        response.status,
        401
      );
    } finally {
      await h.close();
    }
  }
);

test(
  "Batch 21 first document export consumes once and repeated export is idempotent",
  async () => {
    const exportedJobs =
      new Set();

    let consumed = 0;

    const h = await makeHarness({
      recordExportHandler:
        async (req, res) => {
          const jobId =
            req.body?.jobId;

          assert.ok(jobId);

          const alreadyExported =
            exportedJobs.has(jobId);

          if (!alreadyExported) {
            exportedJobs.add(jobId);
            consumed += 1;
          }

          return res
            .status(200)
            .json({
              success: true,

              first_export:
                !alreadyExported,

              already_exported:
                alreadyExported,

              allowance_consumed:
                !alreadyExported,

              credits_deducted:
                alreadyExported
                  ? 0
                  : 1,

              job_id: jobId,
            });
        },
    });

    try {
      const first =
        await fetch(
          h.exportUrl,
          {
            method: "POST",
            headers:
              jsonHeaders(),

            body:
              JSON.stringify({
                jobId: "job-one",
                fileName:
                  "one.pdf",
              }),
          }
        );

      assert.equal(
        first.status,
        200
      );

      const firstBody =
        await first.json();

      assert.equal(
        firstBody.first_export,
        true
      );

      assert.equal(
        firstBody.credits_deducted,
        1
      );

      assert.equal(
        consumed,
        1
      );

      /*
       * Same document again:
       * no second consumption.
       */
      const second =
        await fetch(
          h.exportUrl,
          {
            method: "POST",
            headers:
              jsonHeaders(),

            body:
              JSON.stringify({
                jobId: "job-one",
                fileName:
                  "one.pdf",
              }),
          }
        );

      assert.equal(
        second.status,
        200
      );

      const secondBody =
        await second.json();

      assert.equal(
        secondBody.first_export,
        false
      );

      assert.equal(
        secondBody.already_exported,
        true
      );

      assert.equal(
        secondBody.credits_deducted,
        0
      );

      assert.equal(
        consumed,
        1
      );

      /*
       * A different document is a new
       * export and consumes separately.
       */
      const third =
        await fetch(
          h.exportUrl,
          {
            method: "POST",
            headers:
              jsonHeaders(),

            body:
              JSON.stringify({
                jobId: "job-two",
                fileName:
                  "two.pdf",
              }),
          }
        );

      assert.equal(
        third.status,
        200
      );

      const thirdBody =
        await third.json();

      assert.equal(
        thirdBody.first_export,
        true
      );

      assert.equal(
        thirdBody.credits_deducted,
        1
      );

      assert.equal(
        consumed,
        2
      );
    } finally {
      await h.close();
    }
  }
);

test(
  "Batch 21 export does not use parse access middleware",
  async () => {
    let accessChecks = 0;

    const h = await makeHarness({
      checkAccess:
        (req, res, next) => {
          accessChecks += 1;

          return res
            .status(402)
            .json({
              error:
                "CREDITS_EXHAUSTED",
            });
        },

      recordExportHandler:
        async (req, res) => {
          return res
            .status(200)
            .json({
              success: true,
              first_export: false,
              already_exported: true,
              allowance_consumed: false,
              credits_deducted: 0,
              job_id:
                req.body?.jobId,
            });
        },
    });

    try {
      /*
       * The export route intentionally does
       * not execute checkAccess.
       *
       * This permits a document that was
       * already paid for to be re-exported
       * even when the user's balance is now
       * zero.
       */
      const response =
        await fetch(
          h.exportUrl,
          {
            method: "POST",
            headers:
              jsonHeaders(),

            body:
              JSON.stringify({
                jobId:
                  "already-paid-job",
                fileName:
                  "statement.pdf",
              }),
          }
        );

      assert.equal(
        response.status,
        200
      );

      const body =
        await response.json();

      assert.equal(
        body.already_exported,
        true
      );

      assert.equal(
        body.credits_deducted,
        0
      );

      assert.equal(
        accessChecks,
        0
      );
    } finally {
      await h.close();
    }
  }
);

test(
  "Batch 17 removes the unauthenticated debug-text V2 test route from legacy /parse",
  () => {
    const source =
      fs.readFileSync(
        new URL(
          "../../routes/parse.js",
          import.meta.url
        ),
        "utf8"
      );

    assert.equal(
      source.includes(
        "test-youscan2"
      ),
      false
    );

    assert.equal(
      source.includes(
        "debugTextPreview"
      ),
      false
    );

    assert.equal(
      source.includes(
        "parseStatement"
      ),
      true
    );
  }
);
