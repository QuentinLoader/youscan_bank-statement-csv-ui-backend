/**
 * YouScan V2
 * AI extraction shadow-mode orchestrator.
 *
 * Deterministic output remains authoritative. Public shadow reports deliberately
 * exclude AI-extracted field values and source evidence. Batch 15 adds a
 * non-enumerable internal canonical candidate that can be consumed immediately
 * by the human-review proposal layer without making those values part of the
 * privacy-safe shadow report or normal JSON serialization.
 */

import { getAiConfig } from "../config.js";
import { isAiError } from "../errors.js";
import { getBankNameForSubtype } from "../../registry/bankSupport.js";
import { aiBankStatementExtractor } from "./aiBankStatementExtractor.js";
import {
  AI_EXTRACTION_DISPOSITIONS,
  assessAiBankStatementExtraction,
} from "./assessCandidate.js";
import { compareAiToDeterministicBankStatement } from "./compareCandidate.js";
import { analyzeShadowDisagreements } from "./disagreementAnalysis.js";

export const AI_SHADOW_STATUSES = Object.freeze({
  DISABLED: "disabled",
  EXACT_MATCH: "exact_match",
  DIFFERENCES: "differences",
  NEEDS_REVIEW: "needs_review",
  REJECTED: "rejected",
  UNAVAILABLE: "unavailable",
});

const INTERNAL_CANONICAL = Symbol("youscan2.ai.shadow.internalCanonical");

function attachInternalCanonical(report, canonical) {
  if (!report || !canonical) return report;
  Object.defineProperty(report, INTERNAL_CANONICAL, {
    value: canonical,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return report;
}

/**
 * Internal-only accessor used by the correction-proposal domain layer.
 * The value is intentionally unavailable through JSON.stringify/report logs.
 */
export function getAiShadowInternalCanonical(shadowReport) {
  return shadowReport?.[INTERNAL_CANONICAL] || null;
}

function safeAssessmentSummary(assessment) {
  return {
    disposition: assessment.disposition,
    eligibleForComparison: Boolean(assessment.eligibleForComparison),
    issueTypes: [...new Set((assessment.issues || []).map((issue) => issue.issueType))],
    evidence: assessment.evidence
      ? {
          checkedFieldCount: assessment.evidence.checkedFieldCount,
          verifiedFieldCount: assessment.evidence.verifiedFieldCount,
          valid: assessment.evidence.valid,
        }
      : null,
    validation: assessment.validation
      ? {
          status: assessment.validation.status,
          score: assessment.validation.score,
          valid: assessment.validation.valid,
        }
      : null,
    summary: assessment.summary
      ? {
          errorCount: assessment.summary.errorCount,
          warningCount: assessment.summary.warningCount,
          transactionCount: assessment.summary.transactionCount,
        }
      : null,
  };
}

function safeAiMeta(aiResult) {
  return {
    confidence: aiResult.confidence,
    warningCount: Array.isArray(aiResult.warnings) ? aiResult.warnings.length : 0,
    provider: aiResult.meta?.provider || null,
    model: aiResult.meta?.model || null,
    requestId: aiResult.meta?.requestId || null,
    durationMs: aiResult.meta?.durationMs ?? null,
    usage: aiResult.meta?.usage || null,
  };
}

export async function runAiBankStatementShadow({
  extractedText = "",
  sourceFileName = null,
  classification = null,
  deterministicCanonical = null,
  config = null,
  provider = null,
  logger = null,
} = {}) {
  let resolvedConfig;
  try {
    resolvedConfig = config || getAiConfig();
  } catch (error) {
    return {
      mode: "shadow",
      attempted: false,
      authoritativeSource: "deterministic",
      aiCanAffectResult: false,
      status: AI_SHADOW_STATUSES.UNAVAILABLE,
      errorCode: isAiError(error) ? error.code : "V2_AI_SHADOW_CONFIG_FAILED",
      retryable: false,
      ai: null,
      assessment: null,
      comparison: null,
      disagreement: null,
    };
  }

  if (!resolvedConfig.enabled || !resolvedConfig.extractionEnabled) {
    return {
      mode: "shadow",
      attempted: false,
      authoritativeSource: "deterministic",
      aiCanAffectResult: false,
      status: AI_SHADOW_STATUSES.DISABLED,
      errorCode: null,
      retryable: false,
      ai: null,
      assessment: null,
      comparison: null,
      disagreement: null,
    };
  }

  try {
    const aiResult = await aiBankStatementExtractor({
      extractedText,
      config: resolvedConfig,
      provider,
      logger,
    });

    const expectedBankName =
      deterministicCanonical?.bankName ||
      getBankNameForSubtype(classification?.documentSubtype);

    const assessment = await assessAiBankStatementExtraction({
      candidate: aiResult.data,
      envelopeConfidence: aiResult.confidence,
      sourceText: extractedText,
      sourceFileName,
      expectedBankName,
      minEnvelopeConfidence: resolvedConfig.extractionMinConfidence,
      minFieldConfidence: resolvedConfig.extractionFieldMinConfidence,
    });

    let comparison = null;
    let disagreement = null;
    let status;

    if (assessment.disposition === AI_EXTRACTION_DISPOSITIONS.ELIGIBLE_FOR_COMPARISON) {
      comparison = compareAiToDeterministicBankStatement({
        aiCanonical: assessment.canonical,
        deterministicCanonical,
      });
      disagreement = analyzeShadowDisagreements(comparison);
      status = comparison.exactMatch
        ? AI_SHADOW_STATUSES.EXACT_MATCH
        : AI_SHADOW_STATUSES.DIFFERENCES;
    } else if (assessment.disposition === AI_EXTRACTION_DISPOSITIONS.NEEDS_REVIEW) {
      status = AI_SHADOW_STATUSES.NEEDS_REVIEW;
    } else {
      status = AI_SHADOW_STATUSES.REJECTED;
    }

    const report = {
      mode: "shadow",
      attempted: true,
      authoritativeSource: "deterministic",
      aiCanAffectResult: false,
      status,
      errorCode: null,
      retryable: false,
      ai: safeAiMeta(aiResult),
      assessment: safeAssessmentSummary(assessment),
      comparison,
      disagreement,
    };

    if (assessment.eligibleForComparison && assessment.canonical) {
      attachInternalCanonical(report, assessment.canonical);
    }

    return report;
  } catch (error) {
    return {
      mode: "shadow",
      attempted: true,
      authoritativeSource: "deterministic",
      aiCanAffectResult: false,
      status: AI_SHADOW_STATUSES.UNAVAILABLE,
      errorCode: isAiError(error) ? error.code : "V2_AI_SHADOW_FAILED",
      retryable: Boolean(error?.retryable),
      ai: null,
      assessment: null,
      comparison: null,
      disagreement: null,
    };
  }
}
