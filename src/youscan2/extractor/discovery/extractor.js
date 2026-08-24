/**
 * YouScan V2
 * Discovery Bank statement transaction extractor.
 *
 * Supports:
 * - legacy line-oriented Discovery fixtures with printed running balances
 * - quoted / multiline CSV-like Discovery text
 * - real Discovery Gold Transaction Account statements whose transaction
 *   timeline contains only an Amount column and therefore requires derived
 *   running balances from the authoritative opening balance
 */

import { normalizeWhitespace } from "../shared/utils.js";

const MONTHS = Object.freeze({
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  oct: "10",
  nov: "11",
  dec: "12",
});

const DATE_AT_START =
  /^\s*(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(20\d{2})\b/i;

const INVERTED_DATE_AT_START =
  /^\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(20\d{2})\s+(\d{1,2})\b/i;

const DATE_ANY =
  /\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+20\d{2}\b/gi;

const MONEY_TOKEN =
  /(?:^|\s)(-?\s*R\s*(?:\d{1,3}(?:[ ,]\d{3})+|\d+)\.\d{2}-?)(?:\s*(Cr|Dr))?(?=\s|$)/gi;

function round2(value) {
  return Math.round(value * 100) / 100;
}

function parseDiscoveryDate(value = "") {
  const text = normalizeWhitespace(value);

  let match = text.match(DATE_AT_START);

  if (match) {
    const day = String(match[1]).padStart(2, "0");
    const month =
      MONTHS[
        String(match[2])
          .slice(0, 3)
          .toLowerCase()
      ];

    return month
      ? `${day}/${month}/${match[3]}`
      : null;
  }

  match =
    text.match(
      INVERTED_DATE_AT_START
    );

  if (match) {
    const month =
      MONTHS[
        String(match[1])
          .slice(0, 3)
          .toLowerCase()
      ];

    const day =
      String(match[3])
        .padStart(2, "0");

    return month
      ? `${day}/${month}/${match[2]}`
      : null;
  }

  return null;
}

function dateMatchAtStart(
  value = ""
) {
  const source =
    String(value || "");

  return (
    source.match(
      DATE_AT_START
    ) ||
    source.match(
      INVERTED_DATE_AT_START
    )
  );
}

function parseDiscoveryMoney(
  value,
  marker = ""
) {
  if (!value) {
    return null;
  }

  let raw =
    String(value)
      .replace(
        /^\s*-?\s*R\s*/i,
        (prefix) =>
          prefix.includes("-")
            ? "-"
            : ""
      )
      .replace(/\s+/g, "")
      .replace(/,/g, "")
      .trim();

  let negative =
    raw.startsWith("-");

  if (raw.endsWith("-")) {
    negative = true;
    raw =
      raw.slice(
        0,
        -1
      );
  }

  raw =
    raw.replace(
      /^-/,
      ""
    );

  if (
    !/^\d+(?:\.\d{2})$/.test(
      raw
    )
  ) {
    return null;
  }

  const parsed =
    Number(raw);

  if (
    !Number.isFinite(
      parsed
    )
  ) {
    return null;
  }

  const signMarker =
    String(marker || "")
      .toLowerCase();

  if (
    signMarker === "dr"
  ) {
    return -Math.abs(
      parsed
    );
  }

  if (
    signMarker === "cr"
  ) {
    return Math.abs(
      parsed
    );
  }

  return negative
    ? -Math.abs(parsed)
    : parsed;
}

function parseCsvRows(
  text = ""
) {
  const source =
    String(text || "")
      .replace(
        /\r/g,
        ""
      );

  const rows = [];

  let currentRow = [];
  let currentCell = "";
  let inQuotes = false;

  for (
    let i = 0;
    i < source.length;
    i++
  ) {
    const char =
      source[i];

    if (inQuotes) {
      if (
        char === '"' &&
        source[i + 1] ===
          '"'
      ) {
        currentCell += '"';
        i++;
      } else if (
        char === '"'
      ) {
        inQuotes = false;
      } else {
        currentCell += char;
      }

      continue;
    }

    if (
      char === '"'
    ) {
      inQuotes = true;
    } else if (
      char === ","
    ) {
      currentRow.push(
        currentCell
      );

      currentCell = "";
    } else if (
      char === "\n"
    ) {
      currentRow.push(
        currentCell
      );

      rows.push(
        currentRow
      );

      currentRow = [];
      currentCell = "";
    } else {
      currentCell += char;
    }
  }

  if (
    currentCell ||
    currentRow.length > 0
  ) {
    currentRow.push(
      currentCell
    );

    rows.push(
      currentRow
    );
  }

  return rows;
}

function expandCsvRows(
  text = ""
) {
  const logicalRows = [];

  for (
    const row of
    parseCsvRows(text)
  ) {
    if (
      !row ||
      row.length === 0
    ) {
      continue;
    }

    const splitCells =
      row.map(
        (cell) =>
          String(
            cell || ""
          )
            .split("\n")
            .map(
              (part) =>
                part.trim()
            )
      );

    const maxLines =
      Math.max(
        1,
        ...splitCells.map(
          (parts) =>
            parts.length
        )
      );

    for (
      let lineIndex = 0;
      lineIndex < maxLines;
      lineIndex++
    ) {
      const logical =
        splitCells
          .map(
            (parts) =>
              parts[
                lineIndex
              ] ?? ""
          )
          .filter(Boolean)
          .join(" ");

      const normalized =
        normalizeWhitespace(
          logical
        );

      if (normalized) {
        logicalRows.push(
          normalized
        );
      }
    }
  }

  return logicalRows;
}

function reconstructLineRows(
  text = ""
) {
  const lines =
    String(text || "")
      .replace(
        /\r/g,
        ""
      )
      .split("\n")
      .map(
        (line) =>
          line.trim()
      )
      .filter(Boolean);

  const rows = [];
  let current = "";

  for (
    const line of lines
  ) {
    if (
      dateMatchAtStart(
        line
      )
    ) {
      if (current) {
        rows.push(
          normalizeWhitespace(
            current
          )
        );
      }

      current = line;
      continue;
    }

    if (!current) {
      continue;
    }

    if (
      /^(?:Closing\s+balance|Statement\s+Summary|Summary|Totals?|Important\s+Information)\b/i.test(
        line
      )
    ) {
      rows.push(
        normalizeWhitespace(
          current
        )
      );

      current = "";
      continue;
    }

    current +=
      ` ${line}`;
  }

  if (current) {
    rows.push(
      normalizeWhitespace(
        current
      )
    );
  }

  return rows;
}

function extractTransactionTimelineBlock(
  text = ""
) {
  const source =
    String(text || "")
      .replace(
        /\r/g,
        ""
      );

  const startMatch =
    source.match(
      /Transaction\s+timeline\b/i
    );

  if (
    !startMatch ||
    typeof startMatch.index !==
      "number"
  ) {
    return null;
  }

  const remainder =
    source.slice(
      startMatch.index +
        startMatch[0].length
    );

  /*
   * We start searching only after
   * "Transaction timeline", so this
   * correctly finds the real timeline
   * closing balance rather than the
   * account-summary closing balance.
   */
  const closingMatch =
    remainder.match(
      /\bClosing\s+balance\b/i
    );

  return (
    closingMatch &&
    typeof closingMatch.index ===
      "number"
      ? remainder.slice(
          0,
          closingMatch.index
        )
      : remainder
  ).trim();
}

function reconstructTimelineRows(
  text = ""
) {
  /*
   * pdf-parse can flatten several Discovery
   * rows onto one physical text line.
   *
   * Split by every Discovery transaction
   * date rather than relying on newlines.
   */
  const source =
    String(text || "")
      .replace(
        /\r/g,
        "\n"
      );

  const dateMatches = [
    ...source.matchAll(
      DATE_ANY
    ),
  ];

  const rows = [];

  for (
    let i = 0;
    i < dateMatches.length;
    i++
  ) {
    const current =
      dateMatches[i];

    const next =
      dateMatches[
        i + 1
      ];

    const start =
      current.index ?? 0;

    const end =
      next?.index ??
      source.length;

    const segment =
      normalizeWhitespace(
        source.slice(
          start,
          end
        )
      );

    if (
      !segment ||
      !dateMatchAtStart(
        segment
      )
    ) {
      continue;
    }

    /*
     * A real financial row must expose at
     * least one R-prefixed monetary value.
     */
    if (
      extractMoneyTokens(
        segment
      ).length === 0
    ) {
      continue;
    }

    rows.push(
      segment
    );
  }

  return rows;
}

function candidateRows(
  text = ""
) {
  const source =
    String(text || "");

  const looksLikeQuotedColumns =
    /"[^"\n]*"\s*,\s*"/.test(
      source
    );

  /*
   * Preserve legacy quoted-column
   * behaviour exactly.
   */
  if (
    looksLikeQuotedColumns
  ) {
    return {
      mode: "legacy",

      rows: [
        ...new Set(
          expandCsvRows(
            source
          )
            .map(
              normalizeWhitespace
            )
            .filter(Boolean)
        ),
      ],
    };
  }

  const timelineBlock =
    extractTransactionTimelineBlock(
      source
    );

  /*
   * Real Discovery Gold statements have:
   *
   * Date | Card no. | Type | Details | Amount
   *
   * They do NOT print a running balance
   * for every transaction.
   */
  if (timelineBlock) {
    return {
      mode: "timeline",

      /*
       * Do not Set-dedupe these rows.
       *
       * The real statement contains
       * legitimate identical repeated
       * transactions.
       */
      rows:
        reconstructTimelineRows(
          timelineBlock
        ),
    };
  }

  /*
   * Preserve existing legacy
   * line-oriented parsing.
   */
  return {
    mode: "legacy",

    rows: [
      ...new Set(
        reconstructLineRows(
          source
        )
          .map(
            normalizeWhitespace
          )
          .filter(Boolean)
      ),
    ],
  };
}

