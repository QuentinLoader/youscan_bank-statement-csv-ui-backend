import assert from "node:assert/strict";
import test from "node:test";

import * as extractionApi from "../ai/extraction/index.js";
import {
  AI_CORRECTION_ITEM_REVIEW_STATUSES,
  AI_CORRECTION_PROPOSAL_STATUSES,
  createAiCorrectionProposal,
  fingerprintDeterministicCanonical,
  toSafeAiCorrectionProposalSummary,
} from "../ai/extraction/correctionProposal.js";
import {
  AI_CORRECTION_REVIEW_ACTIONS,
  reviewAiCorrectionProposal,
} from "../ai/extraction/reviewCorrectionProposal.js";
import { AI_DECISION_OUTCOMES, evaluateAiDecisionPolicy } from "../ai/extraction/decisionPolicy.js";
import {
  AI_SHADOW_STATUSES,
  getAiShadowInternalCanonical,
  runAiBankStatementShadow,
} from "../ai/extraction/runShadowExtraction.js";
import { runParseJob } from "../orchestrator/runParseJob.js";
import { DOCUMENT_SUBTYPES } from "../registry/documentTypes.js";
import {
  FNB_EXPECTED_NORMALIZED,
  FNB_STATEMENT_FIXTURE_TEXT,
} from "./fixtures/fnbStatement.fixture.js";
import {
  makeFnbShadowCandidate,
  makeShadowAiEnvelope,
} from "./fixtures/aiBankStatementShadow.fixture.js";

function shadowConfig(overrides = {}) {
  return {
    enabled: true,
    classifierEnabled: false,
    extractionEnabled: true,
    provider: "mock",
    model: "mock-extractor",
    timeoutMs: 200,
    maxInputChars: 120_000,
    classificationMaxInputChars: 30_000,
    classificationMinConfidence: 0.92,
    extractionMinConfidence: 0.95,
    extractionFieldMinConfidence: 0.95,
    ...overrides,
  };
}

function mockProvider(envelope) {
  return {
    name: "mock",
    async generateStructured() {
      return {
        content: JSON.stringify(envelope),
        model: "mock-extractor",
        requestId: "b15-proposal-1",
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      };
    },
  };
}

function deterministicCanonical() {
  return structuredClone(FNB_EXPECTED_NORMALIZED);
}

async function differenceShadow({ alsoChangeClientName = false } = {}) {
  const candidate = makeFnbShadowCandidate({ omitReferenceFromDescription: true });
  if (alsoChangeClientName) {
    candidate.clientName.value = "ACME TRADING";
    candidate.clientName.evidence = ["*ACME TRADING PTY LTD"];
  }

  return runAiBankStatementShadow({
    extractedText: FNB_STATEMENT_FIXTURE_TEXT,
    sourceFileName: "fnb-july-2026.pdf",
    deterministicCanonical: deterministicCanonical(),
    classification: { documentSubtype: DOCUMENT_SUBTYPES.FNB_STATEMENT },
    config: shadowConfig(),
    provider: mockProvider(makeShadowAiEnvelope(candidate)),
  });
}

async function exactShadow() {
  return runAiBankStatementShadow({
    extractedText: FNB_STATEMENT_FIXTURE_TEXT,
    sourceFileName: "fnb-july-2026.pdf",
    deterministicCanonical: deterministicCanonical(),
    classification: { documentSubtype: DOCUMENT_SUBTYPES.FNB_STATEMENT },
    config: shadowConfig(),
    provider: mockProvider(makeShadowAiEnvelope()),
  });
}

function decisionFor(shadowAi) {
  return evaluateAiDecisionPolicy({
    shadowAi,
    deterministicStatus: "completed",
    deterministicIssues: [],
  });
}

test("Batch 15 internal AI canonical is non-enumerable and excluded from shadow JSON", async () => {
  const shadowAi = await differenceShadow();
  const internal = getAiShadowInternalCanonical(shadowAi);

  assert.equal(shadowAi.status, AI_SHADOW_STATUSES.DIFFERENCES);
  assert.ok(internal);
  assert.equal(internal.transactions[2].description, "EFT PAYMENT SUPPLIER ABC");
  assert.equal(JSON.stringify(shadowAi).includes("EFT PAYMENT SUPPLIER ABC"), false);
  assert.equal(Object.keys(shadowAi).includes("internalCanonical"), false);
});

