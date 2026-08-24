/**
 * YouScan V2
 * Capitec bank-statement transaction extractor.
 *
 * Supports both:
 * - the original deterministic Capitec fixtures
 * - real multi-page Capitec Main Account statements
 *
 * Real Capitec layout:
 *
 * Date | Description | Category | Money In | Money Out | Fee* | Balance
 *
 * Important:
 * - transaction history may continue across several PDF pages
 * - each page may repeat headers, VAT notes and footer text
 * - descriptions/categories may wrap across lines
 * - a transaction may contain an amount plus a separate fee
 * - running balances are authoritative evidence
 */

import { normalizeDateToken } from "../shared/dates.js";
import { parseMoney } from "../shared/money.js";
import { normalizeWhitespace } from "../shared/utils.js";

const ROW_DATE =
  /^(\d{1,2}[\/-]\d{1,2}[\/-]\d{4})(?=\s|[A-Za-z|¦│])/;

const MONEY_TOKEN =
  /(?:^|\s)(R?\s*-?(?:\d{1,3}(?:[ ,]\d{3})+|\d+)\.\d{2})\*?(?=\s|$)/gi;

function round2(value) {
  return Math.round(value * 100) / 100;
}

function parseCapitecMoney(value) {
  if (!value) {
    return null;
  }

  const raw = String(value)
    .replace(/^R\s*/i, "")
    .replace(/\s+/g, "")
    .trim();

  const parsed = parseMoney(
    raw.replace(/^-/, "")
  );

  if (parsed === null) {
    return null;
  }

  return raw.startsWith("-")
    ? -Math.abs(parsed)
    : parsed;
}

/**
 * Headers that may occur at the beginning of the transaction
 * section or be repeated on subsequent pages.
 */
function isRepeatedTableHeader(line = "") {
  const value = normalizeWhitespace(line);

  if (!value) {
    return false;
  }

  return (
    /^Transaction History$/i.test(value) ||
    /^Date\s+Description\b.*\bBalance\b/i.test(value)
  );
}

/**
 * Lines that terminate the currently active transaction row.
 *
 * This prevents statement totals, page furniture and summary
 * values from being attached to the preceding transaction.
 */
function isTransactionBoundary(line = "") {
  const value = normalizeWhitespace(line);

  if (!value) {
    return false;
  }

  return (
    /^\*+\s*Includes\b.*VAT/i.test(value) ||
    /^\*+$/i.test(value) ||
    /^24hr Client Care Centre\b/i.test(value) ||
    /^Capitec Bank is an authorised financial services\b/i.test(value) ||
    /^Capitec Bank Limited Reg\./i.test(value) ||
    /^Unique Document No\.:/i.test(value) ||
    /^Page\s+\d+\s+of\s+\d+$/i.test(value) ||
    /^Closing Balance\s*:/i.test(value) ||
    /^Summary of Fees\b/i.test(value) ||
    /^Fee Summary\b/i.test(value) ||
    /^Spending Summary\b/i.test(value) ||
    /^Money (?:In|Out) Summary\b/i.test(value)
  );
}

/**
 * Keep all source text after the first Transaction History heading.
 *
 * Do not stop at the first VAT/footer marker because real Capitec
 * statements can continue transaction history on later PDF pages.
 */
function isolateTransactionHistory(text = "") {
  const source = String(text || "");

  const startMatch = source.match(
    /Transaction History/i
  );

  if (!startMatch) {
    return "";
  }

  const start =
    (startMatch.index || 0) +
    startMatch[0].length;

  return source
    .slice(start)
    .trim();
}

/**
 * Reconstruct logical transaction rows.
 *
 * A dated line begins a new transaction. Subsequent non-boundary
 * lines are treated as wrapped description/category content until
 * another dated row or a page/summary boundary appears.
 */
function reconstructRows(text = "") {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim());

  const rows = [];
  let current = "";

  function flushCurrent() {
    if (!current) {
      return;
    }

    const normalized =
      normalizeWhitespace(current);

    if (normalized) {
      rows.push(normalized);
    }

    current = "";
  }

  for (const line of lines) {
    if (!line) {
      continue;
    }

    if (isTransactionBoundary(line)) {
      flushCurrent();
      continue;
    }

    if (isRepeatedTableHeader(line)) {
      continue;
    }

    if (ROW_DATE.test(line)) {
      flushCurrent();
      current = line;
      continue;
    }

    if (current) {
      current += ` ${line}`;
    }
  }

  flushCurrent();

  return rows;
}

