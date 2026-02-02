import { ParseError } from "../errors/ParseError.js";

/**
 * Capitec rows look like:
 * Date | Description | Category | Money In | Money Out | Fee | Balance
 */
export function parseCapitecTransactions(lines) {
  const rows = [];

  for (const line of lines) {
    // Skip header repeats
    if (/^Date\s+Description/i.test(line)) continue;

    // Normalize spacing
    const clean = line.replace(/\s+/g, " ").trim();

    /**
     * Example:
     * 01/12/2025 Online Purchase: Afrihost.com Internet -83.00 82.24
     * 03/12/2025 PayShap Payment Received Other Income 100.00 165.24
     */
    const match = clean.match(
      /^(\d{2}\/\d{2}\/\d{4})\s+(.*?)\s+(-?\d[\d\s,.]*|\s)\s*(-?\d[\d\s,.]*|\s)?\s*(-?\d[\d\s,.]*|\s)?\s+(\d[\d\s,.]*)$/
    );

    if (!match) {
      throw new ParseError(
        "CAPITEC_ROW_PARSE_FAILED",
        `Unparseable Capitec transaction row: "${line}"`
      );
    }

    const [
      ,
      date,
      description,
      moneyInRaw,
      moneyOutRaw,
      feeRaw,
      balanceRaw
    ] = match;

    const credit = parseAmount(moneyInRaw);
    const debit = parseAmount(moneyOutRaw);
    const fee = parseAmount(feeRaw);
    const balance = parseAmount(balanceRaw);

    if (credit > 0 && debit > 0) {
      throw new ParseError(
        "CAPITEC_INVALID_ROW",
        "Row has both debit and credit"
      );
    }

    rows.push({
      date: toISO(date),
      description: description.trim(),
      debit: debit > 0 ? debit : 0,
      credit: credit > 0 ? credit : 0,
      fee: fee > 0 ? fee : null,
      balance
    });
  }

  if (rows.length === 0) {
    throw new ParseError("CAPITEC_NO_TRANSACTIONS", "No Capitec transactions parsed");
  }

  return rows;
}

/* helpers */

function toISO(date) {
  const [dd, mm, yyyy] = date.split("/");
  return `${yyyy}-${mm}-${dd}`;
}

function parseAmount(val) {
  if (!val) return 0;
  return Number(val.replace(/[^\d.-]/g, ""));
}
