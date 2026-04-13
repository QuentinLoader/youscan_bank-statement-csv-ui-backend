/**
 * YouScan 2.0
 * Heuristic document classifier
 */

import { DOCUMENT_TYPES, DOCUMENT_SUBTYPES } from "../registry/documentTypes.js";

export function heuristicClassifier(text = "") {
  const lower = String(text).toLowerCase();

  const hasAbsa = lower.includes("absa");
  const hasFnb = lower.includes("fnb") || lower.includes("first national bank");
  const hasNedbank = lower.includes("nedbank");
  const hasCapitec = lower.includes("capitec");
  const hasDiscovery = lower.includes("discovery");
  const hasStandardBank =
    lower.includes("standard bank") ||
    lower.includes("stanbic") ||
    lower.includes("blue wallet") ||
    lower.includes("mymo");

  const hasOpeningBalance =
    lower.includes("opening balance") ||
    lower.includes("balance brought forward") ||
    lower.includes("bal brought forward");

  const hasClosingBalance =
    lower.includes("closing balance") ||
    lower.includes("final balance") ||
    lower.includes("current balance");

  const hasTransactionDate =
    lower.includes("transaction date") ||
    lower.includes("date description") ||
    lower.includes("date details");

  const hasDebit =
    lower.includes("debit") ||
    lower.includes("debits");

  const hasCredit =
    lower.includes("credit") ||
    lower.includes("credits");

  const hasBalance =
    lower.includes("balance");

  const bankSignalCount = [
    hasOpeningBalance,
    hasClosingBalance,
    hasTransactionDate,
    hasDebit,
    hasCredit,
    hasBalance,
  ].filter(Boolean).length;

  if (hasAbsa && bankSignalCount >= 2) {
    return {
      documentType: DOCUMENT_TYPES.BANK_STATEMENT,
      documentSubtype: DOCUMENT_SUBTYPES.ABSA_STATEMENT,
      confidence: 0.98,
      supported: true,
      reasons: ["Found ABSA branding", "Found multiple bank statement signals"],
      suggestedPipeline: "bank_statement_v2",
    };
  }

  if (hasFnb && bankSignalCount >= 2) {
    return {
      documentType: DOCUMENT_TYPES.BANK_STATEMENT,
      documentSubtype: DOCUMENT_SUBTYPES.FNB_STATEMENT,
      confidence: 0.98,
      supported: true,
      reasons: ["Found FNB branding", "Found multiple bank statement signals"],
      suggestedPipeline: "bank_statement_v2",
    };
  }

  if (hasNedbank && bankSignalCount >= 2) {
    return {
      documentType: DOCUMENT_TYPES.BANK_STATEMENT,
      documentSubtype: DOCUMENT_SUBTYPES.NEDBANK_STATEMENT,
      confidence: 0.98,
      supported: true,
      reasons: ["Found Nedbank branding", "Found multiple bank statement signals"],
      suggestedPipeline: "bank_statement_v2",
    };
  }

  if (hasCapitec && bankSignalCount >= 2) {
    return {
      documentType: DOCUMENT_TYPES.BANK_STATEMENT,
      documentSubtype: DOCUMENT_SUBTYPES.CAPITEC_STATEMENT,
      confidence: 0.98,
      supported: true,
      reasons: ["Found Capitec branding", "Found multiple bank statement signals"],
      suggestedPipeline: "bank_statement_v2",
    };
  }

  if (hasDiscovery && bankSignalCount >= 2) {
    return {
      documentType: DOCUMENT_TYPES.BANK_STATEMENT,
      documentSubtype: DOCUMENT_SUBTYPES.DISCOVERY_STATEMENT,
      confidence: 0.98,
      supported: true,
      reasons: ["Found Discovery branding", "Found multiple bank statement signals"],
      suggestedPipeline: "bank_statement_v2",
    };
  }

  if (hasStandardBank && bankSignalCount >= 2) {
    return {
      documentType: DOCUMENT_TYPES.BANK_STATEMENT,
      documentSubtype: DOCUMENT_SUBTYPES.STANDARD_BANK_STATEMENT,
      confidence: 0.98,
      supported: true,
      reasons: ["Found Standard Bank branding", "Found multiple bank statement signals"],
      suggestedPipeline: "bank_statement_v2",
    };
  }

  if (bankSignalCount >= 3) {
    return {
      documentType: DOCUMENT_TYPES.BANK_STATEMENT,
      documentSubtype: DOCUMENT_SUBTYPES.UNKNOWN,
      confidence: 0.85,
      supported: true,
      reasons: ["Found strong generic bank statement structure"],
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
      confidence: 0.7,
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
      confidence: 0.7,
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