function extractMoneyTokens(body = "") {
  const matches = [];

  /*
   * Real PDF extraction can preserve Capitec table-column
   * separators such as:
   *
   *   |   │   ¦
   *
   * Replace each separator with a single space. Because each
   * replacement is one character long, token indexes still
   * correspond to the original row and description slicing
   * remains safe.
   */
  const source = String(body || "")
    .replace(/[|¦│]/g, " ");

  MONEY_TOKEN.lastIndex = 0;

  let match;

  while (
    (match = MONEY_TOKEN.exec(source)) !== null
  ) {
    const raw = match[1];

    const parsed =
      parseCapitecMoney(raw);

    if (parsed === null) {
      continue;
    }

    const rawOffset =
      match[0].lastIndexOf(raw);

    const index =
      match.index +
      Math.max(0, rawOffset);

    matches.push({
      raw,
      value: parsed,
      index,
      end: index + raw.length,
    });
  }

  return matches;
}

function approximatelyEqual(left, right) {
  return (
    Math.abs(
      round2(left - right)
    ) <= 0.01
  );
}

function absoluteApproximatelyEqual(left, right) {
  return approximatelyEqual(
    Math.abs(left),
    Math.abs(right)
  );
}

/**
 * Determine which printed monetary token(s) represent the
 * transaction movement.
 *
 * Examples:
 *
 * Normal:
 *   -100.00   900.00
 *
 * Fee-bearing:
 *   -35.00   -1.00   33.87
 *
 * The running-balance delta is used as evidence to resolve
 * debit/credit signs and amount+fee combinations.
 *
 * If the printed values genuinely disagree with the balance
 * movement, the printed candidate is preserved so validation
 * can route the statement to Review Required.
 */
function resolveMovement({
  money,
  balance,
  previousBalance,
}) {
  if (
    !Array.isArray(money) ||
    money.length < 2
  ) {
    return {
      amount: null,
      descriptionEnd: null,
    };
  }

  const tokensBeforeBalance =
    money.slice(0, -1);

  if (tokensBeforeBalance.length === 0) {
    return {
      amount: null,
      descriptionEnd: null,
    };
  }

  const last =
    tokensBeforeBalance.at(-1);

  const secondLast =
    tokensBeforeBalance.length >= 2
      ? tokensBeforeBalance.at(-2)
      : null;

  const candidates = [];

  /*
   * Standard amount + balance layout.
   */
  candidates.push({
    value: last.value,
    descriptionEnd: last.index,
  });

  if (secondLast) {
    /*
     * Real Capitec amount + fee + balance.
     */
    candidates.push({
      value: round2(
        secondLast.value +
        last.value
      ),
      descriptionEnd:
        secondLast.index,
    });

    /*
     * Keep the preceding monetary token independently
     * for legacy/ambiguous layouts.
     */
    candidates.push({
      value: secondLast.value,
      descriptionEnd:
        secondLast.index,
    });
  }

  /*
   * No running-balance evidence available.
   */
  if (
    typeof balance !== "number" ||
    !Number.isFinite(balance) ||
    typeof previousBalance !== "number" ||
    !Number.isFinite(previousBalance)
  ) {
    const preferred =
      secondLast
        ? candidates[1]
        : candidates[0];

    return {
      amount: round2(
        preferred.value
      ),
      descriptionEnd:
        preferred.descriptionEnd,
    };
  }

  const delta =
    round2(
      balance -
      previousBalance
    );

  /*
   * Exact signed match.
   */
  for (const candidate of candidates) {
    if (
      approximatelyEqual(
        candidate.value,
        delta
      )
    ) {
      return {
        amount: delta,
        descriptionEnd:
          candidate.descriptionEnd,
      };
    }
  }

  /*
   * Same absolute value but ambiguous/missing sign.
   * Running balance determines debit/credit direction.
   */
  for (const candidate of candidates) {
    if (
      absoluteApproximatelyEqual(
        candidate.value,
        delta
      )
    ) {
      return {
        amount: delta,
        descriptionEnd:
          candidate.descriptionEnd,
      };
    }
  }

  /*
   * Genuine disagreement.
   *
   * Preserve the source candidate rather than silently
   * rewriting it. The validator can then surface
   * balance_continuity_mismatch / Review Required.
   */
  const preferred =
    secondLast
      ? candidates[1]
      : candidates[0];

  return {
    amount: round2(
      preferred.value
    ),
    descriptionEnd:
      preferred.descriptionEnd,
  };
}

