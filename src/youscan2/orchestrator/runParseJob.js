/**
 * YouScan V2
 * Parse job orchestrator.
 */

import { createAiCorrectionProposal } from "../ai/extraction/correctionProposal.js";
import { evaluateAiDecisionPolicy } from "../ai/extraction/decisionPolicy.js";
import { runAiBankStatementShadow } from "../ai/extraction/runShadowExtraction.js";
import { classifyDocument } from "../classifier/classifyDocument.js";
import { DOCUMENT_TYPES } from "../registry/documentTypes.js";
import { getParserByKey } from "../registry/parserRegistry.js";
import { getActiveSchemaForDocumentType } from "../registry/schemaRegistry.js";
import { PARSE_JOB_STATUSES } from "../schemas/common.js";
import { createParseJob } from "./createParseJob.js";
import { finalizeParseJob } from "./finalizeParseJob.js";

function envFlagEnabled(value) {
  return String(value || "").trim().toLowerCase() === "true";
}

function shouldRunShadowAi(shadowAiOptions) {
  if (shadowAiOptions) return true;
  return envFlagEnabled(process.env.YOUSCAN_V2_AI_EXTRACTION_ENABLED);
}

export async function runParseJob({
  file,
  extractedText = "",
  extractionMeta = null,
  classificationOptions = null,
  shadowAiOptions = null,
}) {
  const job = createParseJob({ file, extractionMeta });
  let classification = null;
  let schema = null;

  try {
    classification = await classifyDocument({
      extractedText,
      fileName: file?.originalname || "unknown",
      ...(classificationOptions || {}),
    });

    if (classification.needsReview) {
      return finalizeParseJob({
        job,
        status: PARSE_JOB_STATUSES.NEEDS_REVIEW,
        classification,
        schema: null,
        result: null,
        extractionMeta,
        message: "Document classification requires review before parsing",
      });
    }

    if (!classification.supported) {
      return finalizeParseJob({
        job,
        status: PARSE_JOB_STATUSES.UNSUPPORTED,
        classification,
        schema: null,
        result: null,
        extractionMeta,
        message: `Unsupported in current V2 build: ${classification.documentSubtype || classification.documentType}`,
      });
    }

    schema = getActiveSchemaForDocumentType(classification.documentType);

    if (!schema) {
      return finalizeParseJob({
        job,
        status: PARSE_JOB_STATUSES.UNSUPPORTED,
        classification,
        schema: null,
        result: null,
        extractionMeta,
        message: `No active V2 schema for document type: ${classification.documentType}`,
      });
    }

    const parser = getParserByKey(schema.parserKey);

    if (!parser) {
      return finalizeParseJob({
        job,
        status: PARSE_JOB_STATUSES.FAILED,
        classification,
        schema,
        result: null,
        extractionMeta,
        message: `No V2 parser found for key: ${schema.parserKey}`,
        error: {
          code: "V2_PARSER_NOT_FOUND",
        },
      });
    }

    const context = {
      jobId: job.jobId,
      file,
      extractedText,
      extractionMeta,
      textPreview: extractedText.slice(0, 2000),
      classification,
      schema,
    };

    const raw = await parser.extract(context);
    const normalized = await parser.normalize(raw, context);
    const validation = await parser.validate(normalized, context);

    const finalResult = await parser.toFinalResult({
      jobId: job.jobId,
      classification,
      normalized,
      validation,
    });

    const status =
      finalResult.status === PARSE_JOB_STATUSES.COMPLETED
        ? PARSE_JOB_STATUSES.COMPLETED
        : finalResult.status === PARSE_JOB_STATUSES.NEEDS_REVIEW
          ? PARSE_JOB_STATUSES.NEEDS_REVIEW
          : PARSE_JOB_STATUSES.FAILED;

    const finalEnvelope = finalizeParseJob({
      job,
      status,
      classification,
      schema,
      result: finalResult,
      extractionMeta,
      message: "YouScan V2 parse job completed",
    });

    // Batch 12: AI extraction is shadow-only. It is invoked only after the
    // deterministic result has been fully built, and its report is attached as
    // diagnostics without changing status/result/schema/classification.
    if (
      classification.documentType === DOCUMENT_TYPES.BANK_STATEMENT &&
      finalResult?.data &&
      shouldRunShadowAi(shadowAiOptions)
    ) {
      const shadowAi = await runAiBankStatementShadow({
        extractedText,
        sourceFileName: file?.originalname || null,
        classification,
        deterministicCanonical: finalResult.data,
        ...(shadowAiOptions || {}),
      });

      const aiDecision = evaluateAiDecisionPolicy({
        shadowAi,
        deterministicStatus: status,
        deterministicIssues: finalResult?.issues || [],
      });

      const aiCorrectionProposal = createAiCorrectionProposal({
        shadowAi,
        aiDecision,
        deterministicCanonical: finalResult.data,
      });

      return {
        ...finalEnvelope,
        shadowAi,
        aiDecision,
        aiCorrectionProposal,
      };
    }

    return finalEnvelope;
  } catch (error) {
    return finalizeParseJob({
      job,
      status: PARSE_JOB_STATUSES.FAILED,
      classification,
      schema,
      result: null,
      extractionMeta,
      message: "YouScan V2 parse job failed",
      error: {
        code: error?.code || "V2_PARSE_FAILED",
        message: error?.message || "Unknown V2 parse failure",
      },
    });
  }
}
