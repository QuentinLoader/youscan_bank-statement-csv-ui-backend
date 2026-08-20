/**
 * YouScan V2
 * Bank Statement Plugin
 */

import { DOCUMENT_TYPES } from "../../registry/documentTypes.js";
import { PARSE_JOB_STATUSES, VALIDATION_STATUSES } from "../../schemas/common.js";
import { extractBankStatement } from "./bankStatement.extractor.js";
import { normalizeBankStatement } from "./bankStatement.normalizer.js";
import { validateBankStatement } from "./bankStatement.validator.js";

function mapValidationToParseStatus(validation) {
  if (validation?.status === VALIDATION_STATUSES.PASSED) {
    return PARSE_JOB_STATUSES.COMPLETED;
  }

  if (validation?.status === VALIDATION_STATUSES.PASSED_WITH_WARNINGS) {
    return PARSE_JOB_STATUSES.NEEDS_REVIEW;
  }

  return PARSE_JOB_STATUSES.FAILED;
}

export const bankStatementPlugin = {
  key: "bank_statement.generic.v2",
  documentType: DOCUMENT_TYPES.BANK_STATEMENT,

  canHandle(classification) {
    return classification.documentType === DOCUMENT_TYPES.BANK_STATEMENT;
  },

  async extract(context) {
    return extractBankStatement(context);
  },

  async normalize(raw, context) {
    return normalizeBankStatement(raw, context);
  },

  async validate(normalized, context) {
    return validateBankStatement(normalized, context);
  },

  async toFinalResult({ jobId, classification, normalized, validation }) {
    return {
      jobId,
      documentType: classification.documentType,
      documentSubtype: classification.documentSubtype,
      parserKey: this.key,
      parserVersion: "2.0.0",
      schemaKey: "bank_statement.v1",
      confidence: classification.confidence,
      validationStatus: validation.status,
      validationScore: validation.score,
      issues: validation.issues,
      data: normalized,
      status: mapValidationToParseStatus(validation),
    };
  },
};