test("Batch 15 creates a sensitive human-review proposal only for a real AI difference", async () => {
  const shadowAi = await differenceShadow();
  const aiDecision = decisionFor(shadowAi);
  const proposal = createAiCorrectionProposal({
    shadowAi,
    aiDecision,
    deterministicCanonical: deterministicCanonical(),
    proposalId: "proposal-b15-1",
    createdAt: "2026-08-20T09:00:00.000Z",
  });

  assert.equal(aiDecision.outcome, AI_DECISION_OUTCOMES.REVIEW_AI_DIFFERENCE);
  assert.equal(proposal.status, AI_CORRECTION_PROPOSAL_STATUSES.PENDING_REVIEW);
  assert.equal(proposal.authoritativeSource, "deterministic");
  assert.equal(proposal.containsSensitiveValues, true);
  assert.equal(proposal.requiresExplicitReview, true);
  assert.equal(proposal.aiCanAutoApply, false);
  assert.equal(proposal.applicationAuthorized, false);
  assert.equal(proposal.applied, false);
  assert.equal(proposal.itemCount, 1);
  assert.deepEqual(proposal.items[0], {
    itemId: "transaction:2:description",
    scope: "transaction",
    rowIndex: 2,
    field: "description",
    risk: "medium",
    currentValue: "EFT PAYMENT SUPPLIER ABC Reference INV-7781",
    proposedValue: "EFT PAYMENT SUPPLIER ABC",
    reviewStatus: AI_CORRECTION_ITEM_REVIEW_STATUSES.PENDING,
    review: null,
  });
});

test("Batch 15 exact AI agreement creates no correction proposal", async () => {
  const shadowAi = await exactShadow();
  const proposal = createAiCorrectionProposal({
    shadowAi,
    aiDecision: decisionFor(shadowAi),
    deterministicCanonical: deterministicCanonical(),
  });

  assert.equal(shadowAi.status, AI_SHADOW_STATUSES.EXACT_MATCH);
  assert.equal(proposal, null);
});

test("Batch 15 proposal summary contains targets but never sensitive current/proposed values", async () => {
  const shadowAi = await differenceShadow();
  const proposal = createAiCorrectionProposal({
    shadowAi,
    aiDecision: decisionFor(shadowAi),
    deterministicCanonical: deterministicCanonical(),
    proposalId: "proposal-b15-safe",
  });
  const summary = toSafeAiCorrectionProposalSummary(proposal);
  const serialized = JSON.stringify(summary);

  assert.equal(summary.itemCount, 1);
  assert.deepEqual(summary.reviewTargets, [
    {
      itemId: "transaction:2:description",
      scope: "transaction",
      rowIndex: 2,
      field: "description",
      risk: "medium",
      reviewStatus: "pending",
    },
  ]);
  assert.equal(serialized.includes("INV-7781"), false);
  assert.equal(serialized.includes("EFT PAYMENT SUPPLIER ABC"), false);
  assert.equal(serialized.includes("62123456789"), false);
});

test("Batch 15 deterministic fingerprint is stable and changes when canonical data changes", () => {
  const original = deterministicCanonical();
  const equivalentClone = deterministicCanonical();
  const changed = deterministicCanonical();
  changed.transactions[0].description = "Changed description";

  assert.equal(
    fingerprintDeterministicCanonical(original),
    fingerprintDeterministicCanonical(equivalentClone)
  );
  assert.notEqual(
    fingerprintDeterministicCanonical(original),
    fingerprintDeterministicCanonical(changed)
  );
});

test("Batch 15 reviewer can explicitly accept an AI proposal item without applying it", async () => {
  const canonical = deterministicCanonical();
  const shadowAi = await differenceShadow();
  const proposal = createAiCorrectionProposal({
    shadowAi,
    aiDecision: decisionFor(shadowAi),
    deterministicCanonical: canonical,
    proposalId: "proposal-b15-accept",
  });

  const reviewed = reviewAiCorrectionProposal({
    proposal,
    currentDeterministicCanonical: canonical,
    reviewerId: "reviewer-123",
    reviewedAt: "2026-08-20T10:00:00.000Z",
    decisions: [
      {
        itemId: "transaction:2:description",
        action: AI_CORRECTION_REVIEW_ACTIONS.ACCEPT_AI,
      },
    ],
  });

  assert.equal(reviewed.status, AI_CORRECTION_PROPOSAL_STATUSES.REVIEWED);
  assert.equal(reviewed.acceptedAiItemCount, 1);
  assert.equal(reviewed.retainedDeterministicItemCount, 0);
  assert.equal(reviewed.applicationAuthorized, false);
  assert.equal(reviewed.applied, false);
  assert.equal(reviewed.authoritativeSource, "deterministic");
  assert.equal(reviewed.items[0].review.reviewerId, "reviewer-123");
  assert.equal(reviewed.items[0].reviewStatus, "accept_ai");
  assert.deepEqual(canonical, FNB_EXPECTED_NORMALIZED);
});

