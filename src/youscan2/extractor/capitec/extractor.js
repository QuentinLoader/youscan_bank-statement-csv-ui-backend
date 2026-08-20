/**
 * YouScan V2
 * Capitec bank-statement transaction extractor.
 *
 * This adapter is independent from the V1 parser. It preserves the running
 * balances printed on the statement and uses balance movement to resolve the
 * sign of transaction amounts when Capitec prints an unsigned amount column.
 */

import { normalizeDateToken } from "../shared/dates.js";
import { parseMoney } from "../shared/money.js";
import { normalizeWhitespace } from "../shared/utils.js";

const ROW_DATE = /^(\d{1,2}[\/-]\d{1,2}[\/-]\d{4})\b/;
const MONEY_TOKEN = /(?:^|\s)(R?\s*-?(?:\d{1,3}(?:[ ,]\d{3})+|\d+)\.\d{2})(?=\s|$)/gi;

function round2(value) {
  return Math.round(value * 100) / 100;
}

function parseCapitecMoney(value) {
  if (!value) return null;

  const raw = String(value)
    .replace(/^R\s*/i, "")
    .replace(/\s+/g, "")
    .trim();

  const parsed = parseMoney(raw.replace(/^-/, ""));
  if (parsed === null) return null;

  return raw.startsWith("-") ? -Math.abs(parsed) : parsed;
}

function isolateTransactionHistory(text = "") {
  const source = String(text || "");
  const startMatch = source.match(/Transaction History/i);
  if (!startMatch) return "";

  const start = (startMatch.index || 0) + startMatch[0].length;
  let block = source.slice(start);

  const footerPatterns = [
    /\*\s*Includes VAT/i,
    /\bClosing Balance\s*:/i,
    /\bSummary of Fees\b/i,
  ];

  let end = block.length;
  for (const pattern of footerPatterns) {
    const match = block.match(pattern);
    if (match && typeof match.index === "number") {
      end = Math.min(end, match.index);
    }
  }

  block = block.slice(0, end);

  return block
    .replace(/Page\s+\d+\s+of\s+\d+/gi, " ")
    .trim();
}

function reconstructRows(text = "") {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^Date\s+Description/i.test(line));

  const rows = [];
  let current = "";

  for (const line of lines) {
    if (ROW_DATE.test(line)) {
      if (current) rows.push(normalizeWhitespace(current));
      current = line;
    } else if (current) {
      current += ` ${line}`;
    }
  }

  if (current) rows.push(normalizeWhitespace(current));
  return rows;
}

function extractMoneyTokens(body = "") {
  const matches = [];
  const source = String(body || "");
  MONEY_TOKEN.lastIndex = 0;

  let match;
  while ((match = MONEY_TOKEN.exec(source)) !== null) {
    const raw = match[1];
    const parsed = parseCapitecMoney(raw);
    if (parsed === null) continue;

    const rawOffset = match[0].lastIndexOf(raw);
    matches.push({
      raw,
      value: parsed,
      index: match.index + Math.max(0, rawOffset),
      end: match.index + Math.max(0, rawOffset) + raw.length,
    });
  }

  return matches;
}

function resolveAmount(candidate, balance, previousBalance) {
  if (typeof balance !== "number" || !Number.isFinite(balance)) return candidate;
  if (typeof previousBalance !== "number" || !Number.isFinite(previousBalance)) {
    return candidate;
  }

  const delta = round2(balance - previousBalance);
  if (candidate === null || candidate === undefined) return delta;

  if (round2(Math.abs(delta)) === round2(Math.abs(candidate))) {
    return delta;
  }

  return candidate;
}

function parseRow(row, previousBalance) {
  const dateMatch = String(row || "").match(ROW_DATE);
  if (!dateMatch) return null;

  const date = normalizeDateToken(dateMatch[1]);
  if (!date) return null;

  const body = String(row).slice(dateMatch[0].length).trim();
  const money = extractMoneyTokens(body);
  if (money.length === 0) return null;

  const balanceToken = money[money.length - 1];
  const amountToken = money.length >= 2 ? money[money.length - 2] : null;

  const balance = balanceToken.value;
  const amountCandidate = amountToken?.value ?? null;
  const amount = resolveAmount(amountCandidate, balance, previousBalance);

  const descriptionEnd = amountToken?.index ?? balanceToken.index;
  const description = normalizeWhitespace(body.slice(0, descriptionEnd)) || "Transaction";

  return {
    date,
    description,
    amount: typeof amount === "number" ? round2(amount) : null,
    balance: typeof balance === "number" ? round2(balance) : null,
  };
}

export function extractCapitecTransactions(text, openingBalance = null) {
  const transactionBlock = isolateTransactionHistory(text);
  if (!transactionBlock) return [];

  const rows = reconstructRows(transactionBlock);
  const transactions = [];
  let previousBalance =
    typeof openingBalance === "number" && Number.isFinite(openingBalance)
      ? round2(openingBalance)
      : null;

  for (const row of rows) {
    const tx = parseRow(row, previousBalance);
    if (!tx || typeof tx.amount !== "number") continue;

    transactions.push(tx);
    if (typeof tx.balance === "number" && Number.isFinite(tx.balance)) {
      previousBalance = tx.balance;
    }
  }

  return transactions;
}
