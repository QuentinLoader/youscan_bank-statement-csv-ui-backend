/**
 * YouScan V2
 * Nedbank bank-statement transaction extractor.
 *
 * Supports:
 * - existing deterministic Nedbank fixtures
 * - real Nedbank Current Account statements
 * - line-oriented native PDF extraction
 * - flattened PDF extraction
 * - fused amount/balance values such as 0.19343.08
 *
 * Real format:
 *
 * Tran list no | Date | Description | Fees (R) | Debits (R) |
 * Credits (R) | Balance (R)
 *
 * The printed running balance is preserved and used to determine
 * debit/credit direction where the printed amount is ambiguous.
 */

import { normalizeDateToken } from "../shared/dates.js";
import { parseMoney } from "../shared/money.js";
import { normalizeWhitespace } from "../shared/utils.js";

const DATE_TOKEN =
  String.raw`\d{1,2}[\/-]\d{1,2}[\/-]\d{4}`;

const DATE_GLOBAL =
  new RegExp(DATE_TOKEN, "g");

const ROW_START =
  new RegExp(
    `^(?:(\\d{3,12})\\s*)?(${DATE_TOKEN})`
  );

/**
 * Important:
 *
 * Nedbank transaction rows use comma thousands separators:
 *
 *   11,369.18
 *
 * Do NOT allow spaces as thousands separators here.
 *
 * Allowing spaces caused references such as:
 *
 *   INV-7781 250.00
 *
 * to be misread as:
 *
 *   781 250.00
 *
 * Also deliberately require exactly two decimal digits, which lets
 * fused PDF text such as:
 *
 *   0.19343.08
 *
 * become two tokens:
 *
 *   0.19
 *   343.08
 */
const MONEY_TOKEN =
  /((?:R\s*)?-?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2})(?:\s*(Cr|Dr))?/gi;

function round2(value) {
  return Math.round(value * 100) / 100;
}

