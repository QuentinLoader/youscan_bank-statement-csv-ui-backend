/**
 * YouScan V2
 * Main classifier entry point.
 *
 * Batch 10 accuracy policy:
 * - strong deterministic classifications are authoritative and never call AI;
 * - AI fallback is separately feature-flagged and only eligible for weak or
 *   unknown deterministic classifications;
 * - low-confidence AI, deterministic/AI disagreement, or AI failure becomes
 *   needs_review rather than an automatic override;
 * - AI classification never extracts transactions.
 */

import { getAiConfig } from "../ai/config.js";
import { isAiError } from "../ai/errors.js";
import { DOCUMENT_TYPES, DOCUMENT_SUBTYPES } from "../registry/documentTypes.js";
import {
  isAiClassificationSupported,
} from "./aiClassificationContract.js";
import { aiClassifier } from "./aiClassifier.js";
import {
  classificationsAgree,
  isAiFallbackEligible,
  isStrongDeterministicClassification,
} from "./classificationPolicy.js";
import { heuristicClassifier } from "./heuristicClassifier.js";

function baseResult(classification, fileName, extras = {}) {
  return {
    ...classification,
    fileName,
    classificationMethod: "heuristic",
    aiAttempted: false,
    aiEligible: isAiFallbackEligible(classification),
    needsReview: false,
    classificationDecision: classification.supported ? "accepted" : "unsupported",
    ...extras,
  };
}

function compactCandidate(classification) {
  return {
    documentType: classification?.documentType || DOCUMENT_TYPES.UNKNOWN,
    documentSubtype: classification?.documentSubtype || DOCUMENT_SUBTYPES.UNKNOWN,
    confidence: Number.isFinite(classification?.confidence)
      ? classification.confidence
      : 0,
    supported: Boolean(classification?.supported),
  };
}

function aiCandidate(aiResult) {
  return {
    documentType: aiResult.data.documentType,
    documentSubtype: aiResult.data.documentSubtype,
    confidence: aiResult.confidence,
    supported: isAiClassificationSupported(aiResult.data),
  };
}

function reviewResult({ heuristic, aiResult = null, fileName, reason, errorCode = null }) {
  const candidate = aiResult ? aiCandidate(aiResult) : null;

  return {
    documentType:
      heuristic.documentType === candidate?.documentType
        ? heuristic.documentType
        : DOCUMENT_TYPES.UNKNOWN,
    documentSubtype: DOCUMENT_SUBTYPES.UNKNOWN,
    confidence: aiResult
      ? Math.min(heuristic.confidence || 0, aiResult.confidence || 0)
      : heuristic.confidence,
    supported: false,
    reasons: [reason],
    suggestedPipeline: null,
    fileName,
    classificationMethod: aiResult ? "heuristic_ai_review" : "heuristic_ai_failed",
    aiAttempted: true,
    aiEligible: true,
    aiConfidence: aiResult?.confidence ?? null,
    needsReview: true,
    classificationDecision: "needs_review",
    deterministicCandidate: compactCandidate(heuristic),
    aiCandidate: candidate,
    aiErrorCode: errorCode,
  };
}

function acceptedAiResult({ heuristic, aiResult, fileName }) {
  const supported = isAiClassificationSupported(aiResult.data);

  return {
    documentType: aiResult.data.documentType,
    documentSubtype: aiResult.data.documentSubtype,
    confidence: aiResult.confidence,
    supported,
    reasons: [
      "AI fallback resolved a weak or unknown deterministic classification",
      ...aiResult.evidence.slice(0, 3),
    ],
    suggestedPipeline: supported ? "bank_statement_v2" : null,
    fileName,
    classificationMethod: "ai_fallback",
    aiAttempted: true,
    aiEligible: true,
    aiConfidence: aiResult.confidence,
    needsReview: false,
    classificationDecision: supported ? "accepted" : "unsupported",
    deterministicCandidate: compactCandidate(heuristic),
    aiCandidate: aiCandidate(aiResult),
    aiWarnings: aiResult.warnings.slice(0, 5),
    aiMeta: aiResult.meta,
  };
}

export async function classifyDocument({
  extractedText = "",
  fileName = "",
  aiConfig = null,
  aiProvider = null,
  aiLogger = null,
} = {}) {
  const heuristic = heuristicClassifier(extractedText);
  const initial = baseResult(heuristic, fileName);

  if (isStrongDeterministicClassification(heuristic)) {
    return {
      ...initial,
      aiEligible: false,
      classificationDecision: heuristic.supported ? "accepted" : "unsupported",
    };
  }

  let config;
  try {
    config = aiConfig || getAiConfig();
  } catch (error) {
    // A bad AI configuration must not break deterministic parsing while the
    // classifier feature itself is not active.
    if (!aiConfig && !process.env.YOUSCAN_V2_AI_CLASSIFIER_ENABLED) {
      return initial;
    }
    throw error;
  }

  if (!config.enabled || !config.classifierEnabled) {
    return initial;
  }

  try {
    const aiResult = await aiClassifier({
      extractedText,
      fileName,
      config,
      provider: aiProvider,
      logger: aiLogger,
    });

    if (aiResult.confidence < config.classificationMinConfidence) {
      return reviewResult({
        heuristic,
        aiResult,
        fileName,
        reason: `AI classification confidence ${aiResult.confidence.toFixed(2)} is below the required ${config.classificationMinConfidence.toFixed(2)}`,
      });
    }

    if (!classificationsAgree(heuristic, aiResult.data)) {
      return reviewResult({
        heuristic,
        aiResult,
        fileName,
        reason: "Deterministic and AI classification evidence disagree",
      });
    }

    return acceptedAiResult({ heuristic, aiResult, fileName });
  } catch (error) {
    const errorCode = isAiError(error) ? error.code : "V2_AI_CLASSIFICATION_FAILED";
    return reviewResult({
      heuristic,
      fileName,
      reason: "AI classification fallback could not be completed safely",
      errorCode,
    });
  }
}
