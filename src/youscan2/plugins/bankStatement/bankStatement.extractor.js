/**
 * YouScan 2.0
 * Bank statement extractor (merged ABSA + Standard Bank)
 */

function normalizeWhitespace(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function parseMoney(value) {
  if (!value) return null;

  const cleaned = String(value)
    .replace(/\s+/g, "")
    .replace(/,/g, "");

  const number = Number(cleaned);
  return Number.isNaN(number) ? null : Number(number.toFixed(2));
}

/* =========================
   METADATA HELPERS
========================= */

function extractAccountNumber(text) {
  const patterns = [
    /account number[:\s]+([0-9]{6,20})/i,
    /acc(?:ount)?\s*(?:no|number)?[:\s]+([0-9]{6,20})/i,
    /account no[:\s]+([0-9]{6,20})/i,
    /cheque account[:\s]+([0-9]{6,20})/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }

  return null;
}

function extractClientName(text) {
  const patterns = [
    /account holder[:\s]+([A-Z][A-Z\s'.&-]{3,80})/i,
    /customer name[:\s]+([A-Z][A-Z\s'.&-]{3,80})/i,
    /name[:\s]+([A-Z][A-Z\s'.&-]{3,80})/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return normalizeWhitespace(match[1]);
  }

  return null;
}

function extractBalanceByPatterns(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const value = parseMoney(match[1]);
      if (value !== null) return value;
    }
  }

  return null;
}

function extractOpeningBalance(text) {
  return extractBalanceByPatterns(text, [
    /opening balance[:\s]+(-?[0-9,]+\.\d{2})/i,
    /balance brought forward[:\s]+(-?[0-9,]+\.\d{2})/i,
    /bal brought forward[:\s]+(-?[0-9,]+\.\d{2})/i,
  ]);
}

function extractClosingBalance(text) {
  return extractBalanceByPatterns(text, [
    /closing balance[:\s]+(-?[0-9,]+\.\d{2})/i,
    /final balance[:\s]+(-?[0-9,]+\.\d{2})/i,
    /current balance[:\s]+(-?[0-9,]+\.\d{2})/i,
  ]);
}

function extractStatementPeriod(text) {
  const patterns = [
    /statement period[:\s]+([0-9]{1,2}[\/-][0-9]{1,2}[\/-][0-9]{2,4})\s+(?:to|-)\s+([0-9]{1,2}[\/-][0-9]{1,2}[\/-][0-9]{2,4})/i,
    /period[:\s]+([0-9]{1,2}[\/-][0-9]{1,2}[\/-][0-9]{2,4})\s+(?:to|-)\s+([0-9]{1,2}[\/-][0-9]{1,2}[\/-][0-9]{2,4})/i,
    /from[:\s]+([0-9]{1,2}[\/-][0-9]{1,2}[\/-][0-9]{2,4})\s+(?:to|-)\s+([0-9]{1,2}[\/-][0-9]{1,2}[\/-][0-9]{2,4})/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return {
        start: match[1],
        end: match[2],
      };
    }
  }

  return {
    start: null,
    end: null,
  };
}

/* =========================
   COMMON HELPERS
========================= */

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

/* =========================
   ABSA
========================= */

function looksLikeAbsaTransactionLine(line) {
  return /^\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?/.test(line.trim());
}

function extractAbsaTransactions(text) {
  const lines = String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const transactions = [];

  for (const line of lines) {
    if (!looksLikeAbsaTransactionLine(line)) continue;

    const dateMatch = line.match(/^(\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?)/);
    if (!dateMatch) continue;

    const date = dateMatch[1];
    const rest = line.slice(date.length).trim();

    const moneyMatches = [...rest.matchAll(/-?\d[\d,]*\.\d{2}/g)].map((m) => ({
      value: m[0],
      index: m.index,
    }));

    if (moneyMatches.length < 2) continue;

    const amountMatch = moneyMatches[moneyMatches.length - 2];
    const balanceMatch = moneyMatches[moneyMatches.length - 1];

    const description = normalizeWhitespace(rest.slice(0, amountMatch.index));
    if (!description) continue;

    let amount = parseMoney(amountMatch.value);
    const balance = parseMoney(balanceMatch.value);

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

/* =========================
   STANDARD BANK
========================= */

function cleanStandardBankMoneyToken(value) {
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

function extractStandardBankMoneyPair(line) {
  const raw = String(line || "");

  const cleaned = raw
    .replace(/(\d{2,})\s+(\d{3},)/g, "$1$2")
    .replace(/\s+/g, " ");

  const matches = cleaned.match(/\d[\d,]*\.\d{2}-?/g);
  if (!matches || matches.length < 2) return null;

  const amountRaw = matches[0];
  const balanceRaw = matches[1];

  const amount = cleanStandardBankMoneyToken(amountRaw);
  const balance = cleanStandardBankMoneyToken(balanceRaw);

  if (amount === null || balance === null) return null;

  if (Math.abs(amount) > 1_000_000) return null;
  if (Math.abs(balance) > 10_000_000) return null;

  return { amount, balance };
}

function isStandardBankMarkerLine(line) {
  const v = normalizeWhitespace(line);
  return v === "##";
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
    /\bRTD-NOT PROVIDED FOR\b/i.test(v)
  );
}

function extractStandardBankDate(value) {
  const text = normalizeWhitespace(value);

  let match = text.match(/\bROL(\d{2})(\d{2})(\d{2})\b/i);
  if (match) {
    const dd = match[1];
    const mm = match[2];
    const yy = Number(match[3]);
    const yyyy = yy <= 49 ? 2000 + yy : 1900 + yy;
    return `${dd}/${mm}/${yyyy}`;
  }

  match = text.match(/\b(\d{2})(\d{2})(\d{2})\b/);
  if (match) {
    const dd = match[1];
    const mm = match[2];
    const yy = Number(match[3]);
    const yyyy = yy <= 49 ? 2000 + yy : 1900 + yy;
    return `${dd}/${mm}/${yyyy}`;
  }

  return null;
}

function shouldSkipStandardBankBlock(description, reference) {
  const desc = normalizeWhitespace(description).toLowerCase();
  const ref = normalizeWhitespace(reference).toLowerCase();

  if (!desc) return true;
  if (desc === "##") return true;

  if (
    desc === "fee-unpaid item" ||
    desc === "unpaid fee debicheck d/o" ||
    desc.includes("these fees include vat")
  ) {
    return true;
  }

  if (ref === "##") return true;

  return false;
}

function extractStandardBankTransactions(text) {
  const lines = String(text)
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);

  const transactions = [];

  for (let i = 0; i < lines.length; i++) {
    const moneyPair = extractStandardBankMoneyPair(lines[i]);
    if (!moneyPair) continue;

    let description = "";
    let reference = "";

    if (i > 0) {
      const prev = lines[i - 1];

      if (
        prev &&
        !isStandardBankMarkerLine(prev) &&
        !isStandardBankHeaderOrNoise(prev) &&
        !extractStandardBankMoneyPair(prev)
      ) {
        description = prev;
      }
    }

    if (i + 1 < lines.length) {
      const next = lines[i + 1];

      if (
        next &&
        !isStandardBankMarkerLine(next) &&
        !isStandardBankHeaderOrNoise(next) &&
        !extractStandardBankMoneyPair(next) &&
        isStandardBankReferenceLine(next)
      ) {
        reference = next;
      }
    }

    if (shouldSkipStandardBankBlock(description, reference)) {
      continue;
    }

    const mergedDescription = normalizeWhitespace(
      reference ? `${description} ${reference}` : description
    );

    const date =
      extractStandardBankDate(reference) ||
      extractStandardBankDate(description) ||
      null;

    transactions.push({
      date,
      description: mergedDescription,
      amount: Number(moneyPair.amount.toFixed(2)),
      balance: Number(moneyPair.balance.toFixed(2)),
    });
  }

  return applyBalanceDrivenCorrection(transactions).map((tx) => ({
    date: tx.date,
    description: tx.description,
    amount: Number(tx.amount.toFixed(2)),
    balance: Number(tx.balance.toFixed(2)),
  }));
}

/* =========================
   ROUTER
========================= */

function extractTransactionsBySubtype(text, subtype) {
  if (subtype === "standard_bank_statement") {
    return extractStandardBankTransactions(text);
  }

  return extractAbsaTransactions(text);
}

/* =========================
   ENTRY
========================= */

export async function extractBankStatement(context) {
  const {
    file,
    classification,
    extractedText = "",
    textPreview = "",
    extractionMeta = null,
  } = context;

  const subtype = classification.documentSubtype;
  const period = extractStatementPeriod(extractedText);
  const transactions = extractTransactionsBySubtype(extractedText, subtype);

  const openingBalance = extractOpeningBalance(extractedText);

  const closingBalance =
    extractClosingBalance(extractedText) ??
    (transactions.length
      ? Number(transactions[transactions.length - 1].balance.toFixed(2))
      : null);

  return {
    sourceFileName: file?.originalname || "unknown.pdf",
    detectedSubtype: subtype,
    rawTextPreview: textPreview,
    rawText: extractedText,
    extractionMeta,
    metadata: {
      bankName: subtype || "unknown",
      accountNumber: extractAccountNumber(extractedText),
      clientName: extractClientName(extractedText),
      statementPeriodStart: period.start,
      statementPeriodEnd: period.end,
      openingBalance,
      closingBalance,
    },
    transactions,
  };
}