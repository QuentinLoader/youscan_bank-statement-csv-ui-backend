/**
 * YouScan V2
 * Privacy-safe shadow comparison between deterministic and AI canonical data.
 *
 * The report intentionally contains field names, row indexes and counts only;
 * it never includes account numbers, names, descriptions, amounts or balances.
 */

import {
  formatDateParts,
  isValidCalendarDateParts,
  parseStatementPeriodDate,
} from "../../extractor/shared/dates.js";

export const AI_SHADOW_COMPARISON_STATUSES = Object.freeze({
  EXACT_MATCH: "exact_match",
  DIFFERENCES: "differences",
  NOT_COMPARABLE: "not_comparable",
});

export const AI_SHADOW_METADATA_FIELDS = Object.freeze([
  "bankName",
  "accountNumber",
  "clientName",
  "statementPeriodStart",
  "statementPeriodEnd",
  "openingBalance",
  "closingBalance",
]);

export const AI_SHADOW_TRANSACTION_FIELDS = Object.freeze([
  "date",
  "description",
  "amount",
  "balance",
]);

function round2(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(value * 100) / 100
    : value;
}

function normalizeWhitespace(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u00A0\t\r\n ]+/g, " ")
    .trim();
}

function normalizeLooseText(value) {
  if (value === null || value === undefined) return null;
  return normalizeWhitespace(value).toLowerCase();
}

const BANK_NAME_ALIASES = new Map([
  ["absa", "absa"],
  ["absabank", "absa"],
  ["absabanklimited", "absa"],
  ["absagrouplimited", "absa"],
  ["fnb", "fnb"],
  ["firstnationalbank", "fnb"],
  ["firstnationalbankadivisionoffirstrandbanklimited", "fnb"],
  ["standardbank", "standardbank"],
  ["standardbankofsouthafrica", "standardbank"],
  ["standardbankofsouthafricalimited", "standardbank"],
  ["thestandardbankofsouthafrica", "standardbank"],
  ["thestandardbankofsouthafricalimited", "standardbank"],
  ["capitec", "capitec"],
  ["capitecbank", "capitec"],
  ["capitecbanklimited", "capitec"],
  ["nedbank", "nedbank"],
  ["nedbanklimited", "nedbank"],
  ["discovery", "discoverybank"],
  ["discoverybank", "discoverybank"],
  ["discoverybanklimited", "discoverybank"],
]);

function normalizeBankName(value) {
  if (value === null || value === undefined) return null;
  const compact = normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  return BANK_NAME_ALIASES.get(compact) || compact || null;
}

function normalizeAccountNumber(value) {
  if (value === null || value === undefined) return null;
  return String(value).toUpperCase().replace(/[^A-Z0-9]/g, "") || null;
}

function normalizeDate(value) {
  if (value === null || value === undefined || value === "") return null;
  const parts = parseStatementPeriodDate(value);
  if (!parts || !isValidCalendarDateParts(parts.dd, parts.mm, parts.yyyy)) {
    return normalizeWhitespace(value).toLowerCase();
  }
  return formatDateParts(parts.dd, parts.mm, parts.yyyy);
}

function descriptionDateToken(value) {
  const parts = parseStatementPeriodDate(value);
  if (!parts || !isValidCalendarDateParts(parts.dd, parts.mm, parts.yyyy)) return null;
  return `${String(parts.dd).padStart(2, "0")}${String(parts.mm).padStart(2, "0")}${String(parts.yyyy).slice(-2)}`;
}

function normalizeDescription(value, transactionDate) {
  const normalized = normalizeLooseText(value);
  if (normalized === null) return null;
  const token = descriptionDateToken(transactionDate);
  if (!token) return normalized;
  return normalized.replace(new RegExp(`(?:^|\\s)${token}$`), "").trim();
}

function normalizeField(field, value) {
  if (value === null || value === undefined) return null;

  switch (field) {
    case "bankName":
      return normalizeBankName(value);
    case "accountNumber":
      return normalizeAccountNumber(value);
    case "statementPeriodStart":
    case "statementPeriodEnd":
    case "date":
      return normalizeDate(value);
    case "openingBalance":
    case "closingBalance":
    case "amount":
    case "balance":
      return round2(value);
    case "clientName":
    case "description":
    default:
      return normalizeLooseText(value);
  }
}

function valuesMatch(field, left, right, context = {}) {
  if (field === "description") {
    const transactionDate = context.deterministicDate || context.aiDate || null;
    return Object.is(
      normalizeDescription(left, transactionDate),
      normalizeDescription(right, transactionDate)
    );
  }
  return Object.is(normalizeField(field, left), normalizeField(field, right));
}

function comparisonScore(matched, compared) {
  if (!compared) return 1;
  return Math.round((matched / compared) * 10_000) / 10_000;
}

function blankFieldStats(fields) {
  return Object.fromEntries(
    fields.map((field) => [field, { compared: 0, matched: 0, agreementRate: null }])
  );
}

