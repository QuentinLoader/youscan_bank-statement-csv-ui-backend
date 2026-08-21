import { normalizeWhitespace } from "./utils.js";

export function parseMoney(value) {
  if (!value) return null;

  const cleaned = String(value)
    .replace(/\s+/g, "")
    .replace(/,/g, "");

  const number = Number(cleaned);
  return Number.isNaN(number) ? null : Number(number.toFixed(2));
}

export function parseSignedMoney(value) {
  if (!value) return null;

  let raw = String(value).trim();
  let negative = false;

  if (raw.endsWith("-")) {
    negative = true;
    raw = raw.slice(0, -1);
  }

  const parsed = parseMoney(raw);
  if (parsed === null) return null;

  return negative ? -Math.abs(parsed) : parsed;
}

export function cleanStandardBankMoneyToken(value) {
  if (!value) return null;

  let token = String(value)
    .replace(/\s+/g, "")
    .replace(/,/g, "")
    .trim();

  let negative = false;
  if (token.endsWith("-")) {
    negative = true;
    token = token.slice(0, -1);
  }

  if (!/^\d+(\.\d{2})?$/.test(token)) return null;

  const num = Number(token);
  if (Number.isNaN(num)) return null;

  return negative ? -num : num;
}

export function normalizeStandardBankBalanceToken(value) {
  let token = normalizeWhitespace(value || "");
  if (!token) return "";
  token = token.replace(/\s+/g, "");

  return token;
}

export function repairSuspiciousStandardBankBalance(balance) {
  if (balance == null || !Number.isFinite(balance)) return null;

  const sign = balance < 0 ? -1 : 1;
  const abs = Math.abs(balance);
  const asFixed = abs.toFixed(2);
  const [whole, decimal] = asFixed.split(".");

  if (whole.length >= 7) {
    const attemptA = whole.slice(0, 2) + whole.slice(3);
    const parsedA = Number(`${attemptA}.${decimal}`);
    if (!Number.isNaN(parsedA)) {
      return sign * parsedA;
    }
  }

  return balance;
}

export function parseStandardBankBalanceToken(value) {
  let token = normalizeStandardBankBalanceToken(value);
  if (!token) return null;

  let negative = false;
  if (token.endsWith("-")) {
    negative = true;
    token = token.slice(0, -1);
  }

  if (!/^\d[\d,]*\.\d{2}$/.test(token)) {
    return null;
  }

  const direct = parseMoney(token);
  if (direct !== null) {
    return negative ? -Math.abs(direct) : direct;
  }

  return null;
}

