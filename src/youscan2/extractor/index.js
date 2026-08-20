import { DOCUMENT_SUBTYPES } from "../registry/documentTypes.js";
import { extractAbsaTransactions } from "./absa/extractor.js";
import { extractFnbTransactions } from "./fnb/extractor.js";
import { extractCapitecTransactions } from "./capitec/extractor.js";
import { extractNedbankTransactions } from "./nedbank/extractor.js";
import { extractDiscoveryTransactions } from "./discovery/extractor.js";
import {
  extractStandardBankTransactions,
  deriveStandardBankOpeningBalanceFromFirstTransaction,
} from "./standardBank/extractor.js";
import {
  extractAccountNumber,
  extractClientName,
  extractStatementPeriod,
  extractOpeningBalance,
  extractClosingBalance,
  extractStandardBankAccountNumber,
  extractStandardBankClientName,
  extractStandardBankOpeningBalance,
  extractStandardBankClosingBalance,
  extractFnbAccountNumber,
  extractFnbClientName,
  extractFnbStatementPeriod,
  extractFnbOpeningBalance,
  extractFnbClosingBalance,
  extractCapitecAccountNumber,
  extractCapitecClientName,
  extractCapitecStatementPeriod,
  extractCapitecOpeningBalance,
  extractCapitecClosingBalance,
  extractNedbankAccountNumber,
  extractNedbankClientName,
  extractNedbankStatementPeriod,
  extractNedbankOpeningBalance,
  extractNedbankClosingBalance,
  extractDiscoveryAccountNumber,
  extractDiscoveryClientName,
  extractDiscoveryStatementPeriod,
  extractDiscoveryOpeningBalance,
  extractDiscoveryClosingBalance,
} from "./shared/metadata.js";

function unsupportedSubtypeError(subtype) {
  const error = new Error(
    `V2 bank subtype is not implemented: ${subtype || "unknown"}`
  );
  error.code = "V2_BANK_SUBTYPE_NOT_IMPLEMENTED";
  return error;
}

export function extractBySubtype(
  text,
  subtype,
  period = null,
  openingBalance = null
) {
  switch (subtype) {
    case DOCUMENT_SUBTYPES.ABSA_STATEMENT:
      return extractAbsaTransactions(text, openingBalance);

    case DOCUMENT_SUBTYPES.FNB_STATEMENT:
      return extractFnbTransactions(text, period, openingBalance);

    case DOCUMENT_SUBTYPES.CAPITEC_STATEMENT:
      return extractCapitecTransactions(text, openingBalance);

    case DOCUMENT_SUBTYPES.NEDBANK_STATEMENT:
      return extractNedbankTransactions(text, openingBalance);

    case DOCUMENT_SUBTYPES.DISCOVERY_STATEMENT:
      return extractDiscoveryTransactions(text, openingBalance);

    case DOCUMENT_SUBTYPES.STANDARD_BANK_STATEMENT:
      return extractStandardBankTransactions(text, period, openingBalance);

    default:
      throw unsupportedSubtypeError(subtype);
  }
}

function lastFiniteTransactionBalance(transactions = []) {
  if (!Array.isArray(transactions) || transactions.length === 0) return null;

  const balance = transactions[transactions.length - 1]?.balance;
  return typeof balance === "number" && Number.isFinite(balance)
    ? Number(balance.toFixed(2))
    : null;
}

