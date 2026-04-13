import { normalizeWhitespace } from "../shared/utils.js";
import { parseSignedMoney, parseStandardBankBalanceToken } from "../shared/money.js";

const DATE_AT_START_RE = /^\s*(\d{1,2}\/\d{1,2}\/\d{4})/;
const ANY_DATE_RE = /\b\d{1,2}\/\d{1,2}\/\d{4}\b/g;

// Broad enough for OCR text like:
// 844.73
// 3 844.73
// 1 382.23
// 4 000,00-
const MONEY_TOKEN_RE = /(?<!\d)(\d{1,3}(?:[ ,]\d{3})*[.,]\d{2}-?|\d+[.,]\d{2}-?)(?!\d)/g;

const NOISE_PATTERNS = [
  /authorised financial services provider/i,
  /registration number/i,
  /vat registration number/i,
  /tax invoice/i,
  /general enquiries/i,
  /absa bank ltd/i,
  /absa bank limited/i,
  /your transactions(?:\(continued\))?/i,
  /date\s*transaction\s*description/i,
  /account summary/i,
  /return address/i,
  /our privacy notice/i,
  /credit interest rate/i,
  /updating its fees and charges/i,
  /detailed information or visit/i,
  /charge:\s+a\s*=\s*administration/i,
  /page\s+\d+\s+of\s+\d+/i,
  /estamp/i,
  /statement no:/i,
  /client vat reg no:/i,
  /overdraft limit/i,
];

const DROP_DESCRIPTION_PATTERNS = [
  /^bal brought forward$/i,
  /^proof of pmt email$/i,
  /^notific fee sms/i,
];

function isNoiseLine(line) {
  const s = normalizeWhitespace(line || "");
  if (!s) return true;
  return NOISE_PATTERNS.some((re) => re.test(s));
}

function cleanAbsaText(text) {
  return String(text || "")
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "\n");
}

function normalizeMoneyToken(raw) {
  if (!raw) return null;
  let s = String(raw).trim();

  let negative = false;
  if (s.endsWith("-")) {
    negative = true;
    s = s.slice(0, -1);
  }

  s = s.replace(/\s+/g, "");
  s = s.replace(/,/g, ".");

  const value = Number.parseFloat(s);
  if (!Number.isFinite(value)) return null;

  return negative ? -value : value;
}

function extractMoneyTokens(text) {
  return [...String(text || "").matchAll(MONEY_TOKEN_RE)]
    .map((m) => ({
      raw: m[0],
      value: normalizeMoneyToken(m[0]),
      index: m.index ?? -1,
    }))
    .filter((x) => Number.isFinite(x.value));
}

function splitIntoTransactionBlocks(lines) {
  const blocks = [];
  let current = [];

  for (const rawLine of lines) {
    const line = normalizeWhitespace(rawLine);
    if (!line || isNoiseLine(line)) continue;

    if (DATE_AT_START_RE.test(line)) {
      if (current.length) blocks.push(current);
      current = [line];
    } else if (current.length) {
      current.push(line);
    }
  }

  if (current.length) blocks.push(current);
  return blocks;
}

function parseAbsaBlock(block, previousBalance = null) {
  const firstLine = block[0] || "";
  const dateMatch = firstLine.match(DATE_AT_START_RE);
  if (!dateMatch) return null;

  const date = dateMatch[1];
  const joined = normalizeWhitespace(block.join(" "));
  const money = extractMoneyTokens(joined);

  if (!money.length) return null;

  // Last clean money token is almost always balance.
  const balance = money[money.length - 1].value;

  // Candidate amount is usually the token immediately before balance.
  let amount = null;
  if (money.length >= 2) {
    amount = money[money.length - 2].value;
  } else if (previousBalance != null) {
    amount = Number((balance - previousBalance).toFixed(2));
  }

  // Description is everything after date and before the amount token.
  let descriptionEnd = joined.length;
  if (money.length >= 2) {
    descriptionEnd = money[money.length - 2].index;
  } else if (money.length >= 1) {
    descriptionEnd = money[money.length - 1].index;
  }

  let description = normalizeWhitespace(
    joined
      .slice(dateMatch[0].length, descriptionEnd)
      .replace(/\b(?:Settlement|Headoffice)\b/gi, " ")
      .replace(/\b[ACTMS]\b(?=\s*\d|$)/g, " ")
  );

  description = description
    .replace(/\s{2,}/g, " ")
    .trim();

  if (!description) return null;
  if (DROP_DESCRIPTION_PATTERNS.some((re) => re.test(description))) return null;

  // Fallback sign inference from continuity.
  if (previousBalance != null && amount != null) {
    const debitCandidate = Number((previousBalance - Math.abs(amount)).toFixed(2));
    const creditCandidate = Number((previousBalance + Math.abs(amount)).toFixed(2));

    if (Math.abs(balance - debitCandidate) < 0.01) {
      amount = -Math.abs(amount);
    } else if (Math.abs(balance - creditCandidate) < 0.01) {
      amount = Math.abs(amount);
    } else {
      amount = Number((balance - previousBalance).toFixed(2));
    }
  }

  return {
    date,
    description,
    amount: amount != null ? Number(amount.toFixed(2)) : null,
    balance: Number(balance.toFixed(2)),
  };
}

export function extractAbsaTransactions(text, openingBalance = null) {
  const cleaned = cleanAbsaText(text);
  const lines = cleaned.split("\n");

  const blocks = splitIntoTransactionBlocks(lines);
  const transactions = [];

  let previousBalance = openingBalance;

  for (const block of blocks) {
    const tx = parseAbsaBlock(block, previousBalance);
    if (!tx) continue;

    transactions.push(tx);
    previousBalance = tx.balance;
  }

  return transactions;
}