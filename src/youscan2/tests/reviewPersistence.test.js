import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";

import { fingerprintDeterministicCanonical } from "../ai/extraction/correctionProposal.js";
import { AI_CORRECTION_REVIEW_ACTIONS } from "../ai/extraction/reviewCorrectionProposal.js";
import { loadReviewConfig } from "../review/config.js";
import { createReviewCrypto, reviewPayloadAad } from "../review/crypto.js";
import { createMemoryReviewRepository } from "../review/memoryRepository.js";
import { createReviewService } from "../review/reviewService.js";

const KEY = Buffer.alloc(32, 7);
const KEY_B64 = KEY.toString("base64");

function canonical() {
  return {
    bankName: "FNB",
    accountNumber: "62123456789",
    clientName: "Synthetic Customer",
    statementPeriodStart: "01/07/2026",
    statementPeriodEnd: "31/07/2026",
    openingBalance: 1000,
    closingBalance: 1200,
    transactions: [
      {
        date: "01/07/2026",
        description: "EFT PAYMENT SUPPLIER ABC INV-7781",
        amount: -100,
        balance: 900,
      },
      {
        date: "02/07/2026",
        description: "SALARY",
        amount: 300,
        balance: 1200,
      },
    ],
  };
}

function proposalFor(current = canonical()) {
  return {
    proposalId: "proposal-b16-1",
    mode: "human_review",
    status: "pending_review",
    createdAt: "2026-08-20T10:00:00.000Z",
    containsSensitiveValues: true,
    doNotLogValues: true,
    authoritativeSource: "deterministic",
    deterministicFingerprint: fingerprintDeterministicCanonical(current),
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
        currentValue: "EFT PAYMENT SUPPLIER ABC INV-7781",
        proposedValue: "EFT PAYMENT SUPPLIER ABC",
        reviewStatus: "pending",
        review: null,
      },
    ],
  };
}

function parseResult() {
  const data = canonical();
  return {
    jobId: "job-b16-1",
    status: "completed",
    result: { data },
    aiCorrectionProposal: proposalFor(data),
  };
}

function harness() {
  const repository = createMemoryReviewRepository();
  const reviewCrypto = createReviewCrypto({ key: KEY });
  let sequence = 0;
  const service = createReviewService({
    repository,
    reviewCrypto,
    now: () => "2026-08-20T11:00:00.000Z",
    idFactory: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
  });
  return { repository, reviewCrypto, service };
}

test("Batch 16 review persistence is disabled by default", () => {
  const config = loadReviewConfig({});
  assert.equal(config.enabled, false);
  assert.equal(config.encryptionKey, null);
});

test("Batch 16 enabled review persistence requires a valid 32-byte base64 key", () => {
  assert.throws(
    () => loadReviewConfig({ YOUSCAN_V2_REVIEW_PERSISTENCE_ENABLED: "true" }),
    (error) => error.code === "V2_REVIEW_ENCRYPTION_KEY_REQUIRED"
  );
  assert.throws(
    () => loadReviewConfig({
      YOUSCAN_V2_REVIEW_PERSISTENCE_ENABLED: "true",
      YOUSCAN_V2_REVIEW_ENCRYPTION_KEY: Buffer.alloc(8).toString("base64"),
    }),
    (error) => error.code === "V2_REVIEW_ENCRYPTION_KEY_INVALID"
  );

  const config = loadReviewConfig({
    YOUSCAN_V2_REVIEW_PERSISTENCE_ENABLED: "true",
    YOUSCAN_V2_REVIEW_ENCRYPTION_KEY: KEY_B64,
  });
  assert.equal(config.enabled, true);
  assert.equal(config.encryptionKey.length, 32);
});

test("Batch 16 AES-GCM review payload round-trips and is bound to case ownership AAD", () => {
  const reviewCrypto = createReviewCrypto({ key: KEY });
  const aad = reviewPayloadAad({ caseId: "case-1", userId: "user-1" });
  const encrypted = reviewCrypto.encryptJson({ secret: "62123456789" }, { aad });

  assert.equal(encrypted.includes("62123456789"), false);
  assert.deepEqual(reviewCrypto.decryptJson(encrypted, { aad }), { secret: "62123456789" });
  assert.throws(
    () => reviewCrypto.decryptJson(encrypted, { aad: reviewPayloadAad({ caseId: "case-1", userId: "user-2" }) }),
    (error) => error.code === "V2_REVIEW_PAYLOAD_DECRYPT_FAILED"
  );
});

test("Batch 16 creates an encrypted persistent review case from a server-side parse result", async () => {
  const { service, repository } = harness();
  const summary = await service.createCaseFromParseResult({ userId: "user-1", parseResult: parseResult() });

  assert.equal(summary.status, "pending_review");
  assert.equal(summary.itemCount, 1);
  assert.equal(summary.aiCanAutoApply, false);
  assert.equal(summary.applied, false);

  const stored = repository._unsafeGetStoredRecord(summary.caseId);
  assert.equal(stored.encryptedPayload.includes("62123456789"), false);
  assert.equal(stored.encryptedPayload.includes("INV-7781"), false);
  assert.equal(JSON.stringify(stored.safeSummary).includes("62123456789"), false);
  assert.equal(JSON.stringify(stored.safeSummary).includes("INV-7781"), false);
});

test("Batch 16 refuses to persist a proposal that does not match the deterministic fingerprint", async () => {
  const { service } = harness();
  const result = parseResult();
  result.result.data.transactions[0].description = "Human changed";

  await assert.rejects(
    () => service.createCaseFromParseResult({ userId: "user-1", parseResult: result }),
    (error) => error.code === "V2_REVIEW_PROPOSAL_STALE"
  );
});

