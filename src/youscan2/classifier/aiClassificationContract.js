/**
 * YouScan V2
 * Strict AI classification contract for Batch 10.
 */

import { DOCUMENT_TYPES, DOCUMENT_SUBTYPES } from "../registry/documentTypes.js";
import { isImplementedV2BankSubtype } from "../registry/bankSupport.js";

const DOCUMENT_TYPE_VALUES = Object.freeze(Object.values(DOCUMENT_TYPES));
const DOCUMENT_SUBTYPE_VALUES = Object.freeze(Object.values(DOCUMENT_SUBTYPES));

const BANK_SUBTYPES = new Set([
  DOCUMENT_SUBTYPES.ABSA_STATEMENT,
  DOCUMENT_SUBTYPES.FNB_STATEMENT,
  DOCUMENT_SUBTYPES.NEDBANK_STATEMENT,
  DOCUMENT_SUBTYPES.CAPITEC_STATEMENT,
  DOCUMENT_SUBTYPES.DISCOVERY_STATEMENT,
  DOCUMENT_SUBTYPES.STANDARD_BANK_STATEMENT,
  DOCUMENT_SUBTYPES.UNKNOWN,
]);

const EXPECTED_SUBTYPE_BY_TYPE = Object.freeze({
  [DOCUMENT_TYPES.INVOICE]: DOCUMENT_SUBTYPES.GENERIC_INVOICE,
  [DOCUMENT_TYPES.DELIVERY_NOTE]: DOCUMENT_SUBTYPES.GENERIC_DELIVERY_NOTE,
  [DOCUMENT_TYPES.PROOF_OF_DELIVERY]: DOCUMENT_SUBTYPES.GENERIC_POD,
  [DOCUMENT_TYPES.WAYBILL]: DOCUMENT_SUBTYPES.GENERIC_WAYBILL,
  [DOCUMENT_TYPES.UNKNOWN]: DOCUMENT_SUBTYPES.UNKNOWN,
});

export const AI_CLASSIFICATION_RESPONSE_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    documentType: {
      type: "string",
      enum: DOCUMENT_TYPE_VALUES,
    },
    documentSubtype: {
      type: "string",
      enum: DOCUMENT_SUBTYPE_VALUES,
    },
  },
  required: ["documentType", "documentSubtype"],
  additionalProperties: false,
});

export function validateAiClassificationData(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { valid: false, message: "AI classification data must be an object" };
  }

  if (!DOCUMENT_TYPE_VALUES.includes(data.documentType)) {
    return {
      valid: false,
      message: "AI classification documentType is not allowed",
      issues: ["documentType"],
    };
  }

  if (!DOCUMENT_SUBTYPE_VALUES.includes(data.documentSubtype)) {
    return {
      valid: false,
      message: "AI classification documentSubtype is not allowed",
      issues: ["documentSubtype"],
    };
  }

  if (data.documentType === DOCUMENT_TYPES.BANK_STATEMENT) {
    if (!BANK_SUBTYPES.has(data.documentSubtype)) {
      return {
        valid: false,
        message: "AI bank-statement subtype is inconsistent with documentType",
        issues: ["documentSubtype"],
      };
    }
    return { valid: true };
  }

  const expectedSubtype = EXPECTED_SUBTYPE_BY_TYPE[data.documentType];
  if (expectedSubtype && data.documentSubtype !== expectedSubtype) {
    return {
      valid: false,
      message: "AI document subtype is inconsistent with documentType",
      issues: ["documentSubtype"],
    };
  }

  return { valid: true };
}

export function isAiClassificationSupported(data) {
  return (
    data?.documentType === DOCUMENT_TYPES.BANK_STATEMENT &&
    isImplementedV2BankSubtype(data?.documentSubtype)
  );
}
