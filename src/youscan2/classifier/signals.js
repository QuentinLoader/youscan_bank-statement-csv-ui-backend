/**
 * YouScan V2
 * Deterministic document signal extraction.
 */

import { DOCUMENT_SUBTYPES } from "../registry/documentTypes.js";

export function extractDocumentSignals(text = "") {
  const lower = String(text).toLowerCase();

  const bankBrands = [
    {
      subtype: DOCUMENT_SUBTYPES.ABSA_STATEMENT,
      label: "ABSA",
      matched: lower.includes("absa"),
    },
    {
      subtype: DOCUMENT_SUBTYPES.FNB_STATEMENT,
      label: "FNB",
      matched: lower.includes("fnb") || lower.includes("first national bank"),
    },
    {
      subtype: DOCUMENT_SUBTYPES.NEDBANK_STATEMENT,
      label: "Nedbank",
      matched: lower.includes("nedbank"),
    },
    {
      subtype: DOCUMENT_SUBTYPES.CAPITEC_STATEMENT,
      label: "Capitec",
      matched: lower.includes("capitec"),
    },
    {
      subtype: DOCUMENT_SUBTYPES.DISCOVERY_STATEMENT,
      label: "Discovery Bank",
      matched:
        lower.includes("discovery bank") ||
        lower.includes("discovery gold transaction account") ||
        (lower.includes("discovery") && lower.includes("transaction account")),
    },
    {
      subtype: DOCUMENT_SUBTYPES.STANDARD_BANK_STATEMENT,
      label: "Standard Bank",
      matched:
        lower.includes("standard bank") ||
        lower.includes("stanbic") ||
        lower.includes("blue wallet") ||
        lower.includes("mymo"),
    },
  ];

  const detectedBank = bankBrands.find((entry) => entry.matched) || null;

  const statementSignals = {
    openingBalance:
      lower.includes("opening balance") ||
      lower.includes("balance brought forward") ||
      lower.includes("bal brought forward"),
    closingBalance:
      lower.includes("closing balance") ||
      lower.includes("final balance") ||
      lower.includes("current balance"),
    transactionDate:
      lower.includes("transaction date") ||
      lower.includes("date description") ||
      lower.includes("date details"),
    debit: lower.includes("debit") || lower.includes("debits"),
    credit: lower.includes("credit") || lower.includes("credits"),
    balance: lower.includes("balance"),
  };

  const bankStatementSignalCount = Object.values(statementSignals).filter(Boolean).length;

  return {
    lower,
    detectedBank,
    statementSignals,
    bankStatementSignalCount,
    invoiceSignal:
      lower.includes("invoice") ||
      lower.includes("tax invoice") ||
      lower.includes("vat"),
    deliveryNoteSignal:
      lower.includes("delivery note") ||
      lower.includes("proof of delivery") ||
      lower.includes("waybill"),
  };
}