test("Batch 15 reviewer can explicitly retain the deterministic field", async () => {
  const canonical = deterministicCanonical();
  const shadowAi = await differenceShadow();
  const proposal = createAiCorrectionProposal({
    shadowAi,
    aiDecision: decisionFor(shadowAi),
    deterministicCanonical: canonical,
  });

  const reviewed = reviewAiCorrectionProposal({
    proposal,
    currentDeterministicCanonical: canonical,
    reviewerId: "reviewer-456",
    decisions: [
      {
        itemId: "transaction:2:description",
        action: AI_CORRECTION_REVIEW_ACTIONS.RETAIN_DETERMINISTIC,
      },
    ],
  });

  assert.equal(reviewed.status, AI_CORRECTION_PROPOSAL_STATUSES.REVIEWED);
  assert.equal(reviewed.acceptedAiItemCount, 0);
  assert.equal(reviewed.retainedDeterministicItemCount, 1);
  assert.equal(reviewed.applicationAuthorized, false);
});

test("Batch 15 supports partial item review and keeps the proposal unapplied", async () => {
  const canonical = deterministicCanonical();
  const shadowAi = await differenceShadow({ alsoChangeClientName: true });
  const proposal = createAiCorrectionProposal({
    shadowAi,
    aiDecision: decisionFor(shadowAi),
    deterministicCanonical: canonical,
    proposalId: "proposal-b15-partial",
  });

  assert.equal(proposal.itemCount, 2);
  const reviewed = reviewAiCorrectionProposal({
    proposal,
    currentDeterministicCanonical: canonical,
    reviewerId: "reviewer-partial",
    decisions: [
      {
        itemId: "metadata:clientName",
        action: AI_CORRECTION_REVIEW_ACTIONS.RETAIN_DETERMINISTIC,
      },
    ],
  });

  assert.equal(reviewed.status, AI_CORRECTION_PROPOSAL_STATUSES.PARTIALLY_REVIEWED);
  assert.equal(reviewed.reviewedItemCount, 1);
  assert.equal(reviewed.retainedDeterministicItemCount, 1);
  assert.equal(reviewed.acceptedAiItemCount, 0);
  assert.equal(reviewed.applicationAuthorized, false);
  assert.equal(
    reviewed.items.find((item) => item.itemId === "transaction:2:description").reviewStatus,
    "pending"
  );
});

test("Batch 15 rejects a stale proposal when deterministic data changed after proposal creation", async () => {
  const canonical = deterministicCanonical();
  const shadowAi = await differenceShadow();
  const proposal = createAiCorrectionProposal({
    shadowAi,
    aiDecision: decisionFor(shadowAi),
    deterministicCanonical: canonical,
  });
  const changed = deterministicCanonical();
  changed.transactions[0].description = "Human-edited description";

  assert.throws(
    () =>
      reviewAiCorrectionProposal({
        proposal,
        currentDeterministicCanonical: changed,
        reviewerId: "reviewer-789",
        decisions: [
          {
            itemId: "transaction:2:description",
            action: AI_CORRECTION_REVIEW_ACTIONS.ACCEPT_AI,
          },
        ],
      }),
    (error) => error.code === "V2_AI_PROPOSAL_STALE"
  );
});

test("Batch 15 requires a reviewer identity", async () => {
  const canonical = deterministicCanonical();
  const shadowAi = await differenceShadow();
  const proposal = createAiCorrectionProposal({
    shadowAi,
    aiDecision: decisionFor(shadowAi),
    deterministicCanonical: canonical,
  });

  assert.throws(
    () =>
      reviewAiCorrectionProposal({
        proposal,
        currentDeterministicCanonical: canonical,
        reviewerId: "",
        decisions: [
          {
            itemId: "transaction:2:description",
            action: AI_CORRECTION_REVIEW_ACTIONS.ACCEPT_AI,
          },
        ],
      }),
    (error) => error.code === "V2_AI_PROPOSAL_REVIEWER_REQUIRED"
  );
});

