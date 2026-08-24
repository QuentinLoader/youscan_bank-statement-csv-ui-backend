/**
 * YouScan V2
 * Nedbank bank-statement transaction extractor.
 *
 * Supports:
 * - existing deterministic Nedbank fixtures
 * - real Nedbank Current Account statements
 * - optional transaction-list number before the date
 *
 * Real format:
 *
 * Tran list no | Date | Description | Fees (R) | Debits (R) |
 * Credits (R) | Balance (R)
 *
 * Running balances are preserved and used to resolve debit/credit
 * direction where the printed amount is ambiguous.
 */

import { normalizeDateToken } from "../shared/dates.js";
import { parseMoney } from "../shared/money.js";
import { normalizeWhitespace } from "../shared/utils.js";

const ROW_START =
  /^(?:(\d{3,12})\s+)?(\d{1,2}[\/-]\d{1,2}[\/-]\d{4})\b/;

const MONEY_TOKEN =
  /(?:^|\s)(R?\s*-?(?:\d{1,3}(?:[ ,]\d{3})+|\d+)\.\d{2})(?:\s*(Cr|Dr))?(?=\s|\*|$)/gi;

function round2(value) {
  return Math.round(value * 100) / 100;
}

function parseNedbankMoney(value, marker = "") {
  if (!value) {
    return null;
  }

  const raw = String(value)
    .replace(/^R\s*/i, "")
    .replace(/\s+/g, "")
    .trim();

  const explicitNegative =
    raw.startsWith("-");

  const parsed =
    parseMoney(
      raw.replace(/^-/, "")
    );

  if (parsed === null) {
    return null;
  }

  const signMarker =
    String(marker || "")
      .toLowerCase();

  if (signMarker === "dr") {
    return -Math.abs(parsed);
  }

  if (signMarker === "cr") {
    return Math.abs(parsed);
  }

  if (explicitNegative) {
    return -Math.abs(parsed);
  }

  return parsed;
}

/**
 * Real Nedbank statements contain several monetary summaries
 * before the transaction table.
 *
 * If the formal transaction-table header exists, isolate only
 * that table.
 *
 * Older regression fixtures do not include that exact header,
 * so fall back to whole-text row reconstruction.
 */
function isolateTransactionTable(text = "") {
  const source =
    String(text || "");

  const headerPatterns = [
    /Tran\s+list\s+no\s+Date\s+Description\s+Fees\s*\(R\)\s+Debits\s*\(R\)\s+Credits\s*\(R\)\s+Balance\s*\(R\)/i,

    /Tran\s+list\s+no\s+Date\s+Description\b[^\r\n]*\bBalance\s*\(R\)/i,
  ];

  for (const pattern of headerPatterns) {
    const match =
      source.match(pattern);

    if (
      !match ||
      typeof match.index !== "number"
    ) {
      continue;
    }

    let block =
      source.slice(
        match.index +
        match[0].length
      );

    const closingMatch =
      block.match(
        /^\s*Closing\s+balance\b/im
      );

    if (
      closingMatch &&
      typeof closingMatch.index === "number"
    ) {
      block =
        block.slice(
          0,
          closingMatch.index
        );
    }

    return block.trim();
  }

  /*
   * Backward compatibility for Batch 06 fixtures.
   */
  return source;
}

function isNoiseLine(line = "") {
  const value =
    normalizeWhitespace(line);

  if (!value) {
    return true;
  }

  return (
    /^Page\s+\d+\s+of\s+\d+/i.test(value) ||
    /^see money differently$/i.test(value) ||
    /^We subscribe to the Code of Banking Practice/i.test(value) ||
    /^Nedbank Ltd Reg No/i.test(value) ||
    /^Bank charges for the period\b/i.test(value) ||
    /^Narrative Description\b/i.test(value) ||
    /^Electronic banking fees\b/i.test(value) ||
    /^Transaction service fees\b/i.test(value) ||
    /^Other charges\b/i.test(value) ||
    /^Total Charges\b/i.test(value) ||
    /^Date\s+(?:Description|Details|Transaction)\b/i.test(value) ||
    /^Tran\s+list\s+no\s+Date\s+Description\b/i.test(value)
  );
}

function isBoundaryLine(line = "") {
  const value =
    normalizeWhitespace(line);

  if (!value) {
    return false;
  }

  return (
    /^Closing\s+balance\b/i.test(value) ||
    /^Statement Summary\b/i.test(value) ||
    /^Summary of\b/i.test(value) ||
    /^Fees Summary\b/i.test(value) ||
    /^Important Information\b/i.test(value)
  );
}

function reconstructRows(text = "") {
  const lines =
    String(text || "")
      .split(/\r?\n/)
      .map((line) =>
        line.trim()
      )
      .filter(Boolean);

  const rows = [];
  let current = "";

  function flush() {
    if (!current) {
      return;
    }

    const normalized =
      normalizeWhitespace(
        current
      );

    if (normalized) {
      rows.push(normalized);
    }

    current = "";
  }

  for (const line of lines) {
    if (isBoundaryLine(line)) {
      flush();
      continue;
    }

    if (isNoiseLine(line)) {
      continue;
    }

    if (ROW_START.test(line)) {
      flush();
      current = line;
      continue;
    }

    if (current) {
      current += ` ${line}`;
    }
  }

  flush();

  return rows;
}

