/**
 * YouScan 2.0
 * Schema registry
 */

import { DOCUMENT_TYPES } from "./documentTypes.js";

export const schemaRegistry = {
  "bank_statement.v1": {
    schemaKey: "bank_statement.v1",
    documentType: DOCUMENT_TYPES.BANK_STATEMENT,
    version: "2.0.0",
    parserKey: "bank_statement.generic.v2",
    validatorKey: "bank_statement.validator.v2",
    normalizerKey: "bank_statement.normalizer.v2",
    active: true,
  },

  "invoice.v1": {
    schemaKey: "invoice.v1",
    documentType: DOCUMENT_TYPES.INVOICE,
    version: "2.0.0",
    parserKey: "invoice.generic.v2",
    validatorKey: "invoice.validator.v2",
    normalizerKey: "invoice.normalizer.v2",
    active: false,
  },

  "delivery_note.v1": {
    schemaKey: "delivery_note.v1",
    documentType: DOCUMENT_TYPES.DELIVERY_NOTE,
    version: "2.0.0",
    parserKey: "delivery_note.generic.v2",
    validatorKey: "delivery_note.validator.v2",
    normalizerKey: "delivery_note.normalizer.v2",
    active: false,
  },
};

export function getActiveSchemaForDocumentType(documentType) {
  return Object.values(schemaRegistry).find(
    (entry) => entry.documentType === documentType && entry.active
  ) || null;
}