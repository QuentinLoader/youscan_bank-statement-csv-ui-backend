import { normalizeWhitespace } from "../shared/utils.js";
import {
  cleanStandardBankMoneyToken,
  parseStandardBankBalanceToken,
} from "../shared/money.js";
import { extractStandardBankDate } from "../shared/dates.js";

function round2(value) {
  return Number(Number(value).toFixed(2));
}

function extractStandardBankMoneyTokens(line) {
  const raw = normalizeWhitespace(String(line || ""));
  if (!raw) return [];

  return raw.match(/\d[\d\s,]*\.\d{2}-?/g) || [];
}

function extractStandardBankMoneyPair(line) {
  const tokens = extractStandardBankMoneyTokens(line);

  // Standard Bank transaction rows must contain both a transaction amount
  // and a running balance. This prevents opening/closing balance metadata
  // rows from being misclassified as transactions.
  if (tokens.length < 2) return null;

  const amount = cleanStandardBankMoneyToken(tokens[0]);
  const balance = parseStandardBankBalanceToken(tokens[tokens.length - 1]);

  if (amount === null || balance === null) return null;
  if (Math.abs(amount) > 5_000_000) return null;
  if (Math.abs(balance) > 100_000_000) return null;

  return {
    amount: round2(amount),
    balance: round2(balance),
  };
}

function isStandardBankMarkerLine(line) {
  return normalizeWhitespace(line) === "##";
}

function isStandardBankReversalMarker(line) {
  return normalizeWhitespace(line)
    .toUpperCase()
    .includes("RTD-NOT PROVIDED FOR");
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
    v.startsWith("balance brought forward") ||
    v.startsWith("month-end balance") ||
    v.startsWith("page ") ||
    v.startsWith("account number") ||
    v.startsWith("statement from") ||
    v.includes("customer care centre") ||
    v.includes("statement / invoice") ||
    v.includes("bank statement / tax invoice") ||
    v.includes("standard bank of south africa") ||
    v.includes("the ombudsman for banking services") ||
    v.includes("registered credit provider") ||
    v.includes("please verify all transactions") ||
    v.includes("please visit our website") ||
    v.includes("vat reg no") ||
    v.includes("monthly email")
  );
}

function isCompactStandardBankReferenceLine(line) {
  const v = normalizeWhitespace(line);
  if (!v || v.length > 80) return false;

  return (
    /^\d{6}$/i.test(v) ||
    /^ROL\d{6}$/i.test(v) ||
    /^(?:SBSA|VODACOM|LENDPLUS|AUTOPAY|MBD)(?:\s+[A-Z0-9./-]+){0,4}$/i.test(v) ||
    /^SF\d+(?:\s+[A-Z0-9./-]+){0,3}$/i.test(v)
  );
}

function findPreviousDescription(lines, startIndex) {
  for (let i = startIndex; i >= 0 && i >= startIndex - 3; i--) {
    const candidate = lines[i];
    if (!candidate) continue;
    if (isStandardBankMarkerLine(candidate)) continue;
    if (isStandardBankHeaderOrNoise(candidate)) continue;
    if (isStandardBankReversalMarker(candidate)) continue;
    if (isCompactStandardBankReferenceLine(candidate)) continue;
    if (extractStandardBankMoneyPair(candidate)) continue;
    return candidate;
  }

  return "";
}

function findNextDescription(lines, startIndex) {
  for (
    let i = startIndex;
    i < lines.length && i <= startIndex + 3;
    i++
  ) {
    const candidate = lines[i];

    if (!candidate) continue;

    // Do not cross into the next monetary transaction row.
    if (extractStandardBankMoneyPair(candidate)) break;

    if (isStandardBankMarkerLine(candidate)) continue;
    if (isStandardBankHeaderOrNoise(candidate)) continue;
    if (isStandardBankReversalMarker(candidate)) continue;
    if (isCompactStandardBankReferenceLine(candidate)) continue;

    return candidate;
  }

  return "";
}
function getStandardBankTransactionContext(lines, moneyLineIndex) {
  const previous = lines[moneyLineIndex - 1] || "";
  let description = "";
  let reference = "";

  if (isCompactStandardBankReferenceLine(previous)) {
    reference = previous;
    description = findPreviousDescription(lines, moneyLineIndex - 2);
  } else if (isStandardBankMarkerLine(previous)) {
    description = findPreviousDescription(lines, moneyLineIndex - 2);
  } else if (
    !isStandardBankHeaderOrNoise(previous) &&
    !isStandardBankReversalMarker(previous) &&
    !extractStandardBankMoneyPair(previous)
  ) {
    description = previous;
  }

  if (!reference) {
    const next = lines[moneyLineIndex + 1] || "";
    if (isCompactStandardBankReferenceLine(next)) {
      reference = next;
    }
  }

  const forwardDescription = findNextDescription(
    lines,
    moneyLineIndex + 1
  );

  const normalizedBackwardDescription =
    normalizeWhitespace(description).toUpperCase();

  const backwardLooksLikeStaleUnpaidMarker =
    normalizedBackwardDescription === "FEE-UNPAID ITEM" ||
    normalizedBackwardDescription === "UNPAID FEE DEBICHECK D/O";

  if (
    !description ||
    (backwardLooksLikeStaleUnpaidMarker && forwardDescription)
  ) {
    description = forwardDescription || description;
  }

  return { description, reference };
}

