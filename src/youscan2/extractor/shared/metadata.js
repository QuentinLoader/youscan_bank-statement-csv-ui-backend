import { normalizeWhitespace } from "./utils.js";
import { parseSignedMoney, parseStandardBankBalanceToken } from "./money.js";

function parseLooseMoney(value) {
  if (!value) return null;

  let raw = String(value).trim();

  let negative = false;
  if (raw.endsWith("-")) {
    negative = true;
    raw = raw.slice(0, -1);
  }

  raw = raw.replace(/\s+/g, "");

  const hasComma = raw.includes(",");
  const hasDot = raw.includes(".");

  if (hasComma && hasDot) {
    raw = raw.replace(/,/g, "");
  } else if (hasComma && !hasDot) {
    raw = raw.replace(/\./g, "").replace(",", ".");
  }

  const num = Number(raw);
  if (Number.isNaN(num)) return null;

  return negative ? -Math.abs(num) : num;
}

export function extractAccountNumber(text) {
  const source = String(text || "");

  const patterns = [
    /account number[:\s]*([0-9][0-9\s]{6,30})/i,
    /acc(?:ount)?\s*(?:no|number)?[:\s]*([0-9][0-9\s]{6,30})/i,
    /account no[:\s]*([0-9][0-9\s]{6,30})/i,
    /cheque account number[:\s]*([0-9][0-9\s-]{6,30})/i,
    /cheque account[:\s]*([0-9][0-9\s-]{6,30})/i,
    /\b(\d{2}-\d{4}-\d{4})\b/,
    /\b(\d{10,12})\b/,
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match) {
      const digits = match[1].replace(/\D/g, "");
      if (digits.length >= 10) return digits;
    }
  }

  return null;
}

