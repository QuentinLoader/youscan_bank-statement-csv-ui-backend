import { normalizeWhitespace } from "../shared/utils.js";

const DATE_AT_START_RE = /^\s*(\d{1,2}\/\d{1,2}\/\d{4})/;
const TRANSACTION_DATE_RE = /^\s*\d{1,2}\/\d{1,2}\/\d{4}/m;

// Supports common SA statement formats such as 1,234.56, 1 234,56,
// 1234.56 and trailing-minus values such as 123.45-.
const MONEY_TOKEN_RE = /(?<![A-Za-z0-9])-?(?:\d{1,3}(?:[ ,]\d{3})+|\d+)[.,]\d{2}-?(?![A-Za-z0-9])/g;

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
  /^closing balance\b/i,
  /^final balance\b/i,
  /^current balance\b/i,
];

const DROP_DESCRIPTION_PATTERNS = [
  /^bal brought forward$/i,
  /^proof of pmt email$/i,
  /^notific fee sms/i,
];

function findFirstTransactionIndex(text) {
  const match = TRANSACTION_DATE_RE.exec(String(text || ""));
  return match?.index ?? -1;
}

// Footer markers are only honoured after the first transaction row. This is
// important for ABSA because "Cheque account statement" also appears in the
// normal statement header and must never truncate the document at the top.
function truncateAtStatementEnd(text) {
  const source = String(text || "");
  const firstTransactionIndex = findFirstTransactionIndex(source);

  if (firstTransactionIndex === -1) return source;

  const stopPatterns = [
    /SERVICE FEE:/i,
    /CREDIT\s+INTEREST\s+RATE/i,
    /ABSA BUSINESS BANKING WILL BE UPDATING/i,
    /Cheque account statement/i,
    /Our Privacy Notice/i,
  ];

  const tail = source.slice(firstTransactionIndex);
  let cutIndex = source.length;

  for (const pattern of stopPatterns) {
    const idx = tail.search(pattern);
    if (idx !== -1) {
      const absoluteIndex = firstTransactionIndex + idx;
      if (absoluteIndex < cutIndex) cutIndex = absoluteIndex;
    }
  }

  return source.slice(0, cutIndex);
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

function normalizeMoneyToken(raw) {
  if (!raw) return null;

  let value = String(raw).trim();
  let negative = false;

  if (value.startsWith("-")) {
    negative = true;
    value = value.slice(1);
  }

  if (value.endsWith("-")) {
    negative = true;
    value = value.slice(0, -1);
  }

  value = value.replace(/\s+/g, "");

  const lastComma = value.lastIndexOf(",");
  const lastDot = value.lastIndexOf(".");

  if (lastComma !== -1 && lastDot !== -1) {
    if (lastDot > lastComma) {
      // 1,234.56
      value = value.replace(/,/g, "");
    } else {
      // 1.234,56
      value = value.replace(/\./g, "").replace(",", ".");
    }
  } else if (lastComma !== -1) {
    // 1 234,56 or 1234,56
    value = value.replace(/,/g, ".");
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;

  return negative ? -Math.abs(parsed) : parsed;
}

function extractMoneyTokens(text) {
  return [...String(text || "").matchAll(MONEY_TOKEN_RE)]
    .map((match) => ({
      raw: match[0],
      value: normalizeMoneyToken(match[0]),
      index: match.index ?? -1,
    }))
    .filter((item) => Number.isFinite(item.value));
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

function isFiniteMoney(value) {
  return typeof value === "number" && Number.isFinite(value);
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
  if (!isFiniteMoney(balance)) return null;

  let amount = null;

  // Running-balance delta is the strongest deterministic signal and also
  // copes with ABSA layouts containing extra charge/value columns.
  if (isFiniteMoney(previousBalance)) {
    amount = Number((balance - previousBalance).toFixed(2));
  } else if (money.length >= 2) {
    amount = money[money.length - 2].value;
  }

  if (!isFiniteMoney(amount)) return null;

  // Description ends at the first money column rather than the penultimate
  // token so extra fee/debit/credit columns cannot leak into the description.
  const descriptionEnd = money[0]?.index ?? joined.length;

  let description = joined
    .slice(dateMatch[0].length, descriptionEnd)
    .replace(/\b(Settlement|Headoffice)\b/gi, "")
    .replace(/\b[ACTMS]\b(?=\s*\d|$)/g, "")
    .replace(/\b\d+\.\d{2}A\b/g, "")
    .replace(/SERVICE FEE:.*$/i, "")
    .replace(/CREDIT INTEREST RATE.*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  description = normalizeWhitespace(description);

  if (!description) return null;
  if (DROP_DESCRIPTION_PATTERNS.some((re) => re.test(description))) return null;

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
  let previousBalance = isFiniteMoney(openingBalance) ? openingBalance : null;

  for (const block of blocks) {
    const tx = parseAbsaBlock(block, previousBalance);
    if (!tx) continue;

    transactions.push(tx);
    previousBalance = tx.balance;
  }

  return transactions;
}

export function extractAbsaClientName(text) {
  const match = String(text || "").match(
    /Cheque account statement\s+([A-Z][A-Z0-9&.,'\/\- ]+?)\s+40-\d{4}-\d{4}/i
  );

  if (!match) return null;
  return normalizeWhitespace(match[1]);
}
