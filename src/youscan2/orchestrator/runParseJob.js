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

function sanitizeDiagnosticMessage(value) {
  return String(value || "Unknown V2 parse failure")
    .replace(/[\r\n\t]+/g, " ")
    .replace(
      /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
      "[redacted-email]"
    )
    .replace(/\b\d{6,}\b/g, "[redacted-number]")
    .slice(0, 240);
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
  let stage = "classification";

  try {
    stage = "classification";
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

    stage = "schema.resolve";
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

    stage = "parser.resolve";
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

    stage = "parser.extract";
    const raw = await parser.extract(context);

    stage = "parser.normalize";
    const normalized = await parser.normalize(raw, context);

    stage = "parser.validate";
    const validation = await parser.validate(normalized, context);

    stage = "parser.toFinalResult";
    const finalResult = await parser.toFinalResult({
      jobId: job.jobId,
      classification,
      normalized,
      validation,
    });
if (finalResult?.status === PARSE_JOB_STATUSES.FAILED) {
  const issueTypes = Array.isArray(finalResult?.issues)
    ? [
        ...new Set(
          finalResult.issues
            .map(
              (issue) =>
                issue?.issueType ||
                issue?.code ||
                "unknown"
            )
            .filter(Boolean)
        ),
      ].slice(0, 20)
    : [];

  console.error(
    "V2 PARSE RESULT FAILED:",
    JSON.stringify({
      subtype:
        classification?.documentSubtype ||
        null,

      rawTransactionCount:
        Array.isArray(raw?.transactions)
          ? raw.transactions.length
          : null,

      normalizedTransactionCount:
        Array.isArray(
          normalized?.transactions
        )
          ? normalized.transactions.length
          : null,

      finalTransactionCount:
        Array.isArray(
          finalResult?.data?.transactions
        )
          ? finalResult.data.transactions.length
          : null,

      validationStatus:
        validation?.status || null,

      issueTypes,
    })
  );
}
    const status =
      finalResult.status === PARSE_JOB_STATUSES.COMPLETED
        ? PARSE_JOB_STATUSES.COMPLETED
        : finalResult.status === PARSE_JOB_STATUSES.NEEDS_REVIEW
          ? PARSE_JOB_STATUSES.NEEDS_REVIEW
          : PARSE_JOB_STATUSES.FAILED;

    stage = "finalize";
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
      stage = "shadow_ai";
      const shadowAi = await runAiBankStatementShadow({
        extractedText,
        sourceFileName: file?.originalname || null,
        classification,
        deterministicCanonical: finalResult.data,
        ...(shadowAiOptions || {}),
      });

      stage = "ai_decision";
      const aiDecision = evaluateAiDecisionPolicy({
        shadowAi,
        deterministicStatus: status,
        deterministicIssues: finalResult?.issues || [],
      });

      stage = "ai_correction_proposal";
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
    const errorCode = error?.code || "V2_PARSE_FAILED";
    const errorMessage = error?.message || "Unknown V2 parse failure";

    console.error(
      "V2 PARSE JOB FAILURE:",
      JSON.stringify({
        stage,
        code: errorCode,
        name: error?.name || "Error",
        subtype: classification?.documentSubtype || null,
        message: sanitizeDiagnosticMessage(errorMessage),
      })
    );

    return finalizeParseJob({
      job,
      status: PARSE_JOB_STATUSES.FAILED,
      classification,
      schema,
      result: null,
      extractionMeta,
      message: "YouScan V2 parse job failed",
      error: {
        code: errorCode,
        message: errorMessage,
      },
    });
  }
}
