/**
 * YouScan V2
 * Accuracy-first classification policy.
 */

import { DOCUMENT_SUBTYPES } from "../registry/documentTypes.js";

export const STRONG_DETERMINISTIC_CONFIDENCE = 0.9;

export function hasSpecificDeterministicSubtype(classification) {
  return Boolean(
    classification?.documentSubtype &&
      classification.documentSubtype !== DOCUMENT_SUBTYPES.UNKNOWN
  );
}

export function isStrongDeterministicClassification(classification) {
  return Boolean(
    hasSpecificDeterministicSubtype(classification) &&
      Number.isFinite(classification?.confidence) &&
      classification.confidence >= STRONG_DETERMINISTIC_CONFIDENCE
  );
}

export function isAiFallbackEligible(classification) {
  return !isStrongDeterministicClassification(classification);
}

export function classificationsAgree(deterministic, aiData) {
  if (!hasSpecificDeterministicSubtype(deterministic)) return true;

  return (
    deterministic.documentType === aiData?.documentType &&
    deterministic.documentSubtype === aiData?.documentSubtype
  );
}