test("Batch 15 rejects unknown proposal item identifiers", async () => {
  const canonical = deterministicCanonical();
  const shadowAi = await differenceShadow();
  const proposal = createAiCorrectionProposal({
    shadowAi,
    aiDecision: decisionFor(shadowAi),
    deterministicCanonical: canonical,
  });

  assert.throws(
    () =>
      reviewAiCorrectionProposal({
        proposal,
        currentDeterministicCanonical: canonical,
        reviewerId: "reviewer-unknown",
        decisions: [
          { itemId: "transaction:999:amount", action: AI_CORRECTION_REVIEW_ACTIONS.ACCEPT_AI },
        ],
      }),
    (error) => error.code === "V2_AI_PROPOSAL_ITEM_UNKNOWN"
  );
});

test("Batch 15 rejects invalid review actions", async () => {
  const canonical = deterministicCanonical();
  const shadowAi = await differenceShadow();
  const proposal = createAiCorrectionProposal({
    shadowAi,
    aiDecision: decisionFor(shadowAi),
    deterministicCanonical: canonical,
  });

  assert.throws(
    () =>
      reviewAiCorrectionProposal({
        proposal,
        currentDeterministicCanonical: canonical,
        reviewerId: "reviewer-invalid",
        decisions: [
          { itemId: "transaction:2:description", action: "auto_apply" },
        ],
      }),
    (error) => error.code === "V2_AI_PROPOSAL_ACTION_INVALID"
  );
});

test("Batch 15 rejects duplicate decisions for the same proposal item", async () => {
  const canonical = deterministicCanonical();
  const shadowAi = await differenceShadow();
  const proposal = createAiCorrectionProposal({
    shadowAi,
    aiDecision: decisionFor(shadowAi),
    deterministicCanonical: canonical,
  });

  assert.throws(
    () =>
      reviewAiCorrectionProposal({
        proposal,
        currentDeterministicCanonical: canonical,
        reviewerId: "reviewer-duplicate",
        decisions: [
          { itemId: "transaction:2:description", action: AI_CORRECTION_REVIEW_ACTIONS.ACCEPT_AI },
          { itemId: "transaction:2:description", action: AI_CORRECTION_REVIEW_ACTIONS.RETAIN_DETERMINISTIC },
        ],
      }),
    (error) => error.code === "V2_AI_PROPOSAL_DUPLICATE_DECISION"
  );
});

test("Batch 15 public extraction API deliberately exposes no apply/merge function", () => {
  assert.equal("applyAiCorrectionProposal" in extractionApi, false);
  assert.equal("mergeAiCorrectionProposal" in extractionApi, false);
});

test("Batch 15 runParseJob attaches a review proposal for a safe AI description difference without changing canonical data", async () => {
  const provider = mockProvider(
    makeShadowAiEnvelope(makeFnbShadowCandidate({ omitReferenceFromDescription: true }))
  );
  const result = await runParseJob({
    file: { originalname: "fnb-july-2026.pdf", mimetype: "application/pdf" },
    extractedText: FNB_STATEMENT_FIXTURE_TEXT,
    shadowAiOptions: { config: shadowConfig(), provider },
  });

  assert.equal(result.status, "completed");
  assert.deepEqual(result.result.data, FNB_EXPECTED_NORMALIZED);
  assert.equal(result.aiDecision.outcome, AI_DECISION_OUTCOMES.REVIEW_AI_DIFFERENCE);
  assert.equal(result.aiCorrectionProposal.itemCount, 1);
  assert.equal(result.aiCorrectionProposal.items[0].field, "description");
  assert.equal(result.aiCorrectionProposal.applicationAuthorized, false);
  assert.equal(result.aiCorrectionProposal.applied, false);
});

test("Batch 15 runParseJob creates no correction proposal when AI exactly confirms deterministic data", async () => {
  const result = await runParseJob({
    file: { originalname: "fnb-july-2026.pdf", mimetype: "application/pdf" },
    extractedText: FNB_STATEMENT_FIXTURE_TEXT,
    shadowAiOptions: {
      config: shadowConfig(),
      provider: mockProvider(makeShadowAiEnvelope()),
    },
  });

  assert.equal(result.status, "completed");
  assert.equal(result.aiDecision.outcome, AI_DECISION_OUTCOMES.DETERMINISTIC_CONFIRMED);
  assert.equal(result.aiCorrectionProposal, null);
  assert.deepEqual(result.result.data, FNB_EXPECTED_NORMALIZED);
});