function shouldSkipStandardBankBlock(description, reference) {
  const desc = normalizeWhitespace(description).toLowerCase();
  const ref = normalizeWhitespace(reference).toLowerCase();

  if (!desc) return true;
  if (desc === "##") return true;
  if (desc.includes("these fees include vat")) return true;
  if (ref === "##") return true;

  return false;
}

function shouldSkipStandardBankTransaction(tx) {
  if (!tx) return true;

  if (typeof tx.amount !== "number" || !Number.isFinite(tx.amount)) return true;
  if (typeof tx.balance !== "number" || !Number.isFinite(tx.balance)) return true;
  if (Math.abs(tx.amount) > 5_000_000) return true;
  if (Math.abs(tx.balance) > 100_000_000) return true;

  return false;
}

function isStandardBankReversedTransaction(lines, i) {
  const next = lines[i + 1];
  const next2 = lines[i + 2];

  if (
    next &&
    isCompactStandardBankReferenceLine(next) &&
    next2 &&
    isStandardBankReversalMarker(next2)
  ) {
    return true;
  }

  if (next && isStandardBankReversalMarker(next)) {
    return true;
  }

  return false;
}

function deriveStartingBalance(transactions) {
  if (!Array.isArray(transactions) || transactions.length === 0) return null;

  const first = transactions[0];
  if (
    typeof first?.amount !== "number" ||
    !Number.isFinite(first.amount) ||
    typeof first?.balance !== "number" ||
    !Number.isFinite(first.balance)
  ) {
    return null;
  }

  return round2(first.balance - first.amount);
}

function applyBalanceBasedSigns(transactions, openingBalance = null) {
  if (!Array.isArray(transactions) || transactions.length === 0) return [];

  let previousBalance =
    typeof openingBalance === "number" && Number.isFinite(openingBalance)
      ? round2(openingBalance)
      : null;

  return transactions.map((transaction) => {
    const tx = { ...transaction };

    if (
      previousBalance !== null &&
      typeof tx.amount === "number" &&
      Number.isFinite(tx.amount) &&
      typeof tx.balance === "number" &&
      Number.isFinite(tx.balance)
    ) {
      const observedDelta = round2(tx.balance - previousBalance);

      // A statement's running balance is stronger evidence of debit/credit
      // direction than OCR column collapse. Only change the sign when the
      // absolute transaction amount and observed balance movement agree.
      if (Math.abs(Math.abs(observedDelta) - Math.abs(tx.amount)) <= 0.01) {
        tx.amount = observedDelta;
      }
    }

    if (typeof tx.balance === "number" && Number.isFinite(tx.balance)) {
      previousBalance = round2(tx.balance);
    }

    return tx;
  });
}

function carryForwardDates(transactions) {
  if (!Array.isArray(transactions) || transactions.length === 0) return [];

  let lastKnownDate = null;

  return transactions.map((tx) => {
    const next = { ...tx };

    if (next.date) {
      lastKnownDate = next.date;
      return next;
    }

    if (lastKnownDate) {
      next.date = lastKnownDate;
    }

    return next;
  });
}

export function deriveStandardBankOpeningBalanceFromFirstTransaction(transactions) {
  return deriveStartingBalance(transactions);
}

