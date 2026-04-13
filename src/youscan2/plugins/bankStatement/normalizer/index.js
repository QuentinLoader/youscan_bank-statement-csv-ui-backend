import { mapSubtypeToBankName } from "./shared/common.js";
import { normalizeAbsaTransactions } from "./absa/normalizer.js";
import { normalizeStandardBankTransactions } from "./standardbank/normalizer.js";

export function buildBankStatementNormalization(raw) {
  const metadata = raw?.metadata || {};
  const subtype = raw?.detectedSubtype || metadata.bankName || "";

  const bankName =
    metadata.bankName && metadata.bankName !== "unknown"
      ? mapSubtypeToBankName(metadata.bankName)
      : mapSubtypeToBankName(subtype);

  const isStandardBank =
    String(subtype || "").toLowerCase().includes("standard_bank") ||
    String(subtype || "").toLowerCase().includes("standard bank");

  const transactions = isStandardBank
    ? normalizeStandardBankTransactions(
        raw?.transactions,
        metadata.statementPeriodEnd
      )
    : normalizeAbsaTransactions(raw?.transactions);

  return {
    bankName,
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