function extractMoneyTokens(body = "") {
  const source =
    String(body || "")
      .replace(/[|¦│]/g, " ");

  const matches = [];

  MONEY_TOKEN.lastIndex = 0;

  let match;

  while (
    (match =
      MONEY_TOKEN.exec(source)) !== null
  ) {
    const raw =
      match[1];

    const marker =
      match[2] || "";

    const value =
      parseNedbankMoney(
        raw,
        marker
      );

    if (value === null) {
      continue;
    }

    const rawOffset =
      match[0].lastIndexOf(
        raw
      );

    const index =
      match.index +
      Math.max(
        0,
        rawOffset
      );

    /*
     * Include the complete matched token,
     * including an optional Cr/Dr marker.
     */
    const end =
      match.index +
      match[0].length;

    matches.push({
      raw,
      marker,
      value,
      index,
      end,
    });
  }

  return matches;
}

function stripSelectedMoney(
  body,
  moneyTokens
) {
  let description =
    String(body || "")
      .replace(/[|¦│]/g, " ");

  for (
    const token of [...moneyTokens]
      .sort(
        (a, b) =>
          b.index - a.index
      )
  ) {
    description =
      description.slice(
        0,
        token.index
      ) +
      description.slice(
        token.end
      );
  }

  /*
   * Some legacy Nedbank layouts can still leave a balance
   * direction marker behind after monetary-token removal.
   *
   * Remove Cr/Dr only when it occurs at the END of the
   * reconstructed description.
   */
  description =
    description.replace(
      /(?:\s+\b(?:Cr|Dr)\b)+\s*$/i,
      ""
    );

  return normalizeWhitespace(
    description
      .replace(/\s*\*\s*/g, " ")
      .replace(/^[*R,\s]+/, "")
      .replace(/\s{2,}/g, " ")
  );
}

/**
 * Reconciliation safety:
 *
 * - if candidate magnitude agrees with balance movement,
 *   balance movement decides the sign
 * - if no amount is printed, derive it from balance movement
 * - if printed amount and balance genuinely disagree, preserve
 *   the printed amount so validation can route to review
 */
function resolveAmount(
  candidate,
  balance,
  previousBalance
) {
  if (
    typeof balance === "number" &&
    Number.isFinite(balance) &&
    typeof previousBalance === "number" &&
    Number.isFinite(previousBalance)
  ) {
    const delta =
      round2(
        balance -
        previousBalance
      );

    if (
      candidate === null ||
      candidate === undefined
    ) {
      return delta;
    }

    if (
      round2(
        Math.abs(candidate)
      ) ===
      round2(
        Math.abs(delta)
      )
    ) {
      return delta;
    }
  }

  return candidate;
}

function parseRow(
  row,
  previousBalance
) {
  const source =
    String(row || "");

  const rowMatch =
    source.match(
      ROW_START
    );

  if (!rowMatch) {
    return null;
  }

  const date =
    normalizeDateToken(
      rowMatch[2]
    );

  if (!date) {
    return null;
  }

  const body =
    source
      .slice(
        rowMatch[0].length
      )
      .trim();

  const money =
    extractMoneyTokens(body);

  if (money.length === 0) {
    return null;
  }

  const balanceToken =
    money.at(-1);

  const amountToken =
    money.length >= 2
      ? money.at(-2)
      : null;

  const balance =
    balanceToken.value;

  if (
    typeof balance !== "number" ||
    !Number.isFinite(balance)
  ) {
    return null;
  }

  const amountCandidate =
    amountToken?.value ??
    null;

  const description =
    stripSelectedMoney(
      body,
      amountToken
        ? [
            amountToken,
            balanceToken,
          ]
        : [
            balanceToken,
          ]
    );

  if (
    /\bopening\s+balance\b/i.test(
      description
    )
  ) {
    return null;
  }

  if (
    /\bclosing\s+balance\b/i.test(
      description
    )
  ) {
    return null;
  }

  const amount =
    resolveAmount(
      amountCandidate,
      balance,
      previousBalance
    );

  if (
    typeof amount !== "number" ||
    !Number.isFinite(amount)
  ) {
    return null;
  }

  /*
   * Informational R0.00 rows are not financial movements.
   */
  if (round2(amount) === 0) {
    return null;
  }

  return {
    date,

    description:
      description ||
      "Transaction",

    amount:
      round2(amount),

    balance:
      round2(balance),
  };
}

export function extractNedbankTransactions(
  text,
  openingBalance = null
) {
  const transactionBlock =
    isolateTransactionTable(
      text
    );

  const rows =
    reconstructRows(
      transactionBlock
    );

  const transactions = [];

  let previousBalance =
    typeof openingBalance === "number" &&
    Number.isFinite(openingBalance)
      ? round2(
          openingBalance
        )
      : null;

  for (const row of rows) {
    /*
     * Explicit opening-balance rows establish state,
     * but are not transactions.
     */
    if (
      /\bopening\s+balance\b/i.test(
        row
      )
    ) {
      const money =
        extractMoneyTokens(row);

      const observedBalance =
        money.at(-1)?.value;

      if (
        previousBalance === null &&
        typeof observedBalance === "number" &&
        Number.isFinite(
          observedBalance
        )
      ) {
        previousBalance =
          round2(
            observedBalance
          );
      }

      continue;
    }

    const tx =
      parseRow(
        row,
        previousBalance
      );

    if (!tx) {
      /*
       * A zero-movement informational row may still expose
       * the current running balance for the following row.
       */
      const rowMatch =
        String(row).match(
          ROW_START
        );

      if (rowMatch) {
        const body =
          String(row)
            .slice(
              rowMatch[0].length
            )
            .trim();

        const money =
          extractMoneyTokens(
            body
          );

        const observedBalance =
          money.at(-1)?.value;

        if (
          typeof observedBalance === "number" &&
          Number.isFinite(
            observedBalance
          )
        ) {
          previousBalance =
            round2(
              observedBalance
            );
        }
      }

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

  return transactions;
}