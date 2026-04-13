/**
 * YouScan 2.0
 * Bank statement extractor (merged ABSA + Standard Bank)
 */

/* =========================
   FUNCTION: normalizeWhitespace
   PURPOSE: Collapse repeated whitespace and trim text.
========================= */
function normalizeWhitespace(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

/* =========================
   FUNCTION: parseMoney
   PURPOSE: Parse a standard numeric money string.
   NOTES:
   - Removes spaces and commas
   - Does NOT handle trailing minus format
========================= */
function parseMoney(value) {
  if (!value) return null;

  const cleaned = String(value)
    .replace(/\s+/g, "")
    .replace(/,/g, "");

  const number = Number(cleaned);
  return Number.isNaN(number) ? null : Number(number.toFixed(2));
}

/* =========================
   FUNCTION: parseSignedMoney
   PURPOSE: Parse money strings that may use trailing minus.
   EXAMPLES:
   - "2,681.42-" => -2681.42
   - "580.00"    => 580
========================= */
function parseSignedMoney(value) {
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

/* =========================
   FUNCTION: normalizeDateToken
   PURPOSE: Normalize dd/mm/yy, dd/mm/yyyy, ddmmyy, ROLddmmyy into dd/mm/yyyy.
========================= */
function normalizeDateToken(value) {
  const text = normalizeWhitespace(value || "");

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

  match = text.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})\b/);
  if (match) {
    const dd = String(match[1]).padStart(2, "0");
    const mm = String(match[2]).padStart(2, "0");
    let yyyy = String(match[3]);
    if (yyyy.length === 2) {
      const yy = Number(yyyy);
      yyyy = String(yy <= 49 ? 2000 + yy : 1900 + yy);
    }
    return `${dd}/${mm}/${yyyy}`;
  }

  return null;
}

/* =========================
   METADATA HELPERS
========================= */

/* =========================
   FUNCTION: extractAccountNumber
   PURPOSE: Extract account number from ABSA or Standard Bank text.
========================= */
function extractAccountNumber(text) {
  const patterns = [
    /account number[:\s]*([0-9][0-9\s]{6,30})/i,
    /acc(?:ount)?\s*(?:no|number)?[:\s]*([0-9][0-9\s]{6,30})/i,
    /account no[:\s]*([0-9][0-9\s]{6,30})/i,
    /cheque account[:\s]*([0-9][0-9\s]{6,30})/i,
    /Cheque Account Number:\s*([0-9][0-9\s-]{6,30})/i,
  ];

  for (const pattern of patterns) {
    const match = String(text || "").match(pattern);
    if (match) {
      const digits = match[1].replace(/\D/g, "");
      if (digits.length >= 6) return digits;
    }
  }

  return null;
}

