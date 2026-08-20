/**
 * YouScan V2
 * FNB bank-statement transaction extractor.
 *
 * This adapter is independent from the V1 parser. It preserves observed
 * running balances and uses them as reconciliation evidence instead of
 * rebuilding statement balances.
 */

import {
  datePartsToUtcMs,
  formatDateParts,
  isValidCalendarDateParts,
  parseStatementPeriodDate,
} from "../shared/dates.js";
import { parseMoney } from "../shared/money.js";
import { normalizeWhitespace } from "../shared/utils.js";

const MONTHS = Object.freeze({
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
});

const DATE_TOKEN = /\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/gi;
const MONEY_TOKEN = "(?:\\d{1,3}(?:[ ,]\\d{3})+|\\d+)\\.\\d{2}";
const MONEY_PAIR = new RegExp(
  `(?:^|\\s)(${MONEY_TOKEN})\\s*(Cr|Dr)?\\s+(${MONEY_TOKEN})\\s*(Cr|Dr)?`,
  "i"
);

function round2(value) {
  return Math.round(value * 100) / 100;
}

function applyCrDr(value, marker) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;

  const sign = String(marker || "").toLowerCase();
  if (sign === "dr") return -Math.abs(value);
  if (sign === "cr") return Math.abs(value);
  return value;
}

function cleanTransactionBlock(text = "") {
  const source = String(text || "");
  const startMatch = source.match(/Transactions\s+in\s+RAND/i);
  if (!startMatch) return "";

  const start = (startMatch.index || 0) + startMatch[0].length;
  const remainder = source.slice(start);
  const closingMatch = remainder.match(/Closing\s+Balance/i);
  const block = closingMatch
    ? remainder.slice(0, closingMatch.index)
    : remainder;

  return block
    .replace(/Page\s+\d+\s+of\s+\d+/gi, " ")
    .replace(/\bDate\s+Description\s+Amount\s+Balance\b/gi, " ")
    .replace(/\bDate\s+Transaction\s+Description\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveTransactionYear(day, month, period = null) {
  const start = parseStatementPeriodDate(period?.start);
  const end = parseStatementPeriodDate(period?.end);
  const possibleYears = [...new Set([start?.yyyy, end?.yyyy].filter(Boolean))];

  if (possibleYears.length === 0) {
    possibleYears.push(new Date().getUTCFullYear());
  }

  const startMs = datePartsToUtcMs(start);
  const endMs = datePartsToUtcMs(end);

  const candidates = possibleYears
    .filter((year) => isValidCalendarDateParts(day, month, year))
    .map((year) => ({
      day,
      month,
      year,
      ms: Date.UTC(year, month - 1, day),
    }));

  if (startMs !== null && endMs !== null) {
    const inPeriod = candidates.find(
      (candidate) => candidate.ms >= startMs && candidate.ms <= endMs
    );
    if (inPeriod) return inPeriod.year;
  }

  if (end?.yyyy && isValidCalendarDateParts(day, month, end.yyyy)) {
    return end.yyyy;
  }

  return candidates[0]?.year || new Date().getUTCFullYear();
}

function buildDate(dayText, monthText, period) {
  const day = Number(dayText);
  const month = MONTHS[String(monthText || "").toLowerCase()];
  if (!month) return null;

  const year = resolveTransactionYear(day, month, period);
  if (!isValidCalendarDateParts(day, month, year)) return null;

  return formatDateParts(day, month, year);
}

function parseSegment(segment, dateMatch, period, previousBalance) {
  const afterDate = segment.slice(dateMatch[0].length).trim();
  const pair = afterDate.match(MONEY_PAIR);
  if (!pair) return null;

  const amountMagnitude = parseMoney(pair[1]);
  const amountMarker = pair[2] || null;
  const observedBalanceMagnitude = parseMoney(pair[3]);
  const balanceMarker = pair[4] || null;

  if (amountMagnitude === null || observedBalanceMagnitude === null) {
    return null;
  }

  const balance = applyCrDr(observedBalanceMagnitude, balanceMarker);
  if (balance === null) return null;

  let amount = null;
  if (amountMarker) {
    amount = applyCrDr(amountMagnitude, amountMarker);
  } else if (typeof previousBalance === "number" && Number.isFinite(previousBalance)) {
    amount = round2(balance - previousBalance);
  } else {
    amount = amountMagnitude;
  }

  const description = normalizeWhitespace(afterDate.slice(0, pair.index));

  return {
    date: buildDate(dateMatch[1], dateMatch[2], period),
    description: description || "Transaction",
    amount: typeof amount === "number" ? round2(amount) : null,
    balance: round2(balance),
  };
}

export function extractFnbTransactions(
  text,
  period = null,
  openingBalance = null
) {
  const block = cleanTransactionBlock(text);
  if (!block) return [];

  const dateMatches = [...block.matchAll(DATE_TOKEN)];
  if (dateMatches.length === 0) return [];

  const transactions = [];
  let previousBalance =
    typeof openingBalance === "number" && Number.isFinite(openingBalance)
      ? openingBalance
      : null;

  for (let i = 0; i < dateMatches.length; i++) {
    const current = dateMatches[i];
    const next = dateMatches[i + 1];
    const start = current.index || 0;
    const end = next?.index ?? block.length;
    const segment = block.slice(start, end).trim();

    const parsed = parseSegment(segment, current, period, previousBalance);
    if (!parsed) continue;

    transactions.push(parsed);
    previousBalance = parsed.balance;
  }

  return transactions;
}