function extractMoneyTokens(
  body = ""
) {
  const source =
    String(body || "");

  const matches = [];

  MONEY_TOKEN.lastIndex = 0;

  let match;

  while (
    (
      match =
        MONEY_TOKEN.exec(
          source
        )
    ) !== null
  ) {
    const raw =
      match[1];

    const marker =
      match[2] || "";

    const value =
      parseDiscoveryMoney(
        raw,
        marker
      );

    if (
      value === null
    ) {
      continue;
    }

    const rawOffset =
      match[0]
        .lastIndexOf(
          raw
        );

    matches.push({
      raw,
      marker,
      value,

      index:
        match.index +
        Math.max(
          0,
          rawOffset
        ),

      end:
        match.index +
        match[0].length,
    });
  }

  return matches;
}

function stripMoney(
  body,
  tokens
) {
  let description =
    String(body || "");

  for (
    const token of [
      ...tokens,
    ].sort(
      (a, b) =>
        b.index -
        a.index
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

  return normalizeWhitespace(
    description
      /*
       * Card number is already represented
       * elsewhere in the source. Removing
       * it keeps descriptions readable and
       * matches existing Discovery output.
       */
      .replace(
        /\*\*\*\d{4}/g,
        ""
      )
      .replace(
        /\b(?:Details|Amount|Type|Balance)\b/gi,
        " "
      )
      .replace(
        /^[,;|\s]+|[,;|\s]+$/g,
        " "
      )
  );
}

function explicitSign(
  token
) {
  if (!token) {
    return false;
  }

  const raw =
    String(
      token.raw || ""
    );

  return (
    /-\s*R/i.test(
      raw
    ) ||
    /-\s*$/.test(
      raw
    ) ||
    /^(?:Cr|Dr)$/i.test(
      token.marker || ""
    )
  );
}

function resolveLegacyAmount(
  candidateToken,
  balance,
  previousBalance
) {
  const candidate =
    candidateToken?.value ??
    null;

  if (
    typeof balance ===
      "number" &&
    Number.isFinite(
      balance
    ) &&
    typeof previousBalance ===
      "number" &&
    Number.isFinite(
      previousBalance
    )
  ) {
    const delta =
      round2(
        balance -
          previousBalance
      );

    if (
      candidate === null
    ) {
      return delta;
    }

    if (
      round2(
        Math.abs(
          candidate
        )
      ) ===
      round2(
        Math.abs(
          delta
        )
      )
    ) {
      return delta;
    }
  }

  if (
    candidate !== null &&
    explicitSign(
      candidateToken
    )
  ) {
    return candidate;
  }

  return candidate;
}

function parseTimelineRow(
  row,
  previousBalance
) {
  const dateMatch =
    dateMatchAtStart(
      row
    );

  if (!dateMatch) {
    return null;
  }

  const date =
    parseDiscoveryDate(
      dateMatch[0]
    );

  if (!date) {
    return null;
  }

  const body =
    String(row)
      .slice(
        dateMatch[0].length
      )
      .trim();

  const money =
    extractMoneyTokens(
      body
    );

  if (
    money.length === 0
  ) {
    return null;
  }

  /*
   * Real Discovery timeline:
   *
   * the LAST R-prefixed value before the
   * next transaction date is the amount.
   *
   * It is NOT a running balance.
   */
  const amountToken =
    money.at(-1);

  const amount =
    amountToken?.value ??
    null;

  if (
    typeof amount !==
      "number" ||
    !Number.isFinite(
      amount
    )
  ) {
    return null;
  }

  /*
   * Declined R0.00 entries are
   * informational. They do not represent
   * account movement and should not create
   * validator zero-amount warnings.
   */
  if (
    round2(amount) === 0
  ) {
    return null;
  }

  const balance =
    typeof previousBalance ===
      "number" &&
    Number.isFinite(
      previousBalance
    )
      ? round2(
          previousBalance +
            amount
        )
      : null;

  /*
   * Truncate at the amount token.
   *
   * This removes page-footer/legal text
   * that pdf-parse can append to the same
   * physical line after a transaction.
   */
  const transactionBody =
    body.slice(
      0,
      amountToken.end
    );

  const description =
    stripMoney(
      transactionBody,
      [amountToken]
    )
      /*
       * One real PDF extraction includes
       * an isolated lowercase "a" between
       * the wrapped description and amount.
       */
      .replace(
        /\s+\ba\b\s*$/,
        ""
      )
      .trim();

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

  return {
    date,

    description:
      description ||
      "Transaction",

    amount:
      round2(
        amount
      ),

    balance,
  };
}

function parseLegacyRow(
  row,
  previousBalance
) {
  const dateMatch =
    dateMatchAtStart(
      row
    );

  if (!dateMatch) {
    return null;
  }

  const date =
    parseDiscoveryDate(
      dateMatch[0]
    );

  if (!date) {
    return null;
  }

  const body =
    String(row)
      .slice(
        dateMatch[0].length
      )
      .trim();

  const money =
    extractMoneyTokens(
      body
    );

  if (
    money.length === 0
  ) {
    return null;
  }

  let amountToken;
  let balanceToken = null;

  /*
   * Existing deterministic fixtures and
   * legacy exports may expose:
   *
   * amount + running balance
   */
  if (
    money.length >= 2
  ) {
    balanceToken =
      money[
        money.length - 1
      ];

    amountToken =
      money[
        money.length - 2
      ];
  } else {
    amountToken =
      money[0];
  }

  const observedBalance =
    balanceToken?.value ??
    null;

  const amount =
    resolveLegacyAmount(
      amountToken,
      observedBalance,
      previousBalance
    );

  if (
    typeof amount !==
      "number" ||
    !Number.isFinite(
      amount
    )
  ) {
    return null;
  }

  let balance =
    observedBalance;

  if (
    balance === null &&
    typeof previousBalance ===
      "number" &&
    Number.isFinite(
      previousBalance
    )
  ) {
    balance =
      round2(
        previousBalance +
          amount
      );
  }

  const description =
    stripMoney(
      body,
      balanceToken
        ? [
            amountToken,
            balanceToken,
          ]
        : [
            amountToken,
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

  return {
    date,

    description:
      description ||
      "Transaction",

    amount:
      round2(
        amount
      ),

    balance:
      typeof balance ===
        "number" &&
      Number.isFinite(
        balance
      )
        ? round2(
            balance
          )
        : null,
  };
}

export function extractDiscoveryTransactions(
  text,
  openingBalance = null
) {
  const {
    rows,
    mode,
  } =
    candidateRows(
      text
    );

  const transactions = [];
  const seen =
    new Set();

  let previousBalance =
    typeof openingBalance ===
      "number" &&
    Number.isFinite(
      openingBalance
    )
      ? round2(
          openingBalance
        )
      : null;

  for (
    const row of rows
  ) {
    const tx =
      mode ===
      "timeline"
        ? parseTimelineRow(
            row,
            previousBalance
          )
        : parseLegacyRow(
            row,
            previousBalance
          );

    if (!tx) {
      continue;
    }

    /*
     * Balance is included in the key so
     * identical consecutive transactions
     * remain distinct when their running
     * balances differ.
     */
    const key =
      `${tx.date}|` +
      `${tx.description}|` +
      `${tx.amount}|` +
      `${tx.balance}`;

    if (
      seen.has(key)
    ) {
      continue;
    }

    seen.add(key);

    transactions.push(
      tx
    );

    if (
      typeof tx.balance ===
        "number" &&
      Number.isFinite(
        tx.balance
      )
    ) {
      previousBalance =
        tx.balance;
    } else if (
      typeof previousBalance ===
        "number" &&
      Number.isFinite(
        previousBalance
      )
    ) {
      previousBalance =
        round2(
          previousBalance +
            tx.amount
        );
    }
  }

  return transactions;
}