function parseNedbankMoney(
  value,
  marker = ""
) {
  if (!value) {
    return null;
  }

  const raw = String(value)
    .replace(/^R\s*/i, "")
    .replace(/,/g, "")
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
 * Locate the actual transaction table.
 *
 * Nedbank PDF extraction may retain normal spaces:
 *
 *   Tran list no Date Description Fees (R) ...
 *
 * or flatten them:
 *
 *   Tran list noDateDescriptionFees (R)Debits (R)...
 */
function isolateTransactionTable(
  text = ""
) {
  const source =
    String(text || "");

  const headerPatterns = [
    /Tran\s*list\s*no\s*Date\s*Description\s*Fees\s*\(R\)\s*Debits\s*\(R\)\s*Credits\s*\(R\)\s*Balance\s*\(R\)/i,

    /Tran\s*list\s*no\s*Date\s*Description[\s\S]{0,160}?Balance\s*\(R\)/i,
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

    /*
     * Handle both:
     *
     *   Closing balance 591.29
     *
     * and:
     *
     *   Closing balance591.29
     */
    const closingMatch =
      block.match(
        /Closing\s*balance/i
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

    return {
      text: block.trim(),
      isolated: true,
    };
  }

  /*
   * Original deterministic fixtures do not necessarily contain
   * the formal table heading. Preserve their old line-oriented path.
   */
  return {
    text: source,
    isolated: false,
  };
}

function isNoiseLine(
  line = ""
) {
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
    /^Bank charges for the period/i.test(value) ||
    /^Narrative Description/i.test(value) ||
    /^Electronic banking fees/i.test(value) ||
    /^Transaction service fees/i.test(value) ||
    /^Other charges/i.test(value) ||
    /^Total Charges/i.test(value) ||
    /^Date\s*(?:Description|Details|Transaction)/i.test(value) ||
    /^Tran\s*list\s*no\s*Date\s*Description/i.test(value)
  );
}

function isBoundaryLine(
  line = ""
) {
  const value =
    normalizeWhitespace(line);

  if (!value) {
    return false;
  }

  return (
    /^Closing\s*balance/i.test(value) ||
    /^Statement Summary/i.test(value) ||
    /^Summary of/i.test(value) ||
    /^Fees Summary/i.test(value) ||
    /^Important Information/i.test(value)
  );
}

/**
 * Original line-oriented reconstruction.
 *
 * Used for the existing deterministic Batch 06 fixtures so that
 * the real-PDF hardening does not change their behaviour.
 */
function reconstructLegacyRows(
  text = ""
) {
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

/**
 * Flattened PDF reconstruction.
 *
 * Once the real transaction table has been isolated, every complete
 * DD/MM/YYYY token represents a transaction-row boundary.
 *
 * Description fragments such as:
 *
 *   VAT 28/05-25/06
 *
 * do not contain a four-digit year and therefore cannot create
 * false transaction rows.
 *
 * This also handles:
 *
 *   343.2726/06/2025INTEREST...
 *
 * because we slice directly at the start of 26/06/2025 instead of
 * trying to insert whitespace into the preceding balance.
 */
function reconstructFlattenedRows(
  text = ""
) {
  const source =
    String(text || "");

  DATE_GLOBAL.lastIndex = 0;

  const dates = [];
  let match;

  while (
    (match =
      DATE_GLOBAL.exec(source)) !== null
  ) {
    dates.push({
      index: match.index,
      date: match[0],
    });
  }

  if (dates.length === 0) {
    return [];
  }

  const rows = [];

  for (
    let i = 0;
    i < dates.length;
    i += 1
  ) {
    const start =
      dates[i].index;

    const end =
      i + 1 < dates.length
        ? dates[i + 1].index
        : source.length;

    const row =
      normalizeWhitespace(
        source.slice(
          start,
          end
        )
      );

    if (row) {
      rows.push(row);
    }
  }

  return rows;
}

function reconstructRows(
  text,
  isolated
) {
  return isolated
    ? reconstructFlattenedRows(text)
    : reconstructLegacyRows(text);
}

/**
 * Extract decimal monetary values without interpreting integer
 * references as money.
 *
 * Exact match offsets are retained so the selected monetary columns
 * can later be removed from the transaction description.
 */
function extractMoneyTokens(
  body = ""
) {
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

    matches.push({
      raw,
      marker,
      value,
      index: match.index,
      end: MONEY_TOKEN.lastIndex,
    });
  }

  return matches;
}

function stripSelectedMoney(
  body,
  selectedTokens
) {
  let description =
    String(body || "")
      .replace(/[|¦│]/g, " ");

  /*
   * Remove right-to-left so removing a later value does not change
   * the offsets of an earlier value.
   */
  for (
    const token of [...selectedTokens]
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
 * Running-balance safety.
 *
 * If the observed running-balance delta agrees with the printed
 * amount magnitude, the delta determines the sign.
 *
 * If the amount is absent, derive it from the balance movement.
 *
 * If the printed amount genuinely disagrees with the running balance,
 * preserve the printed amount so validation can route the statement
 * to Review Required rather than silently altering the bank data.
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
    extractMoneyTokens(
      body
    );

  if (money.length === 0) {
    return null;
  }

  /*
   * The final decimal value is Nedbank's printed running balance.
   */
  const balanceToken =
    money.at(-1);

  /*
   * The immediately preceding decimal value represents whichever
   * populated monetary column applies to this transaction:
   *
   * fee / debit / credit.
   *
   * Earlier decimal numbers can legitimately belong to the
   * description, e.g. VAT ... = R41.73.
   */
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
    /\bopening\s*balance/i.test(
      description
    )
  ) {
    return null;
  }

  if (
    /\bclosing\s*balance/i.test(
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
   * Informational zero-movement rows such as Nedbank's VAT line
   * are not financial transactions.
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
  const table =
    isolateTransactionTable(
      text
    );

  const rows =
    reconstructRows(
      table.text,
      table.isolated
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
     * Explicit opening-balance row establishes state but is not
     * itself a financial transaction.
     *
     * No trailing word boundary is used because flattened text can
     * appear as:
     *
     *   Opening balance343.27
     */
    if (
      /\bopening\s*balance/i.test(
        row
      )
    ) {
      const money =
        extractMoneyTokens(
          row
        );

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
       * Zero-movement informational rows can still expose the
       * running balance required for the following transaction.
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