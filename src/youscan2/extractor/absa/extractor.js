import { normalizeWhitespace } from "../shared/utils.js";

const DATE_AT_START_RE = /^\s*(\d{1,2}\/\d{1,2}\/\d{4})/;

// safer money token
const MONEY_TOKEN_RE = /(\d{1,3}(?:[ ,]\d{3})*[.,]\d{2}-?)/g;

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

// stop parsing before footer
function truncateAtStatementEnd(text) {
  const stopPatterns = [
    /SERVICE FEE:/i,
    /CREDIT\s+INTEREST\s+RATE/i,
    /ABSA BUSINESS BANKING WILL BE UPDATING/i,
    /Cheque account statement/i,
  ];

  let cutIndex = text.length;

  for (const pattern of stopPatterns) {
    const idx = text.search(pattern);
    if (idx !== -1 && idx < cutIndex) {
      cutIndex = idx;
    }
  }

  return text.slice(0, cutIndex);
}

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

// normalize money
function normalizeMoneyToken(raw) {
  if (!raw) return null;

  let s = raw.trim();

  let negative = false;
  if (s.endsWith("-")) {
    negative = true;
    s = s.slice(0, -1);
  }

  s = s.replace(/\s+/g, "");

  if (s.includes(",") && !s.includes(".")) {
    s = s.replace(",", ".");
  }

  const value = parseFloat(s);
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

  const balance = money[money.length - 1].value;

  let amount = null;

  if (money.length >= 2) {
    amount = money[money.length - 2].value;
  } else if (previousBalance != null) {
    amount = Number((balance - previousBalance).toFixed(2));
  }

  let descriptionEnd = joined.length;
  if (money.length >= 2) {
    descriptionEnd = money[money.length - 2].index;
  } else {
    descriptionEnd = money[money.length - 1].index;
  }

  let description = joined
    .slice(dateMatch[0].length, descriptionEnd)
    .replace(/\b(Settlement|Headoffice)\b/gi, "")
    .replace(/\b[ACTMS]\b(?=\s*\d|$)/g, "")
    .replace(/\b\d+\.\d{2}A\b/g, "") // OCR junk like 40.00A
    .replace(/SERVICE FEE:.*$/i, "")
    .replace(/CREDIT INTEREST RATE.*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  description = normalizeWhitespace(description);

  if (!description) return null;
  if (DROP_DESCRIPTION_PATTERNS.some((re) => re.test(description))) return null;

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

  if (!amount || !balance) return null;

  if (Math.abs(amount) > 100000) return null;
  if (Math.abs(balance) > 10000000) return null;

  return {
    date,
    description,
    amount: Number(amount.toFixed(2)),
    balance: Number(balance.toFixed(2)),
  };
}

export function extractAbsaTransactions(text, openingBalance = null) {
  const cleaned = truncateAtStatementEnd(cleanAbsaText(text));

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

// ✅ NEW: Client Name Extractor (MANDATORY FIX)
export function extractAbsaClientName(text) {
  const match = String(text || "").match(
    /Cheque account statement\s+([A-Z][A-Z0-9&.,'\/\- ]+?)\s+40-\d{4}-\d{4}/i
  );

  if (!match) return null;

  return match[1].trim();
}