import { normalizeWhitespace } from "../shared/utils.js";
import {
  cleanStandardBankMoneyToken,
  parseStandardBankBalanceToken,
} from "../shared/money.js";
import { extractStandardBankDate } from "../shared/dates.js";

function round2(value) {
  return Number(Number(value).toFixed(2));
}

function extractStandardBankMoneyTokens(line) {
  const raw = normalizeWhitespace(String(line || ""));
  if (!raw) return [];

  return raw.match(/\d[\d\s,]*\.\d{2}-?/g) || [];
}

function extractStandardBankMoneyPair(line) {
  const tokens = extractStandardBankMoneyTokens(line);

  // Standard Bank transaction rows must contain both a transaction amount
  // and a running balance. This prevents opening/closing balance metadata
  // rows from being misclassified as transactions.
  if (tokens.length < 2) return null;

  const amount = cleanStandardBankMoneyToken(tokens[0]);
  const balance = parseStandardBankBalanceToken(tokens[tokens.length - 1]);

  if (amount === null || balance === null) return null;
  if (Math.abs(amount) > 5_000_000) return null;
  if (Math.abs(balance) > 100_000_000) return null;

  return {
    amount: round2(amount),
    balance: round2(balance),
  };
}

function isStandardBankMarkerLine(line) {
  return normalizeWhitespace(line) === "##";
}

function isStandardBankReversalMarker(line) {
  return normalizeWhitespace(line)
    .toUpperCase()
    .includes("RTD-NOT PROVIDED FOR");
}

function isStandardBankHeaderOrNoise(line) {
  const v = normalizeWhitespace(line).toLowerCase();
  if (!v) return true;

  return (
    v === "details" ||
    v === "service" ||
    v === "fee" ||
    v === "debitscredits" ||
    v === "datebalance" ||
    v === "balance brought forward" ||
    v === "month-end balance" ||
    v.startsWith("page ") ||
    v.startsWith("account number") ||
    v.startsWith("statement from") ||
    v.includes("customer care centre") ||
    v.includes("statement / invoice") ||
    v.includes("bank statement / tax invoice") ||
    v.includes("standard bank of south africa") ||
    v.includes("the ombudsman for banking services") ||
    v.includes("registered credit provider") ||
    v.includes("please verify all transactions") ||
    v.includes("please visit our website") ||
    v.includes("vat reg no") ||
    v.includes("monthly email")
  );
}

function isCompactStandardBankReferenceLine(line) {
  const v = normalizeWhitespace(line);
  if (!v || v.length > 80) return false;

  return (
    /^\d{6}$/i.test(v) ||
    /^ROL\d{6}$/i.test(v) ||
    /^(?:SBSA|VODACOM|LENDPLUS|AUTOPAY|MBD)(?:\s+[A-Z0-9./-]+){0,4}$/i.test(v) ||
    /^SF\d+(?:\s+[A-Z0-9./-]+){0,3}$/i.test(v)
  );
}

function findPreviousDescription(lines, startIndex) {
  for (let i = startIndex; i >= 0 && i >= startIndex - 3; i--) {
    const candidate = lines[i];
    if (!candidate) continue;
    if (isStandardBankMarkerLine(candidate)) continue;
    if (isStandardBankHeaderOrNoise(candidate)) continue;
    if (isStandardBankReversalMarker(candidate)) continue;
    if (isCompactStandardBankReferenceLine(candidate)) continue;
    if (extractStandardBankMoneyPair(candidate)) continue;
    return candidate;
  }

  return "";
}

function getStandardBankTransactionContext(lines, moneyLineIndex) {
  const previous = lines[moneyLineIndex - 1] || "";
  let description = "";
  let reference = "";

  if (isCompactStandardBankReferenceLine(previous)) {
    reference = previous;
    description = findPreviousDescription(lines, moneyLineIndex - 2);
  } else if (isStandardBankMarkerLine(previous)) {
    description = findPreviousDescription(lines, moneyLineIndex - 2);
  } else if (
    !isStandardBankHeaderOrNoise(previous) &&
    !isStandardBankReversalMarker(previous) &&
    !extractStandardBankMoneyPair(previous)
  ) {
    description = previous;
  }

  if (!reference) {
    const next = lines[moneyLineIndex + 1] || "";
    if (isCompactStandardBankReferenceLine(next)) {
      reference = next;
    }
  }

  return { description, reference };
}

function shouldSkipStandardBankBlock(description, reference) {
  const desc = normalizeWhitespace(description).toLowerCase();
  const ref = normalizeWhitespace(reference).toLowerCase();

  if (!desc) return true;
  if (desc === "##") return true;
  if (desc.includes("these fees include vat")) return true;
  if (ref === "##") return true;

  return false;
}