export function buildBankStatementExtraction(context) {
  const {
    file,
    classification,
    extractedText = "",
    textPreview = "",
    extractionMeta = null,
  } = context;

  const subtype = classification.documentSubtype;
  const isFnb = subtype === DOCUMENT_SUBTYPES.FNB_STATEMENT;
  const isCapitec = subtype === DOCUMENT_SUBTYPES.CAPITEC_STATEMENT;
  const isNedbank = subtype === DOCUMENT_SUBTYPES.NEDBANK_STATEMENT;
  const isDiscovery = subtype === DOCUMENT_SUBTYPES.DISCOVERY_STATEMENT;
  const isStandardBank =
    subtype === DOCUMENT_SUBTYPES.STANDARD_BANK_STATEMENT;
  const period = isFnb
    ? extractFnbStatementPeriod(extractedText)
    : isCapitec
      ? extractCapitecStatementPeriod(extractedText)
      : isNedbank
        ? extractNedbankStatementPeriod(extractedText)
      : isDiscovery
        ? extractDiscoveryStatementPeriod(extractedText)
        : extractStatementPeriod(extractedText);

  let openingBalance = isFnb
    ? extractFnbOpeningBalance(extractedText) ?? extractOpeningBalance(extractedText)
    : isCapitec
      ? extractCapitecOpeningBalance(extractedText) ?? extractOpeningBalance(extractedText)
      : isNedbank
        ? extractNedbankOpeningBalance(extractedText) ?? extractOpeningBalance(extractedText)
      : isDiscovery
        ? extractDiscoveryOpeningBalance(extractedText) ?? extractOpeningBalance(extractedText)
        : isStandardBank
        ? extractStandardBankOpeningBalance(extractedText) ??
          extractOpeningBalance(extractedText)
        : extractOpeningBalance(extractedText);

  const transactions = extractBySubtype(
    extractedText,
    subtype,
    period,
    openingBalance
  );

  let closingBalance = isFnb
    ? extractFnbClosingBalance(extractedText) ?? extractClosingBalance(extractedText)
    : isCapitec
      ? extractCapitecClosingBalance(extractedText) ?? extractClosingBalance(extractedText)
      : isNedbank
        ? extractNedbankClosingBalance(extractedText) ?? extractClosingBalance(extractedText)
      : isDiscovery
        ? extractDiscoveryClosingBalance(extractedText) ?? extractClosingBalance(extractedText)
        : isStandardBank
        ? extractStandardBankClosingBalance(extractedText) ??
          extractClosingBalance(extractedText)
        : extractClosingBalance(extractedText);

  if (isStandardBank) {
    // Explicit statement metadata is authoritative. Derive/fallback only when
    // the statement did not expose the corresponding balance clearly.
    if (openingBalance === null) {
      openingBalance = deriveStandardBankOpeningBalanceFromFirstTransaction(
        transactions
      );
    }

    if (closingBalance === null) {
      closingBalance = lastFiniteTransactionBalance(transactions);
    }
  } else if (closingBalance === null) {
    closingBalance = lastFiniteTransactionBalance(transactions);
  }

  const accountNumber = isFnb
    ? extractFnbAccountNumber(extractedText) ?? extractAccountNumber(extractedText)
    : isCapitec
      ? extractCapitecAccountNumber(extractedText) ?? extractAccountNumber(extractedText)
      : isNedbank
        ? extractNedbankAccountNumber(extractedText) ?? extractAccountNumber(extractedText)
      : isDiscovery
        ? extractDiscoveryAccountNumber(extractedText) ?? extractAccountNumber(extractedText)
        : isStandardBank
        ? extractStandardBankAccountNumber(extractedText) ??
          extractAccountNumber(extractedText)
        : extractAccountNumber(extractedText);

  const clientName = isFnb
    ? extractFnbClientName(extractedText) ?? extractClientName(extractedText)
    : isCapitec
      ? extractCapitecClientName(extractedText) ?? extractClientName(extractedText)
      : isNedbank
        ? extractNedbankClientName(extractedText) ?? extractClientName(extractedText)
      : isDiscovery
        ? extractDiscoveryClientName(extractedText) ?? extractClientName(extractedText)
        : isStandardBank
        ? extractStandardBankClientName(extractedText) ??
          extractClientName(extractedText)
        : extractClientName(extractedText);

  return {
    sourceFileName: file?.originalname || "unknown.pdf",
    detectedSubtype: subtype,
    rawTextPreview: textPreview,
    rawText: extractedText,
    extractionMeta,
    metadata: {
      bankName: subtype || "unknown",
      accountNumber,
      clientName,
      statementPeriodStart: period.start,
      statementPeriodEnd: period.end,
      openingBalance,
      closingBalance,
    },
    transactions,
  };
}