function finalizeFieldStats(stats) {
  return Object.fromEntries(
    Object.entries(stats).map(([field, value]) => [
      field,
      {
        compared: value.compared,
        matched: value.matched,
        agreementRate:
          value.compared > 0 ? comparisonScore(value.matched, value.compared) : null,
      },
    ])
  );
}

export function compareAiToDeterministicBankStatement({
  aiCanonical,
  deterministicCanonical,
  ignoreMetadataFields = [],
  ignoreTransactionFields = [],
} = {}) {
  if (
    !aiCanonical ||
    !deterministicCanonical ||
    !Array.isArray(aiCanonical.transactions) ||
    !Array.isArray(deterministicCanonical.transactions)
  ) {
    return {
      status: AI_SHADOW_COMPARISON_STATUSES.NOT_COMPARABLE,
      exactMatch: false,
      matchScore: null,
      signals: null,
      metadata: null,
      transactions: null,
    };
  }

  const ignoredMetadata = new Set(
    (Array.isArray(ignoreMetadataFields) ? ignoreMetadataFields : []).filter((field) =>
      AI_SHADOW_METADATA_FIELDS.includes(field)
    )
  );
  const ignoredTransactions = new Set(
    (Array.isArray(ignoreTransactionFields) ? ignoreTransactionFields : []).filter((field) =>
      AI_SHADOW_TRANSACTION_FIELDS.includes(field)
    )
  );
  const comparedMetadataFields = AI_SHADOW_METADATA_FIELDS.filter(
    (field) => !ignoredMetadata.has(field)
  );
  const comparedTransactionFields = AI_SHADOW_TRANSACTION_FIELDS.filter(
    (field) => !ignoredTransactions.has(field)
  );

  const metadataMismatchFields = [];
  const metadataFieldStats = blankFieldStats(AI_SHADOW_METADATA_FIELDS);
  let metadataMatched = 0;

  for (const field of comparedMetadataFields) {
    metadataFieldStats[field].compared += 1;
    if (valuesMatch(field, aiCanonical[field], deterministicCanonical[field])) {
      metadataMatched += 1;
      metadataFieldStats[field].matched += 1;
    } else {
      metadataMismatchFields.push(field);
    }
  }

  const aiTransactions = aiCanonical.transactions;
  const deterministicTransactions = deterministicCanonical.transactions;
  const countMatch = aiTransactions.length === deterministicTransactions.length;
  const comparedRows = Math.min(aiTransactions.length, deterministicTransactions.length);
  const mismatchRows = [];
  const transactionFieldStats = blankFieldStats(AI_SHADOW_TRANSACTION_FIELDS);
  let transactionComparedFields = 0;
  let transactionMatchedFields = 0;
  let exactRows = 0;

  for (let rowIndex = 0; rowIndex < comparedRows; rowIndex += 1) {
    const aiRow = aiTransactions[rowIndex] || {};
    const deterministicRow = deterministicTransactions[rowIndex] || {};
    const fields = [];

    for (const field of comparedTransactionFields) {
      transactionComparedFields += 1;
      transactionFieldStats[field].compared += 1;
      if (
        valuesMatch(field, aiRow[field], deterministicRow[field], {
          aiDate: aiRow.date,
          deterministicDate: deterministicRow.date,
        })
      ) {
        transactionMatchedFields += 1;
        transactionFieldStats[field].matched += 1;
      } else {
        fields.push(field);
      }
    }

    if (fields.length) {
      mismatchRows.push({ rowIndex, fields });
    } else {
      exactRows += 1;
    }
  }

  // A count mismatch is a real comparison difference even when all shared rows
  // happen to match. Count it as one compared signal in the overall score.
  const comparedSignals =
    comparedMetadataFields.length + transactionComparedFields + 1;
  const matchedSignals =
    metadataMatched + transactionMatchedFields + (countMatch ? 1 : 0);
  const exactMatch =
    countMatch &&
    metadataMismatchFields.length === 0 &&
    mismatchRows.length === 0;

  return {
    status: exactMatch
      ? AI_SHADOW_COMPARISON_STATUSES.EXACT_MATCH
      : AI_SHADOW_COMPARISON_STATUSES.DIFFERENCES,
    exactMatch,
    matchScore: comparisonScore(matchedSignals, comparedSignals),
    signals: {
      compared: comparedSignals,
      matched: matchedSignals,
      agreementRate: comparisonScore(matchedSignals, comparedSignals),
    },
    metadata: {
      comparedFields: comparedMetadataFields.length,
      matchedFields: metadataMatched,
      mismatchFields: metadataMismatchFields,
      fieldStats: finalizeFieldStats(metadataFieldStats),
    },
    transactions: {
      countMatch,
      deterministicCount: deterministicTransactions.length,
      aiCount: aiTransactions.length,
      comparedRows,
      exactRows,
      comparedFields: transactionComparedFields,
      matchedFields: transactionMatchedFields,
      mismatchRowCount: mismatchRows.length,
      mismatchRows,
      fieldStats: finalizeFieldStats(transactionFieldStats),
    },
  };
}
