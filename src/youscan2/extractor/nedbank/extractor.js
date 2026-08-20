/**
 * YouScan V2
 * Nedbank bank-statement transaction extractor.
 *
 * This adapter is independent from the V1 parser. Nedbank statements often
 * expose the running balance more reliably than a signed transaction amount,
 * so V2 preserves the printed balance and derives the movement from the prior
 * observed balance when possible.
 */

import { normalizeDateToken } from "../shared/dates.js";
import { parseMoney } from "../shared/money.js";
import { normalizeWhitespace } from "../shared/utils.js";

const ROW_DATE = /^(\d{1,2}[\/-]\d{1,2}[\/-]\d{4})\b/;
const MONEY_TOKEN = /(?:^|\s)(R?\s*-?(?:\d{1,3}(?:[ ,]\d{3})+|\d+)\.\d{2})(?:\s*(Cr|Dr))?(?=\s|$)/gi;

function round2(value) {
  return Math.round(value * 100) / 100;
}

function parseNedbankMoney(value, marker = "") {
  if (!value) return null;

  const raw = String(value)
    .replace(/^R\s*/i, "")
    .replace(/\s+/g, "")
    .trim();

  const explicitNegative = raw.startsWith("-");
  const parsed = parseMoney(raw.replace(/^-/, ""));
  if (parsed === null) return null;

  const signMarker = String(marker || "").toLowerCase();
  if (signMarker === "dr") return -Math.abs(parsed);
  if (signMarker === "cr") return Math.abs(parsed);
  if (explicitNegative) return -Math.abs(parsed);
  return parsed;
}

function reconstructRows(text = "") {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^Date\s+(?:Description|Details|Transaction)/i.test(line))
    .filter((line) => !/^Page\s+\d+/i.test(line));

  const rows = [];
  let current = "";

  for (const line of lines) {
    if (ROW_DATE.test(line)) {
      if (current) rows.push(normalizeWhitespace(current));
      current = line;
    } else if (current) {
      if (/^(?:Closing\s*balance|Statement Summary|Summary of|Fees Summary|Important Information)\b/i.test(line)) {
        rows.push(normalizeWhitespace(current));
        current = "";
        continue;
      }
      current += ` ${line}`;
    }
  }

  if (current) rows.push(normalizeWhitespace(current));
  return rows;
}

function extractMoneyTokens(body = "") {
  const source = String(body || "");
  const matches = [];
  MONEY_TOKEN.lastIndex = 0;

  let match;
  while ((match = MONEY_TOKEN.exec(source)) !== null) {
    const raw = match[1];
    const marker = match[2] || "";
    const value = parseNedbankMoney(raw, marker);
    if (value === null) continue;

    const rawOffset = match[0].lastIndexOf(raw);
    matches.push({
      raw,
      marker,
      value,
      index: match.index + Math.max(0, rawOffset),
      end: match.index + match[0].length,
    });
  }

  return matches;
}

function stripSelectedMoney(body, moneyTokens) {
  let description = String(body || "");

  for (const token of [...moneyTokens].sort((a, b) => b.index - a.index)) {
    description =
      description.slice(0, token.index) + description.slice(token.end);
  }

  return normalizeWhitespace(
    description
      .replace(/^[*R,\s]+/, "")
      .replace(/\s{2,}/g, " ")
  );
}

function resolveAmount(candidate, balance, previousBalance) {
  if (
    typeof balance === "number" &&
    Number.isFinite(balance) &&
    typeof previousBalance === "number" &&
    Number.isFinite(previousBalance)
  ) {
    const delta = round2(balance - previousBalance);

    if (candidate === null || candidate === undefined) return delta;

    if (round2(Math.abs(candidate)) === round2(Math.abs(delta))) {
      return delta;
    }
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

  const description = stripSelectedMoney(
    body,
    amountToken ? [amountToken, balanceToken] : [balanceToken]
  );

  if (/\bopening\s*balance\b/i.test(description)) return null;
  if (/\bclosing\s*balance\b/i.test(description)) return null;

  const amount = resolveAmount(amountCandidate, balance, previousBalance);
  if (typeof amount !== "number" || !Number.isFinite(amount)) return null;

  return {
    date,
    description: description || "Transaction",
    amount: round2(amount),
    balance:
      typeof balance === "number" && Number.isFinite(balance)
        ? round2(balance)
        : null,
  };
}

export function extractNedbankTransactions(text, openingBalance = null) {
  const rows = reconstructRows(text);
  const transactions = [];
  let previousBalance =
    typeof openingBalance === "number" && Number.isFinite(openingBalance)
      ? round2(openingBalance)
      : null;

  for (const row of rows) {
    const tx = parseRow(row, previousBalance);
    if (!tx) continue;

    transactions.push(tx);
    if (typeof tx.balance === "number" && Number.isFinite(tx.balance)) {
      previousBalance = tx.balance;
    }
  }

  return transactions;
}