test("Batch 16 refuses unsafe proposals that claim they can auto-apply", async () => {
  const { service } = harness();
  const result = parseResult();
  result.aiCorrectionProposal.aiCanAutoApply = true;

  await assert.rejects(
    () => service.createCaseFromParseResult({ userId: "user-1", parseResult: result }),
    (error) => error.code === "V2_REVIEW_UNSAFE_PROPOSAL"
  );
});

test("Batch 16 case lists are ownership-scoped and privacy-safe", async () => {
  const { service } = harness();
  await service.createCaseFromParseResult({ userId: "user-1", parseResult: parseResult() });

  const mine = await service.listCases({ userId: "user-1" });
  const theirs = await service.listCases({ userId: "user-2" });
  assert.equal(mine.length, 1);
  assert.equal(theirs.length, 0);
  const serialized = JSON.stringify(mine);
  assert.equal(serialized.includes("62123456789"), false);
  assert.equal(serialized.includes("INV-7781"), false);
});

test("Batch 16 authorized detail decrypts proposal values needed for human review", async () => {
  const { service } = harness();
  const summary = await service.createCaseFromParseResult({ userId: "user-1", parseResult: parseResult() });
  const detail = await service.getCase({ userId: "user-1", caseId: summary.caseId });

  assert.equal(detail.proposal.items[0].currentValue.includes("INV-7781"), true);
  assert.equal(detail.proposal.items[0].proposedValue, "EFT PAYMENT SUPPLIER ABC");
  await assert.rejects(
    () => service.getCase({ userId: "user-2", caseId: summary.caseId }),
    (error) => error.code === "V2_REVIEW_CASE_NOT_FOUND"
  );
});

test("Batch 16 authenticated reviewer can accept an AI proposal without applying it", async () => {
  const { service } = harness();
  const summary = await service.createCaseFromParseResult({ userId: "user-1", parseResult: parseResult() });
  const reviewed = await service.reviewCase({
    userId: "user-1",
    caseId: summary.caseId,
    decisions: [
      { itemId: "transaction:0:description", action: AI_CORRECTION_REVIEW_ACTIONS.ACCEPT_AI },
    ],
  });

  assert.equal(reviewed.status, "reviewed");
  assert.equal(reviewed.acceptedAiItemCount, 1);
  assert.equal(reviewed.proposal.items[0].review.reviewerId, "user-1");
  assert.equal(reviewed.proposal.applicationAuthorized, false);
  assert.equal(reviewed.proposal.applied, false);
  assert.equal(reviewed.authoritativeSource, "deterministic");
});

test("Batch 16 already-decided proposal items cannot be silently re-reviewed", async () => {
  const { service } = harness();
  const summary = await service.createCaseFromParseResult({ userId: "user-1", parseResult: parseResult() });
  await service.reviewCase({
    userId: "user-1",
    caseId: summary.caseId,
    decisions: [
      { itemId: "transaction:0:description", action: AI_CORRECTION_REVIEW_ACTIONS.RETAIN_DETERMINISTIC },
    ],
  });

  await assert.rejects(
    () => service.reviewCase({
      userId: "user-1",
      caseId: summary.caseId,
      decisions: [
        { itemId: "transaction:0:description", action: AI_CORRECTION_REVIEW_ACTIONS.ACCEPT_AI },
      ],
    }),
    (error) => error.code === "V2_REVIEW_ITEM_ALREADY_DECIDED"
  );
});

test("Batch 16 audit trail records creation and review decisions without values", async () => {
  const { service } = harness();
  const summary = await service.createCaseFromParseResult({ userId: "user-1", parseResult: parseResult() });
  await service.reviewCase({
    userId: "user-1",
    caseId: summary.caseId,
    decisions: [
      { itemId: "transaction:0:description", action: AI_CORRECTION_REVIEW_ACTIONS.RETAIN_DETERMINISTIC },
    ],
  });
  const audit = await service.listAudit({ userId: "user-1", caseId: summary.caseId });

  assert.deepEqual(audit.map((event) => event.eventType), [
    "review_case_created",
    "review_decisions_recorded",
  ]);
  const serialized = JSON.stringify(audit);
  assert.equal(serialized.includes("62123456789"), false);
  assert.equal(serialized.includes("INV-7781"), false);
  assert.equal(serialized.includes("EFT PAYMENT SUPPLIER ABC"), false);
});

test("Batch 16 deterministic snapshot refresh makes the original proposal stale", async () => {
  const { service } = harness();
  const summary = await service.createCaseFromParseResult({ userId: "user-1", parseResult: parseResult() });
  const changed = canonical();
  changed.transactions[0].description = "Human corrected description";
  await service.refreshDeterministicSnapshot({
    userId: "user-1",
    caseId: summary.caseId,
    deterministicCanonical: changed,
  });

  await assert.rejects(
    () => service.reviewCase({
      userId: "user-1",
      caseId: summary.caseId,
      decisions: [
        { itemId: "transaction:0:description", action: AI_CORRECTION_REVIEW_ACTIONS.ACCEPT_AI },
      ],
    }),
    (error) => error.code === "V2_AI_PROPOSAL_STALE"
  );
});

test("Batch 16 service deliberately exposes no apply or merge operation", () => {
  const { service } = harness();
  assert.equal("applyCorrection" in service, false);
  assert.equal("applyAiCorrectionProposal" in service, false);
  assert.equal("mergeAiCorrectionProposal" in service, false);
});