function shouldSkipStandardBankTransaction(tx) {
  if (!tx) return true;

  if (typeof tx.amount !== "number" || !Number.isFinite(tx.amount)) return true;
  if (typeof tx.balance !== "number" || !Number.isFinite(tx.balance)) return true;
  if (Math.abs(tx.amount) > 5_000_000) return true;
  if (Math.abs(tx.balance) > 100_000_000) return true;

  return false;
}

function isStandardBankReversedTransaction(lines, i) {
  const next = lines[i + 1];
  const next2 = lines[i + 2];

  if (
    next &&
    isCompactStandardBankReferenceLine(next) &&
    next2 &&
    isStandardBankReversalMarker(next2)
  ) {
    return true;
  }

  if (next && isStandardBankReversalMarker(next)) {
    return true;
  }

  return false;
}

function deriveStartingBalance(transactions) {
  if (!Array.isArray(transactions) || transactions.length === 0) return null;

  const first = transactions[0];
  if (
    typeof first?.amount !== "number" ||
    !Number.isFinite(first.amount) ||
    typeof first?.balance !== "number" ||
    !Number.isFinite(first.balance)
  ) {
    return null;
  }

  return round2(first.balance - first.amount);
}

function applyBalanceBasedSigns(transactions, openingBalance = null) {
  if (!Array.isArray(transactions) || transactions.length === 0) return [];

  let previousBalance =
    typeof openingBalance === "number" && Number.isFinite(openingBalance)
      ? round2(openingBalance)
      : null;

  return transactions.map((transaction) => {
    const tx = { ...transaction };

    if (
      previousBalance !== null &&
      typeof tx.amount === "number" &&
      Number.isFinite(tx.amount) &&
      typeof tx.balance === "number" &&
      Number.isFinite(tx.balance)
    ) {
      const observedDelta = round2(tx.balance - previousBalance);

      // A statement's running balance is stronger evidence of debit/credit
      // direction than OCR column collapse. Only change the sign when the
      // absolute transaction amount and observed balance movement agree.
      if (Math.abs(Math.abs(observedDelta) - Math.abs(tx.amount)) <= 0.01) {
        tx.amount = observedDelta;
      }
    }

    if (typeof tx.balance === "number" && Number.isFinite(tx.balance)) {
      previousBalance = round2(tx.balance);
    }

    return tx;
  });
}

function carryForwardDates(transactions) {
  if (!Array.isArray(transactions) || transactions.length === 0) return [];

  let lastKnownDate = null;

  return transactions.map((tx) => {
    const next = { ...tx };

    if (next.date) {
      lastKnownDate = next.date;
      return next;
    }

    if (lastKnownDate) {
      next.date = lastKnownDate;
    }

    return next;
  });
}

export function deriveStandardBankOpeningBalanceFromFirstTransaction(transactions) {
  return deriveStartingBalance(transactions);
}

export function extractStandardBankTransactions(
  text,
  statementPeriod = null,
  openingBalance = null
) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);

  const transactions = [];

  for (let i = 0; i < lines.length; i++) {
    const moneyPair = extractStandardBankMoneyPair(lines[i]);
    if (!moneyPair) continue;

    const { description, reference } = getStandardBankTransactionContext(lines, i);

    if (shouldSkipStandardBankBlock(description, reference)) continue;
    if (isStandardBankReversedTransaction(lines, i)) continue;

    const mergedDescription = normalizeWhitespace(
      reference ? `${description} ${reference}` : description
    );
    const upper = mergedDescription.toUpperCase();

    if (upper.includes("RTD-NOT PROVIDED FOR")) continue;

    if (
      upper.includes("VAT SUMMARY") ||
      upper.includes("ACCOUNT SUMMARY") ||
      upper.includes("DETAILS OF AGREEMENT") ||
      upper.includes("THIS DOCUMENT CONSTITUTES A CREDIT NOTE") ||
      upper.includes("TOTAL VAT") ||
      upper === "FEE-UNPAID ITEM" ||
      upper === "UNPAID FEE DEBICHECK D/O"
    ) {
      continue;
    }

    const date =
      extractStandardBankDate(reference, statementPeriod) ||
      extractStandardBankDate(description, statementPeriod) ||
      extractStandardBankDate(mergedDescription, statementPeriod) ||
      null;

    const tx = {
      date,
      description: mergedDescription,
      amount: round2(moneyPair.amount),
      balance: round2(moneyPair.balance),
    };

    if (shouldSkipStandardBankTransaction(tx)) continue;
    transactions.push(tx);
  }

  return carryForwardDates(
    applyBalanceBasedSigns(transactions, openingBalance)
  );
}
