/**
 * YouScan 2.0
 * Heuristic document classifier
 */

import { DOCUMENT_TYPES, DOCUMENT_SUBTYPES } from "../registry/documentTypes.js";

export function heuristicClassifier(text = "") {
  const lower = String(text).toLowerCase();

  if (
    lower.includes("absa") &&
    (lower.includes("opening balance") || lower.includes("closing balance"))
  ) {
    return {
      documentType: DOCUMENT_TYPES.BANK_STATEMENT,
      documentSubtype: DOCUMENT_SUBTYPES.ABSA_STATEMENT,
      confidence: 0.95,
      supported: true,
      reasons: ["Found ABSA branding", "Found statement balance terms"],
      suggestedPipeline: "bank_statement_v2",
    };
  }

  if (
    lower.includes("fnb") &&
    (lower.includes("opening balance") || lower.includes("closing balance"))
  ) {
    return {
      documentType: DOCUMENT_TYPES.BANK_STATEMENT,
      documentSubtype: DOCUMENT_SUBTYPES.FNB_STATEMENT,
      confidence: 0.95,
      supported: true,
      reasons: ["Found FNB branding", "Found statement balance terms"],
      suggestedPipeline: "bank_statement_v2",
    };
  }

  if (
    lower.includes("invoice") ||
    lower.includes("tax invoice") ||
    lower.includes("vat")
  ) {
    return {
      documentType: DOCUMENT_TYPES.INVOICE,
      documentSubtype: DOCUMENT_SUBTYPES.GENERIC_INVOICE,
      confidence: 0.85,
      supported: false,
      reasons: ["Found invoice-related terms"],
      suggestedPipeline: null,
    };
  }

  if (
    lower.includes("delivery note") ||
    lower.includes("proof of delivery") ||
    lower.includes("waybill")
  ) {
    return {
      documentType: DOCUMENT_TYPES.DELIVERY_NOTE,
      documentSubtype: DOCUMENT_SUBTYPES.GENERIC_DELIVERY_NOTE,
      confidence: 0.8,
      supported: false,
      reasons: ["Found logistics document terms"],
      suggestedPipeline: null,
    };
  }

  return {
    documentType: DOCUMENT_TYPES.UNKNOWN,
    documentSubtype: DOCUMENT_SUBTYPES.UNKNOWN,
    confidence: 0.2,
    supported: false,
    reasons: ["No strong document signals found"],
    suggestedPipeline: null,
  };
}