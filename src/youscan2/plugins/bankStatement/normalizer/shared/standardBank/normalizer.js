/**
 * YouScan 2.0
 * Bank statement normalizer
 */

/* =========================
   FUNCTION: mapSubtypeToBankName
   PURPOSE: Map document subtype to display bank name.
========================= */
function mapSubtypeToBankName(subtype) {
  if (!subtype) return "unknown";

  const value = String(subtype).toLowerCase();

  if (value.includes("absa")) return "ABSA";
  if (value.includes("fnb")) return "FNB";
  if (value.includes("nedbank")) return "Nedbank";
  if (value.includes("capitec")) return "Capitec";
  if (value.includes("discovery")) return "Discovery";
  if (value.includes("standard_bank")) return "Standard Bank";
  if (value.includes("standard bank")) return "Standard Bank";

  return "unknown";
}

/* =========================
   FUNCTION: isValidDateString
   PURPOSE: Basic dd/mm/yyyy validation.
========================= */
function isValidDateString(value) {
  if (!value) return false;

  const match = String(value).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return false;

  const dd = Number(match[1]);
  const mm = Number(match[2]);
  const yyyy = Number(match[3]);

  return dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12 && yyyy >= 2000 && yyyy <= 2100;
}

/* =========================
   FUNCTION: extractStatementEndYear
   PURPOSE: Pull yyyy from statementPeriodEnd for date resolution.
========================= */
function extractStatementEndYear(statementPeriodEnd) {
  const text = String(statementPeriodEnd || "").trim();

  let match = text.match(/(\d{4})$/);
  if (match) return Number(match[1]);

  match = text.match(/\b(\d{4})\b/);
  if (match) return Number(match[1]);

  return 2026;
}

/* =========================
   FUNCTION: resolveYear
   PURPOSE:
   Resolve 2-digit years using statement context.

   RULE:
   - For Standard Bank embedded 6-digit tokens like 251231 or 251212,
     the last 2 digits are not reliable literal years in this OCR output.
   - Anchor to statement year context instead.
   - For a statement ending in Jan 2026, these transactions belong to Dec 2025.
========================= */
function resolveYear(yy, statementEndYear) {
  const candidate = 2000 + Number(yy);

  // If candidate is implausible relative to the statement period,
  // force it to the prior year of the statement end.
  if (candidate < statementEndYear - 2 || candidate > statementEndYear + 1) {
    return statementEndYear - 1;
  }

  return candidate;
}

/* =========================
   FUNCTION: extractDateFromDescription
   PURPOSE: Recover embedded Standard Bank dates from description text.
========================= */
function extractDateFromDescription(description, statementEndYear = 2026) {
  const text = String(description || "").trim();

  let match = text.match(/ROL(\d{2})(\d{2})(\d{2})/i);
  if (match) {
    const dd = match[1];
    const mm = match[2];
    const yy = Number(match[3]);
    const yyyy = resolveYear(yy, statementEndYear);
    return `${dd}/${mm}/${yyyy}`;
  }

  match = text.match(/(\d{6})$/);
  if (match) {
    const token = match[1];
    const dd = Number(token.slice(0, 2));
    const mm = Number(token.slice(2, 4));
    const yy = Number(token.slice(4, 6));

    if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12) {
      const yyyy = resolveYear(yy, statementEndYear);
      return `${token.slice(0, 2)}/${token.slice(2, 4)}/${yyyy}`;
    }
  }

  match = text.match(/\b(\d{6})\b/);
  if (match) {
    const token = match[1];
    const dd = Number(token.slice(0, 2));
    const mm = Number(token.slice(2, 4));
    const yy = Number(token.slice(4, 6));

    if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12) {
      const yyyy = resolveYear(yy, statementEndYear);
      return `${token.slice(0, 2)}/${token.slice(2, 4)}/${yyyy}`;
    }
  }

  return null;
}

/* =========================
   FUNCTION: shouldRemoveTransaction
   PURPOSE: Remove Standard Bank mirror/footer/noise rows.
========================= */
function shouldRemoveTransaction(description) {
  const upper = String(description || "").toUpperCase();

  return (
    upper.includes("RTD-NOT PROVIDED FOR") ||
    upper === "##" ||
    upper.includes("FEE-UNPAID ITEM") ||
    upper.includes("UNPAID FEE DEBICHECK D/O") ||
    upper.includes("VAT SUMMARY") ||
    upper.includes("ACCOUNT SUMMARY") ||
    upper.includes("DETAILS OF AGREEMENT") ||
    upper.includes("THIS DOCUMENT CONSTITUTES A CREDIT NOTE") ||
    upper.includes("TOTAL VAT")
  );
}

/* =========================
   FUNCTION: normalizeTransaction
   PURPOSE: Apply transaction-level cleanup rules.
========================= */
function normalizeTransaction(tx, statementEndYear) {
  const description = tx?.description || "";
  const upper = String(description).toUpperCase();

  const normalized = {
    date: tx?.date || null,
    description,
    amount: typeof tx?.amount === "number" ? tx.amount : null,
    balance: typeof tx?.balance === "number" ? tx.balance : null,
  };

  if (!isValidDateString(normalized.date)) {
    normalized.date = extractDateFromDescription(description, statementEndYear);
  }

  if (
    normalized.amount != null &&
    upper.includes("CREDIT") &&
    !upper.includes("DEBIT") &&
    !upper.includes("DEBIT ORDER")
  ) {
    normalized.amount = Math.abs(normalized.amount);
  }

  return normalized;
}

/* =========================
   FUNCTION: normalizeTransactions
   PURPOSE: Normalize and filter transaction array.
========================= */
function normalizeTransactions(transactions, subtype, statementEndYear) {
  const list = Array.isArray(transactions) ? transactions : [];
  const isStandardBank =
    String(subtype || "").toLowerCase().includes("standard_bank") ||
    String(subtype || "").toLowerCase().includes("standard bank");

  const normalized = [];

  for (const tx of list) {
    if (!tx) continue;

    if (isStandardBank && shouldRemoveTransaction(tx.description)) {
      continue;
    }

    normalized.push(normalizeTransaction(tx, statementEndYear));
  }

  return normalized;
}

/* =========================
   FUNCTION: normalizeBankStatement
   PURPOSE: Normalize extractor output into final bank statement shape.
========================= */
export async function normalizeBankStatement(raw) {
  const metadata = raw?.metadata || {};
  const subtype = raw?.detectedSubtype || metadata.bankName || "";
  const bankName =
    metadata.bankName && metadata.bankName !== "unknown"
      ? mapSubtypeToBankName(metadata.bankName)
      : mapSubtypeToBankName(subtype);

  const statementEndYear = extractStatementEndYear(metadata.statementPeriodEnd);

  return {
    bankName,
    accountNumber: metadata.accountNumber || null,
    clientName: metadata.clientName || null,
    statementPeriodStart: metadata.statementPeriodStart || null,
    statementPeriodEnd: metadata.statementPeriodEnd || null,
    openingBalance: metadata.openingBalance ?? null,
    closingBalance: metadata.closingBalance ?? null,
    transactions: normalizeTransactions(raw?.transactions, subtype, statementEndYear),
    sourceFileName: raw?.sourceFileName || null,
  };
}