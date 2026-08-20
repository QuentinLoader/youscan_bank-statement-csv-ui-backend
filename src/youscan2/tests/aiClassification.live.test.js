import assert from "node:assert/strict";
import test from "node:test";

import { classifyDocument } from "../classifier/classifyDocument.js";
import { DOCUMENT_SUBTYPES } from "../registry/documentTypes.js";

const enabled = String(process.env.YOUSCAN_V2_AI_CLASSIFICATION_LIVE_TEST || "")
  .trim()
  .toLowerCase() === "true";

test(
  "Batch 10 optional live OpenAI classification fallback smoke test",
  { skip: !enabled },
  async () => {
    const result = await classifyDocument({
      fileName: "synthetic-fnb-statement.pdf",
      extractedText: [
        "FNB",
        "Account Statement",
        "Balance",
        "Synthetic test document. No real customer data.",
      ].join("\n"),
    });

    assert.equal(result.aiAttempted, true);
    assert.equal(result.documentSubtype, DOCUMENT_SUBTYPES.FNB_STATEMENT);
    assert.equal(result.classificationMethod, "ai_fallback");
    assert.equal(result.needsReview, false);
  }
);
