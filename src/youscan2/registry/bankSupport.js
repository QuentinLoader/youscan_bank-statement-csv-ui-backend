/**
 * YouScan V2
 * Bank support registry.
 *
 * Batch 01 intentionally marks only the bank parsers that are genuinely
 * implemented inside V2 as supported. Other known banks remain detectable,
 * but are not allowed to fall through to another bank's extractor.
 */

import { DOCUMENT_SUBTYPES } from "./documentTypes.js";

export const V2_RECOGNIZED_BANK_SUBTYPES = Object.freeze([
  DOCUMENT_SUBTYPES.ABSA_STATEMENT,
  DOCUMENT_SUBTYPES.FNB_STATEMENT,
  DOCUMENT_SUBTYPES.NEDBANK_STATEMENT,
  DOCUMENT_SUBTYPES.CAPITEC_STATEMENT,
  DOCUMENT_SUBTYPES.DISCOVERY_STATEMENT,
  DOCUMENT_SUBTYPES.STANDARD_BANK_STATEMENT,
]);

export const V2_IMPLEMENTED_BANK_SUBTYPES = Object.freeze([
  DOCUMENT_SUBTYPES.ABSA_STATEMENT,
  DOCUMENT_SUBTYPES.FNB_STATEMENT,
  DOCUMENT_SUBTYPES.CAPITEC_STATEMENT,
  DOCUMENT_SUBTYPES.NEDBANK_STATEMENT,
  DOCUMENT_SUBTYPES.DISCOVERY_STATEMENT,
  DOCUMENT_SUBTYPES.STANDARD_BANK_STATEMENT,
]);

const BANK_NAMES = Object.freeze({
  [DOCUMENT_SUBTYPES.ABSA_STATEMENT]: "ABSA",
  [DOCUMENT_SUBTYPES.FNB_STATEMENT]: "FNB",
  [DOCUMENT_SUBTYPES.NEDBANK_STATEMENT]: "Nedbank",
  [DOCUMENT_SUBTYPES.CAPITEC_STATEMENT]: "Capitec",
  [DOCUMENT_SUBTYPES.DISCOVERY_STATEMENT]: "Discovery Bank",
  [DOCUMENT_SUBTYPES.STANDARD_BANK_STATEMENT]: "Standard Bank",
});

export function isRecognizedV2BankSubtype(subtype) {
  return V2_RECOGNIZED_BANK_SUBTYPES.includes(subtype);
}

export function isImplementedV2BankSubtype(subtype) {
  return V2_IMPLEMENTED_BANK_SUBTYPES.includes(subtype);
}

export function getBankNameForSubtype(subtype) {
  return BANK_NAMES[subtype] || "Unknown";
}