export function extractStandardBankTransactions(
  text,
  statementPeriod = null,
  openingBalance = null
) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);

  const transactions = [];

  const monthNumbers = {
    jan: 1,
    january: 1,
    feb: 2,
    february: 2,
    mar: 3,
    march: 3,
    apr: 4,
    april: 4,
    may: 5,
    jun: 6,
    june: 6,
    jul: 7,
    july: 7,
    aug: 8,
    august: 8,
    sep: 9,
    sept: 9,
    september: 9,
    oct: 10,
    october: 10,
    nov: 11,
    november: 11,
    dec: 12,
    december: 12,
  };

  function parsePeriodPoint(value) {
    const source =
      normalizeWhitespace(value || "");

    const match = source.match(
      /\\b\\d{1,2}\\s+([A-Za-z]+)\\s+(\\d{4})\\b/
    );

    if (!match) return null;

    const month =
      monthNumbers[match[1].toLowerCase()];

    const year =
      Number(match[2]);

    if (
      !month ||
      !Number.isInteger(year)
    ) {
      return null;
    }

    return {
      month,
      year,
    };
  }

  const periodStart =
    parsePeriodPoint(statementPeriod?.start);

  const periodEnd =
    parsePeriodPoint(statementPeriod?.end);

  function resolveInlineDate(
    monthValue,
    dayValue
  ) {
    const month =
      Number(monthValue);

    const day =
      Number(dayValue);

    if (
      !Number.isInteger(month) ||
      !Number.isInteger(day) ||
      month < 1 ||
      month > 12 ||
      day < 1 ||
      day > 31
    ) {
      return null;
    }

    let year =
      periodEnd?.year ??
      periodStart?.year ??
      null;

    if (
      periodStart &&
      periodEnd &&
      periodStart.year !== periodEnd.year
    ) {
      year =
        month >= periodStart.month
          ? periodStart.year
          : periodEnd.year;
    }

    if (!year) return null;

    const date =
      new Date(
        Date.UTC(
          year,
          month - 1,
          day
        )
      );

    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      return null;
    }

    return (
      String(day).padStart(2, "0") +
      "/" +
      String(month).padStart(2, "0") +
      "/" +
      year
    );
  }

  /*
   * Native Standard Bank layout:
   *
   * DESCRIPTION  AMOUNT  MM DD  BALANCE
   *
   * Both debits and credits are financial transactions.
   * RTD-NOT PROVIDED FOR is therefore retained when it
   * appears as its own monetary row.
   */
  const nativeRow =
    /^(.+?)\s+([0-9][0-9 ,]*\.\d{2}-?)\s+(\d{1,2})\s+(\d{1,2})\s+([0-9][0-9 ,]*\.\d{2}-?)$/;

  for (let i = 0; i < lines.length; i++) {
    const nativeMatch =
      lines[i].match(nativeRow);

    if (nativeMatch) {
      const description =
        normalizeWhitespace(nativeMatch[1]);

      if (
        isStandardBankHeaderOrNoise(description)
      ) {
        continue;
      }

      const next =
        lines[i + 1] || "";

      const reference =
        isCompactStandardBankReferenceLine(next)
          ? next
          : "";

      const mergedDescription =
        normalizeWhitespace(
          reference
            ? `${description} ${reference}`
            : description
        );

      const upper =
        mergedDescription.toUpperCase();

      if (
        upper.includes("VAT SUMMARY") ||
        upper.includes("ACCOUNT SUMMARY") ||
        upper.includes("DETAILS OF AGREEMENT") ||
        upper.includes(
          "THIS DOCUMENT CONSTITUTES A CREDIT NOTE"
        ) ||
        upper.includes("TOTAL VAT")
      ) {
        continue;
      }

      const date =
        resolveInlineDate(
          nativeMatch[3],
          nativeMatch[4]
        ) ||
        extractStandardBankDate(
          reference,
          statementPeriod
        ) ||
        null;

      const nativeAmount =
        cleanStandardBankMoneyToken(
          nativeMatch[2]
        );

      const nativeBalance =
        parseStandardBankBalanceToken(
          nativeMatch[5]
        );

      if (
        !Number.isFinite(nativeAmount) ||
        !Number.isFinite(nativeBalance)
      ) {
        continue;
      }

      const tx = {
        date,
        description:
          mergedDescription,
        amount:
          round2(nativeAmount),
        balance:
          round2(nativeBalance),
      };

      if (
        shouldSkipStandardBankTransaction(tx)
      ) {
        continue;
      }

      transactions.push(tx);
      continue;
    }

    /*
     * Fallback for older/synthetic Standard Bank formats.
     * Existing behaviour is retained here.
     */
    const moneyPair =
      extractStandardBankMoneyPair(lines[i]);

    if (!moneyPair) continue;
    const {
      description,
      reference,
    } =
      getStandardBankTransactionContext(
        lines,
        i
      );

    if (
      shouldSkipStandardBankBlock(
        description,
        reference
      )
    ) {
      continue;
    }

    const mergedDescription =
      normalizeWhitespace(
        reference
          ? `${description} ${reference}`
          : description
      );

    const upper =
      mergedDescription.toUpperCase();

    if (
      upper.includes(
        "RTD-NOT PROVIDED FOR"
      )
    ) {
      continue;
    }

    if (
      upper.includes("VAT SUMMARY") ||
      upper.includes("ACCOUNT SUMMARY") ||
      upper.includes("DETAILS OF AGREEMENT") ||
      upper.includes(
        "THIS DOCUMENT CONSTITUTES A CREDIT NOTE"
      ) ||
      upper.includes("TOTAL VAT")
    ) {
      continue;
    }

    const date =
      extractStandardBankDate(
        reference,
        statementPeriod
      ) ||
      extractStandardBankDate(
        description,
        statementPeriod
      ) ||
      extractStandardBankDate(
        mergedDescription,
        statementPeriod
      ) ||
      null;

    const tx = {
      date,
      description:
        mergedDescription,
      amount:
        round2(moneyPair.amount),
      balance:
        round2(moneyPair.balance),
    };

    if (
      shouldSkipStandardBankTransaction(tx)
    ) {
      continue;
    }

    transactions.push(tx);
  }

  return carryForwardDates(
    applyBalanceBasedSigns(
      transactions,
      openingBalance
    )
  );
}



