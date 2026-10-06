import { getAiConfig } from "../ai/config.js";
import { aiBankStatementExtractor } from "../ai/extraction/aiBankStatementExtractor.js";
import { assessAiBankStatementExtraction } from "../ai/extraction/assessCandidate.js";
import { AiError } from "../ai/errors.js";
import { V2_RECOGNIZED_BANK_SUBTYPES, getBankNameForSubtype } from "../registry/bankSupport.js";
import { getActiveSchemaForDocumentType } from "../registry/schemaRegistry.js";
import { finalizeParseJob } from "./finalizeParseJob.js";

const bankAliases = new Map([
  ["absa bank", "absa_statement"],
  ["absa bank limited", "absa_statement"],
  ["absa bank ltd", "absa_statement"],
  ["absa bank south africa", "absa_statement"],
  ["absa south africa", "absa_statement"],
  ["first national bank", "fnb_statement"],
  ["first national bank fnb", "fnb_statement"],
  ["fnb first national bank", "fnb_statement"],
  ["first national bank a division of firstrand bank limited", "fnb_statement"],
  ["first national bank a division of firstrand bank ltd", "fnb_statement"],
  ["capitec bank", "capitec_statement"],
  ["capitec bank limited", "capitec_statement"],
  ["capitec bank ltd", "capitec_statement"],
  ["discovery", "discovery_statement"],
  ["standard bank south africa", "standard_bank_statement"],
]);
const normalizeBank = (name) => String(name || "").toLowerCase().replace(/[().,\u2013\u2014-]/g, " ").trim().replace(/\s+/g, " ");

// The production path never invokes a bank parser or compares against its data.
// All displayed values come from this AI candidate; validation only flags issues.
export async function runAiParseJob({ job, file, extractedText, extractionMeta, availability, aiOptions }) {
  await availability.assertAvailable();
  const config = aiOptions?.config || getAiConfig();
  const ai = await aiBankStatementExtractor({
    extractedText, config, provider: aiOptions?.provider, logger: aiOptions?.logger,
  });
  const assessment = await assessAiBankStatementExtraction({
    candidate: ai.data, envelopeConfidence: ai.confidence,
    sourceText: extractedText, sourceFileName: file?.originalname || null,
    minEnvelopeConfidence: config.extractionMinConfidence,
    minFieldConfidence: config.extractionFieldMinConfidence,
  });
  if (assessment.disposition === "rejected" || !assessment.canonical) {
    throw new AiError("V2_AI_ANALYSIS_REJECTED", "AI extraction could not validate this document.");
  }
  const bank = normalizeBank(assessment.canonical.bankName);
  const canonicalSubtype = V2_RECOGNIZED_BANK_SUBTYPES.find(
    (value) => normalizeBank(getBankNameForSubtype(value)) === bank,
  );
  const subtype = canonicalSubtype || bankAliases.get(bank);
  // Log only registry labels, never the AI-returned text or statement fields.
  console.info("V2 AI BANK RECOGNITION:", JSON.stringify({
    documentSubtype: subtype || "unknown",
    reason: canonicalSubtype ? "canonical_name" : subtype ? "known_alias" : "unrecognized_name",
    requestId: ai.meta?.requestId || null,
  }));
  const classification = {
    documentType: "bank_statement", documentSubtype: subtype || "unknown",
    supported: Boolean(subtype), confidence: ai.data.bankName.confidence,
    source: "ai", needsReview: false,
  };
  const schema = getActiveSchemaForDocumentType("bank_statement");
  if (!subtype) {
    return finalizeParseJob({ job, status: "unsupported", classification, schema,
      extractionMeta, message: "This bank is not supported by YouScan V2." });
  }
  const status = assessment.disposition === "needs_review" ? "needs_review" : "completed";
  const result = {
    jobId: job.jobId, status, authoritativeSource: "ai", data: assessment.canonical,
    issues: assessment.issues.map((issue) => ({
      ...issue, message: issue.message || `AI extraction requires review: ${issue.issueType.replaceAll("_", " ")}.`,
    })),
    validationStatus: status === "completed" ? "passed" : "passed_with_warnings",
    validationScore: assessment.validation?.score ?? null,
  };
  return {
    ...finalizeParseJob({ job, status, classification, schema, result, extractionMeta,
      message: "YouScan V2 AI extraction completed" }),
    authoritativeSource: "ai", aiCompleted: true,
    aiExtraction: { status, authoritativeSource: "ai", confidence: ai.confidence, meta: ai.meta },
  };
}
