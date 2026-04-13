import { normalizeWhitespace } from "./utils.js";
import { parseSignedMoney, parseStandardBankBalanceToken } from "./money.js";

function parseLooseMoney(value) {
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

export function extractAccountNumber(text) {
  const source = String(text || "");

  const patterns = [
    /account number[:\s]*([0-9][0-9\s]{6,30})/i,
    /acc(?:ount)?\s*(?:no|number)?[:\s]*([0-9][0-9\s]{6,30})/i,
    /account no[:\s]*([0-9][0-9\s]{6,30})/i,
    /cheque account number[:\s]*([0-9][0-9\s-]{6,30})/i,
    /cheque account[:\s]*([0-9][0-9\s-]{6,30})/i,
    /\b(\d{2}-\d{4}-\d{4})\b/,
    /\b(\d{10,12})\b/,
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match) {
      const digits = match[1].replace(/\D/g, "");
      if (digits.length >= 10) return digits;
    }
  }

  return null;
}

export function extractClientName(text) {
  const source = String(text || "");

  const patterns = [
    // ABSA-specific: "Cheque account statement" followed by client name, then account number
    /Cheque account statement\s+([A-Z][A-Z0-9\s&'.()/-]{5,120}?)\s+40-\d{4}-\d{4}/i,

    /account holder[:\s]+([A-Z][A-Z\s'.&/-]{3,120})/i,
    /customer name[:\s]+([A-Z][A-Z\s'.&/-]{3,120})/i,
    /\b(MR\.\s+[A-Z][A-Z\s'.&-]{2,80})\b/i,
    /\b(MRS\.\s+[A-Z][A-Z\s'.&-]{2,80})\b/i,
    /\b(MS\.\s+[A-Z][A-Z\s'.&-]{2,80})\b/i,
    /^\s*([A-Z][A-Z0-9\s&'.()/-]{5,120}\b(?:CC|PTY LTD|LIMITED|LTD))\s*$/im,
    /^\s*([A-Z][A-Z0-9\s&'.()/-]{5,120})\s*\nPOSTNET SUITE/im,
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match) {
      const candidate = normalizeWhitespace(match[1]);

      if (
        candidate &&
        !/date\s*transaction\s*description/i.test(candidate) &&
        !/charge\s*debit\s*amount\s*credit\s*amount\s*balance/i.test(candidate) &&
        !/absa bank limited/i.test(candidate)
      ) {
        return candidate;
      }
    }
  }

  return null;
}

export function extractBalanceByPatterns(text, patterns) {
  for (const pattern of patterns) {
    const match = String(text || "").match(pattern);
    if (match) {
      const value =
        parseLooseMoney(match[1]) ??
        parseSignedMoney(match[1]);

      if (value !== null) return value;
    }
  }

  return null;
}

export function extractOpeningBalance(text) {
  return extractBalanceByPatterns(text, [
    /opening balance[:\s]*([0-9,.\s:-]+)/i,
    /balance brought forward[:\s]*([0-9,.\s:-]+)/i,
    /bal brought forward[:\s]*([0-9,.\s:-]+)/i,
    /BALANCE BROUGHT FORWARD[:\s]*([0-9,.\s:-]+)/i,
    /\bBal Brought Forward([0-9,.\s:-]+)/i,
  ]);
}

export function extractClosingBalance(text) {
  return extractBalanceByPatterns(text, [
    /closing balance[:\s]*([0-9,.\s:-]+)/i,
    /final balance[:\s]*([0-9,.\s:-]+)/i,
    /current balance[:\s]*([0-9,.\s:-]+)/i,
    /Month-end BalanceR?([0-9,.\s:-]+)/i,
    /\bBalance([0-9,.\s:-]+)\s*$/im,
  ]);
}

export function extractStatementPeriod(text) {
  const patterns = [
    /statement period[:\s]+([0-9]{1,2}[\/-][0-9]{1,2}[\/-][0-9]{2,4})\s+(?:to|-)\s+([0-9]{1,2}[\/-][0-9]{1,2}[\/-][0-9]{2,4})/i,
    /period[:\s]+([0-9]{1,2}[\/-][0-9]{1,2}[\/-][0-9]{2,4})\s+(?:to|-)\s+([0-9]{1,2}[\/-][0-9]{1,2}[\/-][0-9]{2,4})/i,
    /from[:\s]+([0-9]{1,2}[\/-][0-9]{1,2}[\/-][0-9]{2,4})\s+(?:to|-)\s+([0-9]{1,2}[\/-][0-9]{1,2}[\/-][0-9]{2,4})/i,
    /Statement from\s+([0-9]{1,2}\s+[A-Za-z]+\s+[0-9]{4})\s+to\s+([0-9]{1,2}\s+[A-Za-z]+\s+[0-9]{4})/i,
    /Your transactions\s*([0-9]{1,2}\s+[A-Za-z]{3,9}\s+[0-9]{4})\s*to\s*([0-9]{1,2}\s+[A-Za-z]{3,9}\s+[0-9]{4})/i,
  ];

  for (const pattern of patterns) {
    const match = String(text || "").match(pattern);
    if (match) {
      return {
        start: normalizeWhitespace(match[1]),
        end: normalizeWhitespace(match[2]),
      };
    }
  }

  return { start: null, end: null };
}

export function extractStandardBankOpeningBalance(text) {
  const patterns = [
    /BALANCE BROUGHT FORWARD\s+([0-9,\s.:-]+)/i,
    /balance brought forward[:\s]+([0-9,\s.:-]+)/i,
  ];

  for (const pattern of patterns) {
    const match = String(text || "").match(pattern);
    if (match) {
      const value = parseStandardBankBalanceToken(match[1]);
      if (value !== null) return value;
    }
  }

  return null;
}

export function extractStandardBankClosingBalance(text) {
  const patterns = [
    /Month-end BalanceR?([0-9,\s.:-]+)/i,
    /closing balance[:\s]+([0-9,\s.:-]+)/i,
    /final balance[:\s]+([0-9,\s.:-]+)/i,
    /current balance[:\s]+([0-9,\s.:-]+)/i,
  ];

  for (const pattern of patterns) {
    const match = String(text || "").match(pattern);
    if (match) {
      const value = parseStandardBankBalanceToken(match[1]);
      if (value !== null) return value;
    }
  }

  return null;
}