export function extractClientName(text) {
  const source = String(text || "");

  const patterns = [
    // ABSA-specific: "Cheque account statement" followed by client name, then account number
    /Cheque account statement\s+([A-Z][A-Z0-9\s&'.()/-]{5,120}?)\s+40-\d{4}-\d{4}/i,

    /account holder[:\s]+([A-Z][A-Z\s'.&/-]{3,120})/i,
    /customer name[:\s]+([A-Z][A-Z\s'.&/-]{3,120})/i,
    /\b(MR\.\s+[A-Z][A-Z\s'.&-]{2,80})\b/i,
    /\b(MRS\.\s+[A-Z][A-Z\s'.&-]{2,80})\b/i,
    /\b(MS\.\s+[A-Z][A-Z\s'.&-]{2,80})\b/i,
    /^\s*([A-Z][A-Z0-9\s&'.()/-]{5,120}\b(?:CC|PTY LTD|LIMITED|LTD))\s*$/im,
    /^\s*([A-Z][A-Z0-9\s&'.()/-]{5,120})\s*\nPOSTNET SUITE/im,
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match) {
      const candidate = normalizeWhitespace(match[1]);

      if (
        candidate &&
        !/date\s*transaction\s*description/i.test(candidate) &&
        !/charge\s*debit\s*amount\s*credit\s*amount\s*balance/i.test(candidate) &&
        !/absa bank limited/i.test(candidate)
      ) {
        return candidate;
      }
    }
  }

  return null;
}

export function extractBalanceByPatterns(text, patterns) {
  for (const pattern of patterns) {
    const match = String(text || "").match(pattern);
    if (match) {
      const value =
        parseLooseMoney(match[1]) ??
        parseSignedMoney(match[1]);

      if (value !== null) return value;
    }
  }

  return null;
}

export function extractOpeningBalance(text) {
  return extractBalanceByPatterns(text, [
    /opening balance[:\s]*([0-9,.\s:-]+)/i,
    /balance brought forward[:\s]*([0-9,.\s:-]+)/i,
    /bal brought forward[:\s]*([0-9,.\s:-]+)/i,
    /BALANCE BROUGHT FORWARD[:\s]*([0-9,.\s:-]+)/i,
    /\bBal Brought Forward([0-9,.\s:-]+)/i,
  ]);
}

export function extractClosingBalance(text) {
  return extractBalanceByPatterns(text, [
    /closing balance[:\s]*([0-9,.\s:-]+)/i,
    /final balance[:\s]*([0-9,.\s:-]+)/i,
    /current balance[:\s]*([0-9,.\s:-]+)/i,
    /Month-end BalanceR?([0-9,.\s:-]+)/i,
    /\bBalance([0-9,.\s:-]+)\s*$/im,
  ]);
}

export function extractStatementPeriod(text) {
  const patterns = [
    /statement period[:\s]+([0-9]{1,2}[\/-][0-9]{1,2}[\/-][0-9]{2,4})\s+(?:to|-)\s+([0-9]{1,2}[\/-][0-9]{1,2}[\/-][0-9]{2,4})/i,
    /period[:\s]+([0-9]{1,2}[\/-][0-9]{1,2}[\/-][0-9]{2,4})\s+(?:to|-)\s+([0-9]{1,2}[\/-][0-9]{1,2}[\/-][0-9]{2,4})/i,
    /from[:\s]+([0-9]{1,2}[\/-][0-9]{1,2}[\/-][0-9]{2,4})\s+(?:to|-)\s+([0-9]{1,2}[\/-][0-9]{1,2}[\/-][0-9]{2,4})/i,
    /Statement from\s+([0-9]{1,2}\s+[A-Za-z]+\s+[0-9]{4})\s+to\s+([0-9]{1,2}\s+[A-Za-z]+\s+[0-9]{4})/i,
    /Your transactions\s*([0-9]{1,2}\s+[A-Za-z]{3,9}\s+[0-9]{4})\s*to\s*([0-9]{1,2}\s+[A-Za-z]{3,9}\s+[0-9]{4})/i,
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

  return { start: null, end: null };
}

export function extractStandardBankAccountNumber(text) {
  const source = String(text || "");
  const match = source.match(
    /^\s*Account Number[ \t:]*([0-9][0-9 \t-]{8,24})\s*$/im
  );

  if (!match) return null;

  const digits = match[1].replace(/\D/g, "");
  return digits.length >= 10 ? digits : null;
}

export function extractStandardBankClientName(text) {
  const source = String(text || "");

  const explicitPatterns = [
    /^\s*Account Holder[ \t:]+(.+?)\s*$/im,
    /^\s*Customer Name[ \t:]+(.+?)\s*$/im,
    /^\s*Account Name[ \t:]+(.+?)\s*$/im,
  ];

  for (const pattern of explicitPatterns) {
    const match = source.match(pattern);
    if (match) {
      const candidate = normalizeWhitespace(match[1]);
      if (candidate) return candidate;
    }
  }

  const titledName = source.match(
    /^\s*((?:MR|MRS|MS|DR|PROF)\.?[ \t]+[A-Z][A-Z .'-]{1,80})\s*$/im
  );

  if (titledName) {
    return normalizeWhitespace(titledName[1]);
  }

  return null;
}

export function extractStandardBankOpeningBalance(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!/^BALANCE BROUGHT FORWARD\b/i.test(line)) {
      continue;
    }

    /*
     * Native Standard Bank examples:
     *
     * BALANCE BROUGHT FORWARD 12 08 1,252.94-
     *
     * or:
     *
     * BALANCE BROUGHT FORWARD
     * 1,252.94-
     *
     * The MM DD fields are statement dates and must never
     * become part of the monetary value.
     */

    const sameLineMatch = line.match(
      /^BALANCE BROUGHT FORWARD\b(?:\s+\d{1,2}\s+\d{1,2})?\s+([0-9][0-9, ]*\.\d{2}-?)$/i
    );

    if (sameLineMatch) {
      const value =
        parseStandardBankBalanceToken(
          sameLineMatch[1]
        );

      if (value !== null) {
        return value;
      }
    }

    const nextLine =
      lines[i + 1] || "";

    const nextLineMatch = nextLine.match(
      /^(?:\d{1,2}\s+\d{1,2}\s+)?([0-9][0-9, ]*\.\d{2}-?)$/
    );

    if (nextLineMatch) {
      const value =
        parseStandardBankBalanceToken(
          nextLineMatch[1]
        );

      if (value !== null) {
        return value;
      }
    }
  }

  for (const line of lines) {
    const match = line.match(
      /^opening balance\b.*?([0-9][0-9, ]*\.\d{2}-?)$/i
    );

    if (!match) continue;

    const value =
      parseStandardBankBalanceToken(
        match[1]
      );

    if (value !== null) {
      return value;
    }
  }

  return null;
}

export function extractStandardBankClosingBalance(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);

  const priorities = [
    /^Balance outstanding at date of statement\b/i,
    /^closing balance\b/i,
    /^final balance\b/i,
    /^current balance\b/i,
    /^Month-end Balance\b/i,
  ];

  for (const pattern of priorities) {
    for (const line of lines) {
      if (!pattern.test(line)) continue;

      const tokens =
        line.match(/(?:\d{1,3}(?:[ ,]\d{3})*|\d+)\.\d{2}-?/g) || [];

      const value =
        parseStandardBankBalanceToken(
          tokens.at(-1) ?? null
        );

      if (value !== null) {
        return value;
      }
    }
  }

  return null;
}


function parseFnbSignedBalance(value, marker) {
  if (!value) return null;

  const parsed = parseLooseMoney(value);
  if (parsed === null) return null;

  const sign = String(marker || "").toLowerCase();
  if (sign === "dr") return -Math.abs(parsed);
  if (sign === "cr") return Math.abs(parsed);
  return parsed;
}

export function extractFnbAccountNumber(text) {
  const source = String(text || "");
  const patterns = [
    /Gold Business Account\s*:\s*([0-9][0-9\s-]{8,24})/i,
    /FNB\s+(?:Account|Acc)\s*(?:Number|No)?\s*:\s*([0-9][0-9\s-]{8,24})/i,
    /^\s*Account\s*:\s*([0-9][0-9\s-]{8,24})\s*$/im,
    /^\s*Account Number\s*:\s*([0-9][0-9\s-]{8,24})\s*$/im,
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (!match) continue;

    const digits = match[1].replace(/\D/g, "");
    if (digits.length >= 9) return digits;
  }

  return null;
}

export function extractFnbClientName(text) {
  const source = String(text || "");
  const patterns = [
    /^\s*\*([^\n]{3,120})\s*$/im,
    /^\s*Account Holder\s*:\s*([^\n]{3,120})\s*$/im,
    /^\s*Customer Name\s*:\s*([^\n]{3,120})\s*$/im,
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (!match) continue;

    const candidate = normalizeWhitespace(match[1]);
    if (candidate) return candidate;
  }

  return null;
}

export function extractFnbStatementPeriod(text) {
  const source = String(text || "");
  const patterns = [
    /Statement Period\s*:\s*(\d{1,2}\s+[A-Za-z]+\s+\d{4})\s+to\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i,
    /Staat Periode\s*:\s*(\d{1,2}\s+[A-Za-z]+\s+\d{4})\s+tot\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i,
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match) {
      return {
        start: normalizeWhitespace(match[1]),
        end: normalizeWhitespace(match[2]),
      };
    }
  }

  return { start: null, end: null };
}

export function extractFnbOpeningBalance(text) {
  const match = String(text || "").match(
    /Opening Balance\s*([0-9][0-9,\s]*\.\d{2})\s*(Cr|Dr)?/i
  );

  return match ? parseFnbSignedBalance(match[1], match[2]) : null;
}

export function extractFnbClosingBalance(text) {
  const match = String(text || "").match(
    /Closing Balance\s*([0-9][0-9,\s]*\.\d{2})\s*(Cr|Dr)?/i
  );

  return match ? parseFnbSignedBalance(match[1], match[2]) : null;
}


function parseCapitecSignedMoney(value) {
  if (!value) return null;

  const raw = String(value).replace(/^R\s*/i, "").replace(/\s+/g, "").trim();
  const negative = raw.startsWith("-");
  const parsed = parseLooseMoney(raw.replace(/^-/, ""));
  if (parsed === null) return null;

  return negative ? -Math.abs(parsed) : parsed;
}

export function extractCapitecAccountNumber(text) {
  const source = String(text || "");
  const patterns = [
    /^\s*Account\s*(?:Number|No)?\s*[:]?\s*\n?\s*([0-9]{9,12})\s*$/im,
    /^\s*Account Number\s*[:]?\s*([0-9]{9,12})\s*$/im,
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match) return match[1];
  }

  return null;
}

export function extractCapitecClientName(text) {
  const source = String(text || "");

  const anchored = source.match(
    /Main Account Statement\s*\n\s*((?:MR|MRS|MS|DR|PROF)\.?\s+[^\n]{2,100})/i
  );
  if (anchored) {
    const candidate = normalizeWhitespace(anchored[1]);
    if (candidate) return candidate;
  }

  const fallback = source.match(
    /^\s*((?:MR|MRS|MS|DR|PROF)\.?\s+[A-Z][A-Z .'-]{2,100})\s*$/im
  );

  return fallback ? normalizeWhitespace(fallback[1]) : null;
}

export function extractCapitecStatementPeriod(text) {
  const source = String(text || "");
  const from = source.match(/From Date\s*:\s*(\d{1,2}[\/-]\d{1,2}[\/-]\d{4})/i);
  const to = source.match(/To Date\s*:\s*(\d{1,2}[\/-]\d{1,2}[\/-]\d{4})/i);

  return {
    start: from ? normalizeWhitespace(from[1]) : null,
    end: to ? normalizeWhitespace(to[1]) : null,
  };
}

/**
 * Real Capitec PDFs can extract page-one columns in visual order rather
 * than label/value order.
 *
 * Example:
 *
 *   R503.87       <- available
 *   R533.87       <- closing
 *   R1 525.85     <- opening
 *   1862555255    <- account
 *   Main Account Statement
 *
 * while the labels later appear as:
 *
 *   From Date: ... Opening Balance:
 *   To Date: ... Closing Balance:
 *
 * The final two standalone money values immediately preceding the
 * account number are therefore authoritative opening/closing metadata.
 */
function extractCapitecDetachedBalances(text) {
  const source = String(text || "")
    .replace(/\u00a0/g, " ");

  const statementIndex =
    source.search(
      /\bMain Account Statement\b/i
    );

  if (statementIndex < 0) {
    return {
      opening: null,
      closing: null,
    };
  }

  const beforeStatement =
    source.slice(
      0,
      statementIndex
    );

  const lines =
    beforeStatement
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

  let accountIndex = -1;

  /*
   * Find the account-number line nearest the
   * Main Account Statement heading.
   */
  for (
    let i = lines.length - 1;
    i >= 0;
    i--
  ) {
    const digits =
      lines[i].replace(
        /\D/g,
        ""
      );

    if (
      /^[0-9\s]+$/.test(lines[i]) &&
      digits.length >= 9 &&
      digits.length <= 12
    ) {
      accountIndex = i;
      break;
    }
  }

  if (accountIndex < 0) {
    return {
      opening: null,
      closing: null,
    };
  }

  const values = [];

  /*
   * Walk backwards through the contiguous
   * standalone money values preceding the
   * account number.
   *
   * First value encountered = opening balance.
   * Second value encountered = closing balance.
   */
  for (
    let i = accountIndex - 1;
    i >= 0;
    i--
  ) {
    const line = lines[i];

    const moneyMatch =
      line.match(
        /^(-?\s*R\s*(?:\d{1,3}(?:[ ,]\d{3})+|\d+)\.\d{2})$/i
      );

    if (!moneyMatch) {
      if (values.length > 0) {
        break;
      }

      continue;
    }

    const value =
      parseCapitecSignedMoney(
        moneyMatch[1]
      );

    if (
      typeof value === "number" &&
      Number.isFinite(value)
    ) {
      values.push(value);
    }

    if (values.length >= 2) {
      break;
    }
  }

  return {
    opening:
      values[0] ?? null,

    closing:
      values[1] ?? null,
  };
}

export function extractCapitecOpeningBalance(text) {
  const source =
    String(text || "");

  /*
   * Preserve the existing labelled format
   * used by deterministic fixtures and any
   * Capitec text extraction that keeps the
   * value beside the label.
   */
  const labelled =
    source.match(
      /Opening Balance\s*:\s*R?\s*(-?(?:\d{1,3}(?:[ ,]\d{3})+|\d+)\.\d{2})/i
    );

  if (labelled) {
    return parseCapitecSignedMoney(
      labelled[1]
    );
  }

  /*
   * Real PDF fallback: Capitec's page-one
   * visual column extraction places the
   * balance value before the account/title.
   */
  return extractCapitecDetachedBalances(
    source
  ).opening;
}

export function extractCapitecClosingBalance(text) {
  const source =
    String(text || "");

  const labelled =
    source.match(
      /Closing Balance\s*:\s*R?\s*(-?(?:\d{1,3}(?:[ ,]\d{3})+|\d+)\.\d{2})/i
    );

  if (labelled) {
    return parseCapitecSignedMoney(
      labelled[1]
    );
  }

  return extractCapitecDetachedBalances(
    source
  ).closing;
}


function parseNedbankSignedMoney(value, marker = "") {
  if (!value) return null;

  const raw = String(value).replace(/^R\s*/i, "").trim();
  const parsed = parseLooseMoney(raw);
  if (parsed === null) return null;

  const sign = String(marker || "").toLowerCase();
  if (sign === "dr") return -Math.abs(parsed);
  if (sign === "cr") return Math.abs(parsed);
  return parsed;
}

export function extractNedbankAccountNumber(text) {
  const source = String(text || "");
  const patterns = [
    /^\s*Account\s*number\s*[:]?\s*([0-9][0-9\s-]{8,24})\s*$/im,
    /^\s*Account\s*(?:No|Number)\s*[:]\s*([0-9][0-9\s-]{8,24})\s*$/im,
    /\b(1605\d{6})\b/,
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (!match) continue;

    const digits = match[1].replace(/\D/g, "");
    if (digits.length >= 9) return digits;
  }

  return null;
}

export function extractNedbankClientName(text) {
  const source = String(text || "");
  const explicitPatterns = [
    /^\s*Account Holder\s*:\s*([^\n]{3,120})\s*$/im,
    /^\s*Customer Name\s*:\s*([^\n]{3,120})\s*$/im,
  ];

  for (const pattern of explicitPatterns) {
    const match = source.match(pattern);
    if (match) {
      const candidate = normalizeWhitespace(match[1]);
      if (candidate) return candidate;
    }
  }

  const titled = source.match(
    /^\s*((?:MR|MRS|MS|DR|PROF)\.?\s+[A-Z][A-Z .'-]{2,100})\s*$/im
  );

  return titled ? normalizeWhitespace(titled[1]) : null;
}

export function extractNedbankStatementPeriod(text) {
  const source =
    String(text || "");

  const date =
    String.raw`\d{1,2}[\/-]\d{1,2}[\/-]\d{4}`;

  /*
   * Nedbank PDFs may expose the separator as:
   *
   * - hyphen
   * - en dash
   * - em dash
   * - UTF-8 mojibake representing one of those characters
   *
   * Instead of depending on one particular encoded dash,
   * allow a short non-numeric separator between the two dates.
   */
  const patterns = [
    new RegExp(
      `Statement\\s*period\\s*:\\s*(${date})\\s*(?:to|[^0-9\\r\\n]{1,12})\\s*(${date})`,
      "i"
    ),

    new RegExp(
      `Period\\s*:\\s*(${date})\\s*(?:to|[^0-9\\r\\n]{1,12})\\s*(${date})`,
      "i"
    ),
  ];

  for (const pattern of patterns) {
    const match =
      source.match(pattern);

    if (match) {
      return {
        start:
          normalizeWhitespace(
            match[1]
          ),

        end:
          normalizeWhitespace(
            match[2]
          ),
      };
    }
  }

  return {
    start: null,
    end: null,
  };
}

export function extractNedbankOpeningBalance(text) {
  const match = String(text || "").match(
    /Opening\s*balance\s*:?\s*R?\s*(-?(?:\d{1,3}(?:[ ,]\d{3})+|\d+)\.\d{2})\s*(Cr|Dr)?/i
  );

  return match ? parseNedbankSignedMoney(match[1], match[2]) : null;
}

export function extractNedbankClosingBalance(text) {
  const match = String(text || "").match(
    /Closing\s*balance\s*:?\s*R?\s*(-?(?:\d{1,3}(?:[ ,]\d{3})+|\d+)\.\d{2})\s*(Cr|Dr)?/i
  );

  return match ? parseNedbankSignedMoney(match[1], match[2]) : null;
}


function parseDiscoverySignedMoney(value, marker = "") {
  if (!value) return null;

  let raw = String(value)
    .replace(/^\s*-?\s*R\s*/i, (prefix) => (prefix.includes("-") ? "-" : ""))
    .replace(/\s+/g, "")
    .trim();

  let negative = raw.startsWith("-");
  if (raw.endsWith("-")) {
    negative = true;
    raw = raw.slice(0, -1);
  }

  const parsed = parseLooseMoney(raw.replace(/^-/, ""));
  if (parsed === null) return null;

  const sign = String(marker || "").toLowerCase();
  if (sign === "dr") return -Math.abs(parsed);
  if (sign === "cr") return Math.abs(parsed);
  return negative ? -Math.abs(parsed) : parsed;
}

export function extractDiscoveryAccountNumber(text) {
  const source = String(text || "");
  const patterns = [
    /Transaction\s+Account[^\d]*(\d{10,15})/i,
    /^\s*Account\s*(?:Number|No)?\s*:\s*(\d{10,15})\s*$/im,
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match) return match[1];
  }

  return null;
}

export function extractDiscoveryClientName(text) {
  const source =
    String(text || "");

  const patterns = [
    /^\s*Account Holder\s*:\s*([^\n]{3,120})\s*$/im,
    /^\s*Customer Name\s*:\s*([^\n]{3,120})\s*$/im,

    /*
     * Real Discovery statements print the
     * account holder directly below the
     * TAX INVOICE / statement heading.
     *
     * Example:
     * Mr A Loader
     */
    /^\s*((?:Mr|Mrs|Ms|Miss|Dr|Prof)\.?\s+[A-Za-z][A-Za-z .'-]{1,100})\s*$/im,
  ];

  for (
    const pattern of patterns
  ) {
    const match =
      source.match(
        pattern
      );

    if (!match) {
      continue;
    }

    const candidate =
      normalizeWhitespace(
        match[1]
      );

    if (candidate) {
      return candidate;
    }
  }

  return null;
}

export function extractDiscoveryStatementPeriod(text) {
  const source =
    String(text || "");

  const namedDate =
    "(\\d{1,2}\\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[A-Za-z]*\\s+\\d{4})";

  const numericDate =
    "(\\d{1,2}[\\/-]\\d{1,2}[\\/-]\\d{4})";

  const patterns = [
    /*
     * Real Discovery:
     * Statement period 05 Jan 2026 - 04 Feb 2026
     *
     * Colon is optional.
     */
    new RegExp(
      `Statement\\s*period\\s*:?\\s*${namedDate}\\s*(?:to|[-–—])\\s*${namedDate}`,
      "i"
    ),

    new RegExp(
      `Statement\\s*period\\s*:?\\s*${numericDate}\\s*(?:to|[-–—])\\s*${numericDate}`,
      "i"
    ),

    new RegExp(
      `From\\s+${namedDate}\\s+to\\s+${namedDate}`,
      "i"
    ),

    new RegExp(
      `From\\s+${numericDate}\\s+to\\s+${numericDate}`,
      "i"
    ),
  ];

  for (
    const pattern of patterns
  ) {
    const match =
      source.match(
        pattern
      );

    if (match) {
      return {
        start:
          normalizeWhitespace(
            match[1]
          ),

        end:
          normalizeWhitespace(
            match[2]
          ),
      };
    }
  }

  return {
    start: null,
    end: null,
  };
}

export function extractDiscoveryOpeningBalance(text) {
  const match = String(text || "").match(
    /Opening\s+balance\s*:?\s*(-?\s*R\s*(?:\d{1,3}(?:[ ,]\d{3})+|\d+)\.\d{2}-?)\s*(Cr|Dr)?/i
  );

  return match ? parseDiscoverySignedMoney(match[1], match[2]) : null;
}

export function extractDiscoveryClosingBalance(text) {
  const match = String(text || "").match(
    /Closing\s+balance\s*:?\s*(-?\s*R\s*(?:\d{1,3}(?:[ ,]\d{3})+|\d+)\.\d{2}-?)\s*(Cr|Dr)?/i
  );

  return match ? parseDiscoverySignedMoney(match[1], match[2]) : null;
}

