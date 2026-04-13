import { normalizeWhitespace } from "../shared/utils.js";
import {
  cleanStandardBankMoneyToken,
  parseStandardBankBalanceToken,
} from "../shared/money.js";
import { extractStandardBankDate } from "../shared/dates.js";

function buildCombinedBalanceCandidate(line) {
  const raw = normalizeWhitespace(line);
  const matches = raw.match(/\d[\d\s,]*\.\d{2}-?/g);
  if (!matches || matches.length === 0) return null;
  return matches[matches.length - 1];
}

function extractStandardBankMoneyPair(line) {
  const raw = normalizeWhitespace(String(line || ""));
  if (!raw) return null;

  const amountMatch = raw.match(/^\D*(\d[\d,]*\.\d{2}-?)/);
  if (!amountMatch) return null;

  const amountRaw = amountMatch[1];
  const amount = cleanStandardBankMoneyToken(amountRaw);
  if (amount === null) return null;

  const combinedBalanceCandidate = buildCombinedBalanceCandidate(raw);

  let balance = null;

  if (combinedBalanceCandidate) {
    balance = parseStandardBankBalanceToken(combinedBalanceCandidate);
  }

  if (balance === null) {
    const allMatches = raw.match(/\d[\d\s,]*\.\d{2}-?/g);
    if (!allMatches || allMatches.length < 2) return null;
    balance = parseStandardBankBalanceToken(allMatches[allMatches.length - 1]);
  }

  if (balance === null) return null;

  if (Math.abs(amount) > 1_000_000) return null;
  if (Math.abs(balance) > 100_000_000) return null;

  return { amount, balance };
}

function isStandardBankMarkerLine(line) {
  return normalizeWhitespace(line) === "##";
}

function isStandardBankReversalMarker(line) {
  return normalizeWhitespace(line).toUpperCase().includes("RTD-NOT PROVIDED FOR");
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
    v.includes("customer care centre") ||
    v.includes("statement / invoice") ||
    v.includes("bank statement / tax invoice") ||
    v.includes("account number") ||
    v.includes("standard bank") ||
    v.includes("the ombudsman for banking services") ||
    v.includes("registered credit provider") ||
    v.includes("please verify all transactions") ||
    v.includes("please visit our website") ||
    v.includes("vat reg no") ||
    v.includes("monthly email") ||
    v.includes("mall at carnival") ||
    v.includes("marshalltown") ||
    v.includes("achieva current account") ||
    v.includes("mr. ja loader") ||
    v.includes("5 kiaat st") ||
    v.includes("dalpark")
  );
}

function isStandardBankReferenceLine(line) {
  const v = normalizeWhitespace(line);
  if (!v) return false;

  return (
    /\b\d{6}\b/.test(v) ||
    /\bROL\d{6}\b/i.test(v) ||
    /\bSBSA\b/i.test(v) ||
    /\bVODACOM\b/i.test(v) ||
    /\bLENDPLUS\b/i.test(v) ||
    /\bAUTOPAY\b/i.test(v) ||
    /\bMBD\b/i.test(v) ||
    /\bSF\d+\b/i.test(v)
  );
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

  if (typeof tx.amount !== "number" || typeof tx.balance !== "number") return true;
  if (Math.abs(tx.amount) > 5_000_000) return true;
  if (Math.abs(tx.balance) > 100_000_000) return true;

  return false;
}

function getStandardBankDescription(lines, i) {
  const prev = lines[i - 1];
  if (!prev) return "";

  if (isStandardBankMarkerLine(prev)) {
    const prev2 = lines[i - 2];
    if (
      prev2 &&
      !isStandardBankHeaderOrNoise(prev2) &&
      !extractStandardBankMoneyPair(prev2) &&
      !isStandardBankReversalMarker(prev2)
    ) {
      return prev2;
    }
    return "";
  }

  if (
    !isStandardBankHeaderOrNoise(prev) &&
    !extractStandardBankMoneyPair(prev) &&
    !isStandardBankReversalMarker(prev)
  ) {
    return prev;
  }

  return "";
}

function getStandardBankReference(lines, i, description) {
  const next = lines[i + 1];
  if (
    next &&
    isStandardBankReferenceLine(next) &&
    !extractStandardBankMoneyPair(next)
  ) {
    return next;
  }

  const descLower = normalizeWhitespace(description).toLowerCase();
  const isFeeFollowup =
    descLower === "fee-unpaid item" ||
    descLower === "unpaid fee debicheck d/o";

  if (isFeeFollowup) {
    for (let j = i - 1; j >= 0 && j >= i - 6; j--) {
      const candidate = lines[j];
      if (
        candidate &&
        isStandardBankReferenceLine(candidate) &&
        !isStandardBankReversalMarker(candidate)
      ) {
        return candidate;
      }
    }
  }

  return "";
}

function isStandardBankReversedTransaction(lines, i) {
  const next = lines[i + 1];
  const next2 = lines[i + 2];

  if (next && isStandardBankReferenceLine(next) && next2 && isStandardBankReversalMarker(next2)) {
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

  return Number((first.balance - first.amount).toFixed(2));
}

function reconcileStandardBankTransactions(transactions) {
  if (!Array.isArray(transactions) || transactions.length === 0) return [];

  const startingBalance = deriveStartingBalance(transactions);
  if (startingBalance == null) return transactions;

  const reconciled = [];
  let runningBalance = startingBalance;

  for (let i = 0; i < transactions.length; i++) {
    const tx = { ...transactions[i] };

    if (typeof tx.amount !== "number" || !Number.isFinite(tx.amount)) {
      continue;
    }

    runningBalance = Number((runningBalance + tx.amount).toFixed(2));
    tx.balance = runningBalance;

    reconciled.push(tx);
  }

  return reconciled;
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

export function extractStandardBankTransactions(text, statementPeriod = null) {
  const lines = String(text)
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);

  const transactions = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const moneyPair = extractStandardBankMoneyPair(line);
    if (!moneyPair) continue;

    const description = getStandardBankDescription(lines, i);
    const reference = getStandardBankReference(lines, i, description);

    if (shouldSkipStandardBankBlock(description, reference)) {
      continue;
    }

    if (isStandardBankReversedTransaction(lines, i)) {
      continue;
    }

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
      extractStandardBankDate(mergedDescription, statementPeriod) ||
      extractStandardBankDate(reference, statementPeriod) ||
      extractStandardBankDate(description, statementPeriod) ||
      null;

    const tx = {
      date,
      description: mergedDescription,
      amount: Number(moneyPair.amount.toFixed(2)),
      balance: Number(moneyPair.balance.toFixed(2)),
    };

    if (shouldSkipStandardBankTransaction(tx)) continue;

    transactions.push(tx);
  }

  const reconciled = reconcileStandardBankTransactions(transactions);
  return carryForwardDates(reconciled);
}