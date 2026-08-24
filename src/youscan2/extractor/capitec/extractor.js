/**
 * YouScan V2
 * Capitec bank-statement transaction extractor.
 *
 * Supports:
 * - deterministic Capitec fixtures
 * - real multi-page Capitec Main Account statements
 * - pipe/column-separated PDF text
 * - PDF text with fused monetary columns
 *
 * Real Capitec layout:
 *
 * Date | Description | Category | Money In | Money Out | Fee* | Balance
 */

import { normalizeDateToken } from "../shared/dates.js";
import { parseMoney } from "../shared/money.js";
import { normalizeWhitespace } from "../shared/utils.js";

const ROW_DATE =
  /^(\d{1,2}[\/-]\d{1,2}[\/-]\d{4})(?=\s|[A-Za-z|¦│])/;

/**
 * Monetary token.
 *
 * The leading boundary is intentionally broader than whitespace
 * because real PDF extraction can glue a monetary value directly
 * to category/description text.
 *
 * Fused monetary values themselves are separated first by
 * normalizeMoneyLayout().
 */
const MONEY_TOKEN =
  /(?:^|[^\d.,])((?:R\s*)?-?(?:\d{1,3}(?:[ ,]\d{3})+|\d+)\.\d{2})\*?(?!\d)/gi;

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
 * Normalize real Capitec PDF transaction-column text.
 *
 * Production PDF extraction can produce strings such as:
 *
 *   -200.00-6.002 372.24
 *   -83.0082.24
 *   -0.621 525.23
 *
 * They actually represent:
 *
 *   -200.00  -6.00  2 372.24
 *   -83.00   82.24
 *   -0.62    1 525.23
 *
 * This function inserts only structural whitespace. It does not
 * change any numeric values.
 */
function normalizeMoneyLayout(value = "") {
  let source = String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[|¦│]/g, " ");

  /*
   * Separate monetary values fused immediately after a
   * two-decimal monetary value.
   *
   * Repeat until stable because one source string can contain
   * more than one fused boundary.
   */
  let previous;

  do {
    previous = source;

    source = source.replace(
      /(\.\d{2}\*?)(?=(?:R\s*)?-?\d)/g,
      "$1 "
    );
  } while (source !== previous);

  /*
   * A transaction amount can occasionally be glued directly
   * after a numeric reference/card suffix:
   *
   *   7827-1475.99
   *
   * The minus sign gives us a safe structural boundary.
   */
  source = source.replace(
    /(\d)(?=-\d+(?:[ ,]\d{3})*\.\d{2})/g,
    "$1 "
  );

  return source;
}

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
 * These lines terminate an active transaction row.
 *
 * They must not be appended to the previous transaction because
 * summary amounts could otherwise be misread as transaction values.
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
 * Keep all text after the first Transaction History heading.
 *
 * We deliberately do not stop at the first page footer because
 * real Capitec transaction history spans multiple PDF pages.
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
 * A dated line begins a new transaction.
 * Wrapped description/category lines are appended until another
 * transaction date or a recognised page/section boundary.
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

  const source =
    normalizeMoneyLayout(body);

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

function absoluteApproximatelyEqual(
  left,
  right
) {
  return approximatelyEqual(
    Math.abs(left),
    Math.abs(right)
  );
}

/**
 * Determine the transaction movement represented by the final
 * monetary columns before the running balance.
 *
 * Common formats:
 *
 * Normal:
 *   amount | balance
 *
 * Fee-bearing:
 *   amount | fee | balance
 *
 * The running balance is used to resolve direction and to decide
 * whether amount + fee is the correct account movement.
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
   * Normal amount + balance.
   */
  candidates.push({
    value: last.value,
    descriptionEnd: last.index,
  });

  if (secondLast) {
    /*
     * Real Capitec:
     *
     * amount + fee + balance.
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
     * Retain the preceding monetary field independently for
     * ambiguous/legacy layouts.
     */
    candidates.push({
      value: secondLast.value,
      descriptionEnd:
        secondLast.index,
    });
  }

  /*
   * Without both running balances we cannot verify against
   * observed account movement.
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
   * Exact signed agreement.
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
   * Same magnitude but ambiguous/missing debit-credit sign.
   * Running balance determines the correct direction.
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
   * Preserve the printed source candidate so the validator
   * can surface balance_continuity_mismatch rather than
   * silently rewriting source data.
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
      normalizeMoneyLayout(body).slice(
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
 * Diagnostic output contains structural counts only.
 * It does not log statement text, names, account numbers,
 * descriptions or monetary values.
 */
export function extractCapitecTransactions(
  text,
  openingBalance = null
) {
  const source =
    String(text || "");

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