function parseRow(
  row,
  previousBalance
) {
  const source =
    String(row || "");

  const dateMatch =
    source.match(ROW_DATE);

  if (!dateMatch) {
    return null;
  }

  const date =
    normalizeDateToken(
      dateMatch[1]
    );

  if (!date) {
    return null;
  }

  const body =
    source
      .slice(
        dateMatch[0].length
      )
      .replace(
        /^\s*[|¦│]\s*/,
        ""
      )
      .trim();

  const money =
    extractMoneyTokens(body);

  if (money.length === 0) {
    return null;
  }

  const balanceToken =
    money.at(-1);

  const balance =
    balanceToken.value;

  const movement =
    resolveMovement({
      money,
      balance,
      previousBalance,
    });

  const descriptionEnd =
    movement.descriptionEnd ??
    balanceToken.index;

  const description =
    normalizeWhitespace(
      body.slice(
        0,
        descriptionEnd
      )
    ) ||
    "Transaction";

  return {
    date,

    description,

    amount:
      typeof movement.amount === "number" &&
      Number.isFinite(movement.amount)
        ? round2(movement.amount)
        : null,

    balance:
      typeof balance === "number" &&
      Number.isFinite(balance)
        ? round2(balance)
        : null,
  };
}

/**
 * Extract Capitec transactions.
 *
 * The structure diagnostic deliberately logs only counts/lengths.
 * It does NOT log customer names, account numbers, descriptions,
 * monetary values or raw statement text.
 */
export function extractCapitecTransactions(
  text,
  openingBalance = null
) {
  const source = String(text || "");

  const transactionBlock =
    isolateTransactionHistory(source);

  const slashDateCount =
    (
      source.match(
        /\b\d{1,2}\/\d{1,2}\/\d{4}\b/g
      ) || []
    ).length;

  const dashDateCount =
    (
      source.match(
        /\b\d{1,2}-\d{1,2}-\d{4}\b/g
      ) || []
    ).length;

  const lineStartingDateCount =
    source
      .split(/\r?\n/)
      .filter((line) =>
        ROW_DATE.test(
          line.trim()
        )
      ).length;

  const transactionHistoryCount =
    (
      source.match(
        /Transaction History/gi
      ) || []
    ).length;

  const moneyLikeTokenCount =
    (
      source.match(
        /R?\s*-?(?:\d{1,3}(?:[ ,]\d{3})+|\d+)\.\d{2}/g
      ) || []
    ).length;

  if (!transactionBlock) {
    console.info(
      "V2 CAPITEC STRUCTURE:",
      JSON.stringify({
        textLength:
          source.length,

        transactionHistoryCount,

        transactionHistoryFound:
          false,

        transactionBlockLength:
          0,

        slashDateCount,

        dashDateCount,

        lineStartingDateCount,

        moneyLikeTokenCount,

        reconstructedRowCount:
          0,

        parsedTransactionCount:
          0,
      })
    );

    return [];
  }

  const rows =
    reconstructRows(
      transactionBlock
    );

  const transactions = [];

  let previousBalance =
    typeof openingBalance === "number" &&
    Number.isFinite(openingBalance)
      ? round2(openingBalance)
      : null;

  for (const row of rows) {
    const tx =
      parseRow(
        row,
        previousBalance
      );

    if (
      !tx ||
      typeof tx.amount !== "number"
    ) {
      continue;
    }

    transactions.push(tx);

    if (
      typeof tx.balance === "number" &&
      Number.isFinite(tx.balance)
    ) {
      previousBalance =
        tx.balance;
    }
  }

  console.info(
    "V2 CAPITEC STRUCTURE:",
    JSON.stringify({
      textLength:
        source.length,

      transactionHistoryCount,

      transactionHistoryFound:
        true,

      transactionBlockLength:
        transactionBlock.length,

      slashDateCount,

      dashDateCount,

      lineStartingDateCount,

      moneyLikeTokenCount,

      reconstructedRowCount:
        rows.length,

      parsedTransactionCount:
        transactions.length,
    })
  );

  return transactions;
}