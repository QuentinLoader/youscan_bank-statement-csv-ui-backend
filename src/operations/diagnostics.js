import { summarizeAiValidationIssues } from '../youscan2/ai/validationDiagnostics.js';
import { V2_RECOGNIZED_BANK_SUBTYPES } from '../youscan2/registry/bankSupport.js';

const codes = new Set(['V2_AI_UNAVAILABLE','V2_AI_PROVIDER_FAILED','V2_AI_PROVIDER_INCOMPLETE',
  'V2_AI_TIMEOUT','V2_AI_INPUT_TOO_LARGE','V2_AI_CONFIG_INVALID','V2_AI_DISABLED','V2_AI_PROVIDER_INVALID',
  'V2_AI_QUOTA_EXHAUSTED','V2_AI_RATE_LIMITED','V2_PDF_VISION_FAILED','V2_AI_INVALID_RESPONSE',
  'V2_AI_ANALYSIS_REJECTED','V2_AI_PROVIDER_REFUSED','V2_UNSUPPORTED_DOCUMENT','V2_PARSE_EMPTY',
  'V2_PARSE_FAILED','V2_BATCH_LIMIT','LIMIT_FILE_COUNT','LIMIT_FILE_SIZE','NO_FILE_UPLOADED',
  'V2_PDF_READ_FAILED','V2_PDF_EMPTY','V2_FILE_TYPE_UNSUPPORTED',
  'SUBSCRIPTION_EXPIRED','CREDITS_EXHAUSTED','FREE_LIMIT_REACHED','INVALID_PLAN','EMAIL_NOT_VERIFIED','PLAN_CHECK_FAILED']);
const reasons = new Set(['insufficient_quota','rate_limit_exceeded','invalid_api_key',
  'authentication_error','permission_denied','server_error','overloaded_error',
  'invalid_request_error','timeout','incomplete','context_length_exceeded']);
export const stages = new Set(['availability','upload','pdf_reading','ai_extraction','validation','completed']);
export function safeDiagnostic(error) {
  error = error?.providerFailure || error;
  const status = Number(error?.details?.status || error?.status);
  const reason = error?.details?.providerCode || error?.details?.providerType;
  const requestId = error?.details?.requestId;
  return {
    code: codes.has(error?.code) ? error.code : 'V2_PARSE_FAILED',
    reason: reasons.has(reason) ? reason : status === 401 ? 'authentication_error' :
      status === 403 ? 'permission_denied' : status === 429 ? 'rate_limit_exceeded' : 'unspecified',
    providerStatus: Number.isInteger(status) && status >= 100 && status <= 599 ? status : null,
    // Provider IDs have a constrained prefix; arbitrary upstream strings are never retained.
    providerRequestId: typeof requestId === 'string' && /^(req_|req-)[a-zA-Z0-9_-]{8,100}$/.test(requestId) ? requestId : null,
    fields: summarizeAiValidationIssues(error?.details?.issues),
    retryable: !['V2_AI_CONFIG_INVALID','V2_AI_DISABLED','V2_AI_PROVIDER_INVALID','V2_UNSUPPORTED_DOCUMENT'].includes(error?.code),
  };
}

export function safeExtractionAudit(parseResult, extractionMeta) {
  const unit = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
  const allowedTypes = new Set(['low_field_confidence','low_envelope_confidence','possible_duplicate_transaction',
    'transaction_outside_statement_period','statement_total_reconciliation_mismatch','source_amount_precision_issue',
    'bank_name_disagreement','invalid_statement_period_start','invalid_statement_period_end','statement_period_reversed',
    'canonical_balance_mismatch','canonical_missing_opening_balance','canonical_missing_closing_balance']);
  const issues = (parseResult?.result?.issues || []).slice(0,500).map(issue => ({
    reason: allowedTypes.has(issue.issueType) ? issue.issueType : 'validation_warning',
    field: /^(openingBalance|closingBalance|statementPeriodStart|statementPeriodEnd|transactions\[\d{1,4}\]\.(date|amount|fee|balance|description))$/.test(issue.fieldPath || '') ? issue.fieldPath : null,
    rowIndex: Number.isInteger(issue.rowIndex) && issue.rowIndex >= 0 && issue.rowIndex < 10000 ? issue.rowIndex : null,
    confidence: unit(issue.confidence),
  }));
  const subtype = parseResult?.classification?.documentSubtype;
  return { warnings: issues, validationScore: unit(parseResult?.result?.validationScore), confidence: unit(parseResult?.aiExtraction?.confidence),
    classificationConfidence: unit(parseResult?.classification?.confidence),
    source: 'ai', bank: V2_RECOGNIZED_BANK_SUBTYPES.includes(subtype) ? subtype : 'unknown',
    pageCount: Number.isInteger(extractionMeta?.pages) && extractionMeta.pages > 0 ? extractionMeta.pages : null };
}
