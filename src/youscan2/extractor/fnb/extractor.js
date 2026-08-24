/**
 * YouScan V2
 * FNB bank-statement transaction extractor.
 *
 * Supports:
 * - normal digitally-generated FNB statement text
 * - scanned/OCR FNB statement text
 * - Gold Business Account transaction tables
 * - optional Accrued Bank Charges column
 *
 * The extractor preserves observed running balances and uses those balances
 * as the primary evidence for transaction direction when Cr/Dr is absent.
 */

import {
  datePartsToUtcMs,
  formatDateParts,
  isValidCalendarDateParts,
  parseStatementPeriodDate,
} from "../shared/dates.js";

import { parseMoney } from "../shared/money.js";
import { normalizeWhitespace } from "../shared/utils.js";

const MONTHS = Object.freeze({
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
});

const DATE_TOKEN =
  /\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/gi;

/*
 * Normal:
 *   1,234.56
 *
 * pdf-parse / OCR sometimes introduces a space before the decimal:
 *   86,044 .37
 *
 * normalizeOcrArtifacts() repairs that before this expression is applied.
 */
const MONEY_TOKEN =
  "(?:\\d{1,3}(?:[ ,]\\d{3})+|\\d+)\\.\\d{2}";

/*
 * FNB statement layouts may arrive as:
 *
 *   455.00 7,963.95Cr
 *
 * or scanned/vision text:
 *
 *   455.00 | 7,963.95Cr | 28.40
 *
 * or concatenated:
 *
 *   455.007,963.95Cr
 *
 * The optional pipe is deliberately only between Amount and Balance.
 * A third value after Balance is the Accrued Bank Charges column and is
 * intentionally not consumed as part of the transaction itself.
 */
const MONEY_PAIR = new RegExp(
  `(?<!\\d)` +
    `(${MONEY_TOKEN})` +
    `\\s*(Cr|Dr)?` +
    `\\s*(?:[|│¦]\\s*)?` +
    `(${MONEY_TOKEN})` +
    `\\s*(Cr|Dr)?`,
  "i"
);

function round2(value) {
  return Math.round(value * 100) / 100;
}

function applyCrDr(value, marker) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value)
  ) {
    return null;
  }

  const sign = String(
    marker || ""
  ).toLowerCase();

  if (sign === "dr") {
    return -Math.abs(value);
  }

  if (sign === "cr") {
    return Math.abs(value);
  }

  return value;
}

/*
 * Conservative OCR cleanup.
 *
 * We only repair patterns that are extremely unlikely to represent a
 * legitimate alternative financial value.
 */
function normalizeOcrArtifacts(value = "") {
  return String(value || "")
    /*
     * 86,044 .37Cr -> 86,044.37Cr
     */
    .replace(
      /(\d{1,3}(?:[ ,]\d{3})+)\s+\.(\d{2})(?=\s*(?:Cr|Dr)?\b)/gi,
      "$1.$2"
    )

    /*
     * Typical OCR artefacts directly after Cr/Dr:
     *
     * 7,963.95Cr]
     * 2,700.32Cr'
     */
    .replace(
      /\b(Cr|Dr)[\]}'’"`]+/gi,
      "$1"
    )

    /*
     * Normalize visual table separators without removing them completely.
     */
    .replace(/[│¦]/g, "|");
}

function cleanTransactionBlock(text = "") {
  const source =
    normalizeOcrArtifacts(text);

  const startMatch =
    source.match(
      /Transactions\s+in\s+RAND/i
    );

  if (!startMatch) {
    return "";
  }

  const start =
    (startMatch.index || 0) +
    startMatch[0].length;

  const remainder =
    source.slice(start);

  const closingMatch =
    remainder.match(
      /Closing\s+Balance/i
    );

  const block = closingMatch
    ? remainder.slice(
        0,
        closingMatch.index
      )
    : remainder;

  return block
    .replace(
      /Page\s+\d+\s+of\s+\d+/gi,
      " "
    )

    /*
     * Standard FNB header.
     */
    .replace(
      /\bDate\s+Description\s+Amount\s+Balance\b/gi,
      " "
    )

    /*
     * Gold Business Account / OCR header.
     */
    .replace(
      /\bDate\s+Description\s+Amount\s+Balance\s+Accrued\s+Bank\s+Charges\b/gi,
      " "
    )

    /*
     * Some OCR engines place "Accrued" before the rest of the header.
     */
    .replace(
      /\bAccrued\s+Date\s+Description\s+Amount\s+Balance(?:\s+Bank\s+Charges)?\b/gi,
      " "
    )

    .replace(
      /\bDate\s+Transaction\s+Description\b/gi,
      " "
    )

    /*
     * Keep pipe separators because parseSegment() knows how to tolerate
     * them, but normalize surrounding whitespace.
     */
    .replace(/\s*\|\s*/g, " | ")

    .replace(/\s+/g, " ")
    .trim();
}

