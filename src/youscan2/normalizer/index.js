import { DOCUMENT_SUBTYPES } from "../registry/documentTypes.js";
import { mapSubtypeToBankName } from "./shared/common.js";
import { normalizeAbsaTransactions } from "./absa/normalizer.js";
import { normalizeFnbTransactions } from "./fnb/normalizer.js";
import { normalizeCapitecTransactions } from "./capitec/normalizer.js";
import { normalizeNedbankTransactions } from "./nedbank/normalizer.js";
import { normalizeDiscoveryTransactions } from "./discovery/normalizer.js";
import { normalizeStandardBankTransactions } from "./standardbank/normalizer.js";

function normalizeTransactionsBySubtype(raw, subtype, metadata) {
  switch (subtype) {
    case DOCUMENT_SUBTYPES.ABSA_STATEMENT:
      return normalizeAbsaTransactions(raw?.transactions);

    case DOCUMENT_SUBTYPES.FNB_STATEMENT:
      return normalizeFnbTransactions(raw?.transactions);

    case DOCUMENT_SUBTYPES.CAPITEC_STATEMENT:
      return normalizeCapitecTransactions(raw?.transactions);

    case DOCUMENT_SUBTYPES.NEDBANK_STATEMENT:
      return normalizeNedbankTransactions(raw?.transactions);

    case DOCUMENT_SUBTYPES.DISCOVERY_STATEMENT:
      return normalizeDiscoveryTransactions(raw?.transactions);

    case DOCUMENT_SUBTYPES.STANDARD_BANK_STATEMENT:
      return normalizeStandardBankTransactions(
        raw?.transactions,
        metadata.statementPeriodEnd
      );

    default: {
      const error = new Error(
        `V2 bank normalizer is not implemented for subtype: ${subtype || "unknown"}`
      );
      error.code = "V2_BANK_NORMALIZER_NOT_IMPLEMENTED";
      throw error;
    }
  }
}

export function buildBankStatementNormalization(raw) {
  const metadata = raw?.metadata || {};
  const subtype = raw?.detectedSubtype || metadata.bankName || "";

  const transactions = normalizeTransactionsBySubtype(raw, subtype, metadata);

  return {
    bankName: mapSubtypeToBankName(subtype),
    accountNumber: metadata.accountNumber || null,
    clientName: metadata.clientName || null,
    statementPeriodStart: metadata.statementPeriodStart || null,
    statementPeriodEnd: metadata.statementPeriodEnd || null,
    openingBalance: metadata.openingBalance ?? null,
    closingBalance: metadata.closingBalance ?? null,
    transactions,
    sourceFileName: raw?.sourceFileName || null,
  };
}
