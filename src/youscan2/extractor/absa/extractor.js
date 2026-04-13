import { normalizeWhitespace } from "../shared/utils.js";
import { parseMoney } from "../shared/money.js";

function parseAbsaMoney(value) {
  if (!value) return null;

  let raw = String(value).trim();
  let negative = false;

  if (raw.endsWith("-")) {
    negative = true;
    raw = raw.slice(0, -1);
  }

  raw = raw.replace(/\s+/g, "");

  const hasComma = raw.includes(",");
  const hasDot = raw.includes(".");

  if (hasComma && hasDot) {
    raw = raw.replace(/,/g, "");
  } else if (hasComma && !hasDot) {
    raw = raw.replace(/\./g, "").replace(",", ".");
  }

  const num = Number(raw);
  if (Number.isNaN(num)) return null;

  return negative ? -Math.abs(num) : num;
}

function shouldSkipNoImpactRow(description, amount, currentBalance, previousBalance) {
  const lower = String(description).toLowerCase();

  const likelyNonPosting =
    lower.includes("proof of pmt email") ||
    lower.includes("notific fee") ||
    lower.includes("smsnotifyme");

  if (
    likelyNonPosting &&
    typeof currentBalance === "number" &&
    typeof previousBalance === "number" &&
    currentBalance === previousBalance
  ) {
    return true;
  }

  if (amount === 0) return true;

  return false;
}

function applyBalanceDrivenCorrection(transactions) {
  for (let i = 1; i < transactions.length; i++) {
    const prev = transactions[i - 1];
    const curr = transactions[i];

    if (
      typeof prev.balance === "number" &&
      typeof curr.balance === "number"
    ) {
      const diff = Number((curr.balance - prev.balance).toFixed(2));

      if (diff !== 0) {
        curr.amount = diff;
      }

      if (
        shouldSkipNoImpactRow(
          curr.description,
          curr.amount,
          curr.balance,
          prev.balance
        )
      ) {
        curr._skip = true;
      }
    }
  }

  return transactions.filter((tx) => !tx._skip);
}

function looksLikeAbsaTransactionLine(line) {
  return /^\d{1,2}[\/-]\d{1,2}[\/-]\d{4}/.test(line.trim());
}

export function extractAbsaTransactions(text) {
  const lines = String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const transactions = [];

  for (const line of lines) {
    if (!looksLikeAbsaTransactionLine(line)) continue;

    const dateMatch = line.match(/^(\d{1,2}[\/-]\d{1,2}[\/-]\d{4})/);
    if (!dateMatch) continue;

    const date = dateMatch[1];
    const rest = line.slice(date.length).trim();

    const moneyMatches = [...rest.matchAll(/-?\d[\d\s,.]*\d(?:[.,]\d{2})-?/g)].map((m) => ({
      value: normalizeWhitespace(m[0]),
      index: m.index,
    }));

    if (moneyMatches.length < 1) continue;

    const descLowerRaw = normalizeWhitespace(rest).toLowerCase();

    if (descLowerRaw.includes("bal brought forward")) {
      continue;
    }

    if (moneyMatches.length < 2) continue;

    const amountMatch = moneyMatches[moneyMatches.length - 2];
    const balanceMatch = moneyMatches[moneyMatches.length - 1];

    const description = normalizeWhitespace(rest.slice(0, amountMatch.index));
    if (!description) continue;

    let amount = parseAbsaMoney(amountMatch.value);
    const balance = parseAbsaMoney(balanceMatch.value) ?? parseMoney(balanceMatch.value);

    if (amount === null || balance === null) continue;

    const descLower = description.toLowerCase();

    const isCredit =
      descLower.includes(" cr") ||
      descLower.includes("credit") ||
      descLower.includes("deposit") ||
      descLower.includes("acb credit");

    const isDebit =
      descLower.includes(" fee") ||
      descLower.includes("charge") ||
      descLower.includes("withdrawal") ||
      descLower.includes("debit") ||
      descLower.includes("pmt");

    if (isCredit) {
      amount = Math.abs(amount);
    } else if (isDebit) {
      amount = -Math.abs(amount);
    }

    if (amount === 0) continue;

    transactions.push({
      date,
      description,
      amount,
      balance,
    });
  }

  return applyBalanceDrivenCorrection(transactions).map((tx) => ({
    date: tx.date,
    description: tx.description,
    amount: Number(tx.amount.toFixed(2)),
    balance: Number(tx.balance.toFixed(2)),
  }));
}