function resolveTransactionYear(
  day,
  month,
  period = null
) {
  const start =
    parseStatementPeriodDate(
      period?.start
    );

  const end =
    parseStatementPeriodDate(
      period?.end
    );

  const possibleYears = [
    ...new Set(
      [
        start?.yyyy,
        end?.yyyy,
      ].filter(Boolean)
    ),
  ];

  if (
    possibleYears.length === 0
  ) {
    possibleYears.push(
      new Date().getUTCFullYear()
    );
  }

  const startMs =
    datePartsToUtcMs(start);

  const endMs =
    datePartsToUtcMs(end);

  const candidates =
    possibleYears
      .filter((year) =>
        isValidCalendarDateParts(
          day,
          month,
          year
        )
      )
      .map((year) => ({
        day,
        month,
        year,
        ms: Date.UTC(
          year,
          month - 1,
          day
        ),
      }));

  if (
    startMs !== null &&
    endMs !== null
  ) {
    const inPeriod =
      candidates.find(
        (candidate) =>
          candidate.ms >= startMs &&
          candidate.ms <= endMs
      );

    if (inPeriod) {
      return inPeriod.year;
    }
  }

  if (
    end?.yyyy &&
    isValidCalendarDateParts(
      day,
      month,
      end.yyyy
    )
  ) {
    return end.yyyy;
  }

  return (
    candidates[0]?.year ||
    new Date().getUTCFullYear()
  );
}

function buildDate(
  dayText,
  monthText,
  period
) {
  const day =
    Number(dayText);

  const month =
    MONTHS[
      String(
        monthText || ""
      ).toLowerCase()
    ];

  if (!month) {
    return null;
  }

  const year =
    resolveTransactionYear(
      day,
      month,
      period
    );

  if (
    !isValidCalendarDateParts(
      day,
      month,
      year
    )
  ) {
    return null;
  }

  return formatDateParts(
    day,
    month,
    year
  );
}

function isFnbInformationalEntry(
  description = ""
) {
  const lower =
    String(
      description || ""
    ).toLowerCase();

  const informationalSignals = [
    "schd trxn no av bal",
    "balalert weekly",
    "predet limit alert",
  ];

  return informationalSignals.some(
    (signal) =>
      lower.includes(signal)
  );
}

function cleanDescription(
  value = ""
) {
  return normalizeWhitespace(
    String(value || "")
      .replace(
        /^\s*[|│¦]\s*/,
        ""
      )
      .replace(
        /\s*[|│¦]\s*$/,
        ""
      )
  );
}

function parseSegment(
  segment,
  dateMatch,
  period,
  previousBalance
) {
  const normalizedSegment =
    normalizeOcrArtifacts(
      segment
    );

  const afterDate =
    normalizedSegment
      .slice(
        dateMatch[0].length
      )
      .trim();

  const pair =
    afterDate.match(
      MONEY_PAIR
    );

  if (!pair) {
    return null;
  }

  const amountMagnitude =
    parseMoney(pair[1]);

  const amountMarker =
    pair[2] || null;

  const observedBalanceMagnitude =
    parseMoney(pair[3]);

  const balanceMarker =
    pair[4] || null;

  if (
    amountMagnitude === null ||
    observedBalanceMagnitude === null
  ) {
    return null;
  }

  const balance =
    applyCrDr(
      observedBalanceMagnitude,
      balanceMarker
    );

  if (balance === null) {
    return null;
  }

  let amount = null;

  /*
   * Explicit Cr/Dr on the amount is authoritative.
   */
  if (amountMarker) {
    amount =
      applyCrDr(
        amountMagnitude,
        amountMarker
      );
  } else if (
    typeof previousBalance ===
      "number" &&
    Number.isFinite(
      previousBalance
    )
  ) {
    /*
     * FNB frequently prints debit amounts without "Dr".
     * Use the observed running-balance movement rather than guessing from
     * the transaction description.
     *
     * Accrued Bank Charges are deliberately ignored here because the
     * statement's displayed running balance already reflects the bank's
     * authoritative transaction movement.
     */
    amount =
      round2(
        balance -
          previousBalance
      );
  } else {
    amount =
      amountMagnitude;
  }

  const description =
    cleanDescription(
      afterDate.slice(
        0,
        pair.index
      )
    );

  const date =
    buildDate(
      dateMatch[1],
      dateMatch[2],
      period
    );

  if (!date) {
    return null;
  }

  return {
    date,
    description:
      description ||
      "Transaction",
    amount:
      typeof amount ===
        "number"
        ? round2(amount)
        : null,
    balance:
      round2(balance),
  };
}

export function extractFnbTransactions(
  text,
  period = null,
  openingBalance = null
) {
  const block =
    cleanTransactionBlock(text);

  if (!block) {
    return [];
  }

  const dateMatches = [
    ...block.matchAll(
      DATE_TOKEN
    ),
  ];

  if (
    dateMatches.length === 0
  ) {
    return [];
  }

  const transactions = [];

  let previousBalance =
    typeof openingBalance ===
      "number" &&
    Number.isFinite(
      openingBalance
    )
      ? openingBalance
      : null;

  for (
    let i = 0;
    i < dateMatches.length;
    i++
  ) {
    const current =
      dateMatches[i];

    const next =
      dateMatches[i + 1];

    const start =
      current.index || 0;

    const end =
      next?.index ??
      block.length;

    const segment =
      block
        .slice(start, end)
        .trim();

    const parsed =
      parseSegment(
        segment,
        current,
        period,
        previousBalance
      );

    if (!parsed) {
      continue;
    }

    if (
      isFnbInformationalEntry(
        parsed.description
      )
    ) {
      continue;
    }

    transactions.push(
      parsed
    );

    previousBalance =
      parsed.balance;
  }

  /*
   * Privacy-safe operational diagnostic.
   * No statement text, values, descriptions or account data are logged.
   */
  if (
    transactions.length === 0 &&
    dateMatches.length > 0
  ) {
    console.warn(
      "V2 FNB extraction produced no transactions",
      {
        dateCandidates:
          dateMatches.length,
      }
    );
  }

  return transactions;
}