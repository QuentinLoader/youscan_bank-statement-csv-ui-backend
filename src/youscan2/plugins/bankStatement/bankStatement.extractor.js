/**
 * YouScan 2.0
 * Bank statement extractor
 */

function normalizeWhitespace(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function extractAccountNumber(text) {
  const patterns = [
    /account number[:\s]+([0-9]{6,20})/i,
    /acc(?:ount)?\s*(?:no|number)?[:\s]+([0-9]{6,20})/i,
    /cheque account[:\s]+([0-9]{6,20})/i,
    /account[:\s]+([0-9]{6,20})/i,
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

function parseMoney(value) {
  if (!value) return null;

  const cleaned = String(value)
    .replace(/\s+/g, "")
    .replace(/,/g, "");

  const number = Number(cleaned);
  return Number.isNaN(number) ? null : number;
}

function extractBalanceByPatterns(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const value = parseMoney(match[1]);
      if (value !== null) return Number(value.toFixed(2));
    }
  }

  return null;
}

function extractOpeningBalance(text) {
  return extractBalanceByPatterns(text, [
    /opening balance[:\s]+(-?[0-9,]+\.[0-9]{2})/i,
    /balance brought forward[:\s]+(-?[0-9,]+\.[0-9]{2})/i,
    /bal brought forward[:\s]+(-?[0-9,]+\.[0-9]{2})/i,
  ]);
}

function extractClosingBalance(text) {
  return extractBalanceByPatterns(text, [
    /closing balance[:\s]+(-?[0-9,]+\.[0-9]{2})/i,
    /final balance[:\s]+(-?[0-9,]+\.[0-9]{2})/i,
    /current balance[:\s]+(-?[0-9,]+\.[0-9]{2})/i,
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

function looksLikeTransactionLine(line) {
  return /^\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?/.test(line.trim());
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

function extractTransactions(text) {
  const lines = String(text)
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  const transactions = [];

  for (const line of lines) {
    if (!looksLikeTransactionLine(line)) continue;

    const dateMatch = line.match(/^(\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?)/);
    if (!dateMatch) continue;

    const date = dateMatch[1];
    const rest = line.slice(date.length).trim();

    const moneyMatches = [...rest.matchAll(/-?\d[\d,]*\.\d{2}/g)].map(m => ({
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

    if (transactions.length > 0) {
      const prev = transactions[transactions.length - 1];

      if (
        typeof prev.balance === "number" &&
        typeof balance === "number"
      ) {
        const diff = Number((balance - prev.balance).toFixed(2));

        if (diff !== 0) {
          amount = diff;
        }

        if (shouldSkipNoImpactRow(description, amount, balance, prev.balance)) {
          continue;
        }
      }
    }

    if (amount === 0) continue;

    transactions.push({
      date,
      description,
      amount: Number(amount.toFixed(2)),
      balance: Number(balance.toFixed(2)),
    });
  }

  return transactions;
}

export async function extractBankStatement(context) {
  const {
    file,
    classification,
    extractedText = "",
    textPreview = "",
    extractionMeta = null,
  } = context;

  const period = extractStatementPeriod(extractedText);
  const transactions = extractTransactions(extractedText);

  const openingBalance = extractOpeningBalance(extractedText);

  const closingBalance =
    extractClosingBalance(extractedText) ??
    (transactions.length
      ? Number(transactions[transactions.length - 1].balance.toFixed(2))
      : null);

  return {
    sourceFileName: file?.originalname || "unknown.pdf",
    detectedSubtype: classification.documentSubtype,
    rawTextPreview: textPreview,
    rawText: extractedText,
    extractionMeta,
    metadata: {
      bankName: classification.documentSubtype || "unknown",
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