/* =========================
   FUNCTION: extractClientName
   PURPOSE: Extract likely client/account holder name.
========================= */
function extractClientName(text) {
  const patterns = [
    /account holder[:\s]+([A-Z][A-Z\s'.&-]{3,80})/i,
    /customer name[:\s]+([A-Z][A-Z\s'.&-]{3,80})/i,
    /name[:\s]+([A-Z][A-Z\s'.&-]{3,80})/i,
    /\b(MR\.\s+[A-Z][A-Z\s'.&-]{2,80})\b/i,
    /\b(MRS\.\s+[A-Z][A-Z\s'.&-]{2,80})\b/i,
    /\b(MS\.\s+[A-Z][A-Z\s'.&-]{2,80})\b/i,
  ];

  for (const pattern of patterns) {
    const match = String(text || "").match(pattern);
    if (match) return normalizeWhitespace(match[1]);
  }

  return null;
}

/* =========================
   FUNCTION: extractBalanceByPatterns
   PURPOSE: Shared helper for opening/closing balance extraction.
========================= */
function extractBalanceByPatterns(text, patterns) {
  for (const pattern of patterns) {
    const match = String(text || "").match(pattern);
    if (match) {
      const value = parseSignedMoney(match[1]);
      if (value !== null) return value;
    }
  }

  return null;
}

/* =========================
   FUNCTION: extractOpeningBalance
   PURPOSE: Extract opening balance from statement text.
========================= */
function extractOpeningBalance(text) {
  return extractBalanceByPatterns(text, [
    /opening balance[:\s]+([0-9,\s.:-]+)/i,
    /balance brought forward[:\s]+([0-9,\s.:-]+)/i,
    /bal brought forward[:\s]+([0-9,\s.:-]+)/i,
    /BALANCE BROUGHT FORWARD\s+([0-9,\s.:-]+)/i,
  ]);
}

/* =========================
   FUNCTION: extractClosingBalance
   PURPOSE: Extract closing balance from statement text.
========================= */
function extractClosingBalance(text) {
  return extractBalanceByPatterns(text, [
    /closing balance[:\s]+([0-9,\s.:-]+)/i,
    /final balance[:\s]+([0-9,\s.:-]+)/i,
    /current balance[:\s]+([0-9,\s.:-]+)/i,
    /Month-end BalanceR?([0-9,\s.:-]+)/i,
    /Balance\s+([0-9,\s.:-]+)\s*$/im,
  ]);
}

/* =========================
   FUNCTION: extractStatementPeriod
   PURPOSE: Extract statement period from explicit date range text.
========================= */
function extractStatementPeriod(text) {
  const patterns = [
    /statement period[:\s]+([0-9]{1,2}[\/-][0-9]{1,2}[\/-][0-9]{2,4})\s+(?:to|-)\s+([0-9]{1,2}[\/-][0-9]{1,2}[\/-][0-9]{2,4})/i,
    /period[:\s]+([0-9]{1,2}[\/-][0-9]{1,2}[\/-][0-9]{2,4})\s+(?:to|-)\s+([0-9]{1,2}[\/-][0-9]{1,2}[\/-][0-9]{2,4})/i,
    /from[:\s]+([0-9]{1,2}[\/-][0-9]{1,2}[\/-][0-9]{2,4})\s+(?:to|-)\s+([0-9]{1,2}[\/-][0-9]{1,2}[\/-][0-9]{2,4})/i,
    /Statement from\s+([0-9]{1,2}\s+[A-Za-z]+\s+[0-9]{4})\s+to\s+([0-9]{1,2}\s+[A-Za-z]+\s+[0-9]{4})/i,
    /Your transactions\s*([0-9]{1,2}\s+[A-Za-z]{3}\s+[0-9]{4})\s*to\s*([0-9]{1,2}\s+[A-Za-z]{3}\s+[0-9]{4})/i,
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

  return {
    start: null,
    end: null,
  };
}

/* =========================
   COMMON HELPERS
========================= */

/* =========================
   FUNCTION: shouldSkipNoImpactRow
   PURPOSE: Skip ABSA no-impact rows after balance correction.
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

/* =========================
   FUNCTION: applyBalanceDrivenCorrection
   PURPOSE: Recalculate amount from balance movement where possible.
========================= */
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

/* =========================
   FUNCTION: looksLikeAbsaTransactionLine
   PURPOSE: Detect ABSA transaction lines beginning with a date.
========================= */
function looksLikeAbsaTransactionLine(line) {
  return /^\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?/.test(line.trim());
}

/* =========================
   FUNCTION: extractAbsaTransactions
   PURPOSE: Extract ABSA transactions.
   NOTE: Kept aligned with your existing ABSA logic.
========================= */
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

/* =========================
   FUNCTION: cleanStandardBankMoneyToken
   PURPOSE: Parse Standard Bank amount/balance tokens.
   NOTES:
   - Handles trailing minus sign
   - Removes spaces and commas
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

/* =========================
   FUNCTION: buildCombinedBalanceCandidate
   PURPOSE: Extract only the final balance token from the line.
   CRITICAL:
   - Prefers the final money-looking token
   - Removes leading day-column prefix like "12 " or "01 "
========================= */
function buildCombinedBalanceCandidate(line) {
  const raw = normalizeWhitespace(line);

  const matches = raw.match(/\d[\d\s,]*\.\d{2}-?/g);
  if (!matches || matches.length === 0) return null;

  let candidate = matches[matches.length - 1];
  candidate = candidate.replace(/^\d{1,2}\s+/, "");

  return candidate;
}

/* =========================
   FUNCTION: fixOcrBalance
   PURPOSE:
   Fix OCR-inserted extra digit in balances like:
   1211,382.94 -> 121,382.94
   1023,261.42 -> 023,261.42
   NOTE:
   - Conservative correction used only on suspicious 7+ digit whole parts
========================= */
function fixOcrBalance(balance) {
  if (balance == null || !Number.isFinite(balance)) return null;

  const sign = balance < 0 ? -1 : 1;
  const abs = Math.abs(balance);
  const asFixed = abs.toFixed(2);
  const [whole, decimal] = asFixed.split(".");

  if (whole.length >= 7) {
    const attempt = whole.slice(0, 2) + whole.slice(3);
    const fixed = Number(`${attempt}.${decimal}`);

    if (!Number.isNaN(fixed)) {
      return sign * fixed;
    }
  }

  return balance;
}

/* =========================
   FUNCTION: extractStandardBankMoneyPair
   PURPOSE: Extract amount + balance from a Standard Bank money line.
   CRITICAL:
   - First money token = amount
   - Balance prefers reconstructed end-of-line candidate when present
   - Falls back to last decimal token
========================= */
function extractStandardBankMoneyPair(line) {
  const raw = normalizeWhitespace(String(line || ""));
  if (!raw) return null;

  const amountMatch = raw.match(/^\D*(\d[\d,]*\.\d{2}-?)/);
  if (!amountMatch) return null;

  const amountRaw = amountMatch[1];
  const amount = cleanStandardBankMoneyToken(amountRaw);
  if (amount === null) return null;

  const combinedBalanceCandidate = buildCombinedBalanceCandidate(raw);

  let balance = null;

  if (combinedBalanceCandidate) {
    balance = cleanStandardBankMoneyToken(combinedBalanceCandidate);
  }

  if (balance === null) {
    const allMatches = raw.match(/\d[\d\s,]*\.\d{2}-?/g);
    if (!allMatches || allMatches.length < 2) return null;

    let fallbackBalanceRaw = allMatches[allMatches.length - 1];
    fallbackBalanceRaw = fallbackBalanceRaw.replace(/^\d{1,2}\s+/, "");
    balance = cleanStandardBankMoneyToken(fallbackBalanceRaw);
  }

  if (balance === null) return null;

  if (Math.abs(amount) > 1_000_000) return null;
  if (Math.abs(balance) > 100_000_000) return null;

  return {
    amount,
    balance: fixOcrBalance(balance),
  };
}

/* =========================
   FUNCTION: isStandardBankMarkerLine
   PURPOSE: Detect Standard Bank marker lines like "##".
========================= */
function isStandardBankMarkerLine(line) {
  const v = normalizeWhitespace(line);
  return v === "##";
}

/* =========================
   FUNCTION: isStandardBankHeaderOrNoise
   PURPOSE: Filter Standard Bank header/footer/noise lines.
========================= */
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

/* =========================
   FUNCTION: isStandardBankReferenceLine
   PURPOSE: Decide whether a line is likely a Standard Bank reference/detail line.
========================= */
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

/* =========================
   FUNCTION: parseStatementPeriodDate
   PURPOSE: Parse statement period endpoints into date parts.
========================= */
function parseStatementPeriodDate(value) {
  const text = normalizeWhitespace(value || "");
  if (!text) return null;

  let match = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (match) {
    return {
      dd: Number(match[1]),
      mm: Number(match[2]),
      yyyy: Number(match[3]),
    };
  }

  match = text.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (match) {
    const months = {
      jan: 1, january: 1,
      feb: 2, february: 2,
      mar: 3, march: 3,
      apr: 4, april: 4,
      may: 5,
      jun: 6, june: 6,
      jul: 7, july: 7,
      aug: 8, august: 8,
      sep: 9, sept: 9, september: 9,
      oct: 10, october: 10,
      nov: 11, november: 11,
      dec: 12, december: 12,
    };

    const mm = months[String(match[2]).toLowerCase()];
    if (!mm) return null;

    return {
      dd: Number(match[1]),
      mm,
      yyyy: Number(match[3]),
    };
  }

  return null;
}

/* =========================
   FUNCTION: isValidCalendarDateParts
   PURPOSE: Validate dd/mm/yyyy as a real calendar date.
========================= */
function isValidCalendarDateParts(dd, mm, yyyy) {
  if (
    !Number.isInteger(dd) ||
    !Number.isInteger(mm) ||
    !Number.isInteger(yyyy) ||
    dd < 1 || dd > 31 ||
    mm < 1 || mm > 12 ||
    yyyy < 2000 || yyyy > 2100
  ) {
    return false;
  }

  const date = new Date(Date.UTC(yyyy, mm - 1, dd));
  return (
    date.getUTCFullYear() === yyyy &&
    date.getUTCMonth() === mm - 1 &&
    date.getUTCDate() === dd
  );
}

/* =========================
   FUNCTION: formatDateParts
   PURPOSE: Convert date parts to dd/mm/yyyy.
========================= */
function formatDateParts(dd, mm, yyyy) {
  return `${String(dd).padStart(2, "0")}/${String(mm).padStart(2, "0")}/${yyyy}`;
}

/* =========================
   FUNCTION: datePartsToUtcMs
   PURPOSE: Convert date parts to UTC ms for comparisons.
========================= */
function datePartsToUtcMs(parts) {
  if (!parts) return null;
  return Date.UTC(parts.yyyy, parts.mm - 1, parts.dd);
}

/* =========================
   FUNCTION: buildStandardBankDateCandidates
   PURPOSE:
   Build possible dates from a 6-digit Standard Bank token.
   PREFERRED:
   - YYMMDD first
   FALLBACK:
   - DDMMYY only if valid
========================= */
function buildStandardBankDateCandidates(token) {
  if (!/^\d{6}$/.test(String(token || ""))) return [];

  const text = String(token);
  const candidates = [];

  // Preferred: YYMMDD
  const yy1 = Number(text.slice(0, 2));
  const mm1 = Number(text.slice(2, 4));
  const dd1 = Number(text.slice(4, 6));
  const yyyy1 = 2000 + yy1;

  if (isValidCalendarDateParts(dd1, mm1, yyyy1)) {
    candidates.push({
      dd: dd1,
      mm: mm1,
      yyyy: yyyy1,
      strategy: "yymmdd",
    });
  }

  // Fallback: DDMMYY
  const dd2 = Number(text.slice(0, 2));
  const mm2 = Number(text.slice(2, 4));
  const yy2 = Number(text.slice(4, 6));
  const yyyy2 = 2000 + yy2;

  if (isValidCalendarDateParts(dd2, mm2, yyyy2)) {
    candidates.push({
      dd: dd2,
      mm: mm2,
      yyyy: yyyy2,
      strategy: "ddmmyy",
    });
  }

  return candidates;
}

/* =========================
   FUNCTION: chooseBestStandardBankDateCandidate
   PURPOSE:
   Choose the best candidate date using the statement period.
   RULES:
   - Prefer dates inside the statement period
   - Prefer YYMMDD over DDMMYY when tied
   - If none fall inside, choose the closest to the period
========================= */
function chooseBestStandardBankDateCandidate(candidates, statementPeriod = null) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;

  const periodStart = parseStatementPeriodDate(statementPeriod?.start);
  const periodEnd = parseStatementPeriodDate(statementPeriod?.end);

  const startMs = datePartsToUtcMs(periodStart);
  const endMs = datePartsToUtcMs(periodEnd);

  const scored = candidates.map((candidate) => {
    const candidateMs = datePartsToUtcMs(candidate);

    let score = 0;

    if (startMs !== null && endMs !== null && candidateMs !== null) {
      if (candidateMs >= startMs && candidateMs <= endMs) {
        score += 1000;
      } else {
        const distanceToStart = Math.abs(candidateMs - startMs);
        const distanceToEnd = Math.abs(candidateMs - endMs);
        const nearestDistance = Math.min(distanceToStart, distanceToEnd);
        score -= nearestDistance / 86400000;
      }
    }

    if (candidate.strategy === "yymmdd") {
      score += 10;
    }

    return {
      ...candidate,
      score,
    };
  });

  scored.sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best) return null;

  return formatDateParts(best.dd, best.mm, best.yyyy);
}

/* =========================
   FUNCTION: extractStandardBankDate
   PURPOSE:
   Extract dd/mm/yyyy from Standard Bank reference text.
   IMPROVEMENT:
   - Handles ROL format
   - Handles embedded 6-digit dates
   - Prefers YYMMDD
   - Uses statement period as context
========================= */
function extractStandardBankDate(value, statementPeriod = null) {
  const text = normalizeWhitespace(value || "");
  if (!text) return null;

  const tokens = [];

  let match = text.match(/ROL(\d{6})/i);
  if (match) {
    tokens.push(match[1]);
  }

  match = text.match(/(\d{6})$/);
  if (match) {
    tokens.push(match[1]);
  }

  const allMatches = [...text.matchAll(/\b(\d{6})\b/g)];
  for (const item of allMatches) {
    tokens.push(item[1]);
  }

  const uniqueTokens = [...new Set(tokens)];
  if (uniqueTokens.length === 0) return null;

  const candidates = uniqueTokens.flatMap((token) =>
    buildStandardBankDateCandidates(token)
  );

  return chooseBestStandardBankDateCandidate(candidates, statementPeriod);
}

/* =========================
   FUNCTION: shouldSkipStandardBankBlock
   PURPOSE: Skip fee separator blocks that should not become transactions.
========================= */
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

/* =========================
   FUNCTION: shouldSkipStandardBankTransaction
   PURPOSE: Skip obviously corrupted Standard Bank transactions.
========================= */
function shouldSkipStandardBankTransaction(tx) {
  if (!tx) return true;

  if (typeof tx.amount !== "number" || typeof tx.balance !== "number") return true;

  if (Math.abs(tx.amount) > 5_000_000) return true;
  if (Math.abs(tx.balance) > 100_000_000) return true;

  return false;
}

/* =========================
   FUNCTION: extractStandardBankTransactions
   PURPOSE: Extract Standard Bank transactions using tightened block logic:
   - previous line = description
   - current line  = amount + balance
   - next line     = reference/detail only if it looks like a true reference
========================= */
function extractStandardBankTransactions(text, statementPeriod = null) {
  const lines = String(text)
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);

  const transactions = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const moneyPair = extractStandardBankMoneyPair(line);
    if (!moneyPair) continue;

    let description = "";
    let reference = "";

    const prev = lines[i - 1];
    if (
      prev &&
      !isStandardBankMarkerLine(prev) &&
      !isStandardBankHeaderOrNoise(prev) &&
      !extractStandardBankMoneyPair(prev)
    ) {
      description = prev;
    }

    const next = lines[i + 1];
    if (
      next &&
      isStandardBankReferenceLine(next) &&
      !extractStandardBankMoneyPair(next)
    ) {
      reference = next;
    }

    if (shouldSkipStandardBankBlock(description, reference)) {
      continue;
    }

    const mergedDescription = normalizeWhitespace(
      reference ? `${description} ${reference}` : description
    );

    const upper = mergedDescription.toUpperCase();

    if (upper.includes("RTD-NOT PROVIDED FOR")) continue;

    if (
      upper.includes("VAT SUMMARY") ||
      upper.includes("ACCOUNT SUMMARY") ||
      upper.includes("DETAILS OF AGREEMENT") ||
      upper.includes("THIS DOCUMENT CONSTITUTES A CREDIT NOTE") ||
      upper.includes("TOTAL VAT") ||
      upper.includes("FEE-UNPAID ITEM") ||
      upper.includes("UNPAID FEE") ||
      upper.includes("SERVICE CHARGE") ||
      upper.includes("OVERDRAFT SERVICE FEE") ||
      upper.includes("FIXED MONTHLY FEE")
    ) {
      continue;
    }

    const date =
      extractStandardBankDate(mergedDescription, statementPeriod) ||
      extractStandardBankDate(reference, statementPeriod) ||
      extractStandardBankDate(description, statementPeriod) ||
      null;

    const tx = {
      date,
      description: mergedDescription,
      amount: Number(moneyPair.amount.toFixed(2)),
      balance: Number(moneyPair.balance.toFixed(2)),
    };

    if (shouldSkipStandardBankTransaction(tx)) continue;

    transactions.push(tx);
  }

  return transactions;
}

/* =========================
   ROUTER
========================= */

/* =========================
   FUNCTION: extractTransactionsBySubtype
   PURPOSE: Route extraction to the correct bank-specific parser.
========================= */
function extractTransactionsBySubtype(text, subtype, statementPeriod = null) {
  if (subtype === "standard_bank_statement") {
    return extractStandardBankTransactions(text, statementPeriod);
  }

  return extractAbsaTransactions(text);
}

/* =========================
   ENTRY
========================= */

/* =========================
   FUNCTION: extractBankStatement
   PURPOSE: Main entry point for the bank statement extractor plugin.
   OUTPUT:
   - Preserves rawTextPreview
   - Preserves rawText
   - Preserves extractionMeta
   - Preserves metadata structure
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
  const transactions = extractTransactionsBySubtype(extractedText, subtype, period);

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