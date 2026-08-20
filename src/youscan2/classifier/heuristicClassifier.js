/**
 * YouScan V2
 * Heuristic document classifier.
 */

import { DOCUMENT_TYPES, DOCUMENT_SUBTYPES } from "../registry/documentTypes.js";
import { isImplementedV2BankSubtype } from "../registry/bankSupport.js";
import { extractDocumentSignals } from "./signals.js";

function buildDetectedBankResult(detectedBank, signalCount) {
  const implemented = isImplementedV2BankSubtype(detectedBank.subtype);

  return {
    documentType: DOCUMENT_TYPES.BANK_STATEMENT,
    documentSubtype: detectedBank.subtype,
    confidence: signalCount >= 2 ? 0.98 : 0.82,
    supported: implemented,
    reasons: [
      `Found ${detectedBank.label} branding`,
      signalCount >= 2
        ? "Found multiple bank statement signals"
        : "Found bank branding with limited statement structure",
      implemented
        ? "A dedicated V2 parser is implemented for this bank"
        : "Bank recognized, but its dedicated V2 parser is not implemented yet",
    ],
    suggestedPipeline: implemented ? "bank_statement_v2" : null,
  };
}

export function heuristicClassifier(text = "") {
  const signals = extractDocumentSignals(text);

  if (signals.detectedBank && signals.bankStatementSignalCount >= 1) {
    return buildDetectedBankResult(
      signals.detectedBank,
      signals.bankStatementSignalCount
    );
  }

  if (signals.bankStatementSignalCount >= 3) {
    return {
      documentType: DOCUMENT_TYPES.BANK_STATEMENT,
      documentSubtype: DOCUMENT_SUBTYPES.UNKNOWN,
      confidence: 0.85,
      supported: false,
      reasons: [
        "Found strong generic bank statement structure",
        "No generic V2 bank parser is enabled in Batch 01",
      ],
      suggestedPipeline: null,
    };
  }

  if (signals.invoiceSignal) {
    return {
      documentType: DOCUMENT_TYPES.INVOICE,
      documentSubtype: DOCUMENT_SUBTYPES.GENERIC_INVOICE,
      confidence: 0.7,
      supported: false,
      reasons: ["Found invoice-related terms"],
      suggestedPipeline: null,
    };
  }

  if (signals.deliveryNoteSignal) {
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
