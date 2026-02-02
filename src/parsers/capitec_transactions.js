import { ParseError } from "../errors/ParseError.js";

export function parseCapitec(textOrLines) {
  const text = Array.isArray(textOrLines) ? textOrLines.join('\n') : textOrLines;
  const rows = [];
  
  // 1. This regex finds a Date, then grabs EVERYTHING until it sees the next Date or Balance
  // It handles descriptions that span multiple lines.
  const transactionRegex = /(\d{2}\/\d{2}\/\d{4})\s+([\s\S]*?)\s+(-?[\d\s,.]+\.\d{2})\s+(-?[\d\s,.]+\.\d{2})?\s*(-?[\d\s,.]+\.\d{2})?\s+(-?[\d\s,.]+\.\d{2})/g;

  let match;
  while ((match = transactionRegex.exec(text)) !== null) {
    const [
      , 
      date, 
      rawDescription, 
      val1, 
      val2, 
      val3, 
      balanceRaw
    ] = match;

    // Clean up description (remove extra newlines and spaces)
    const description = rawDescription.replace(/\n/g, " ").replace(/\s+/g, " ").trim();

    // Logic to determine which value is the transaction amount vs the fee
    const amount1 = parseAmount(val1);
    const amount2 = parseAmount(val2);
    const amount3 = parseAmount(val3);
    const balance = parseAmount(balanceRaw);

    // In your logs, Capitec often puts Amount, Fee, then Balance.
    // If val2 exists, it's likely the fee and val1 is the amount.
    let finalAmount = amount1;
    if (amount2 !== 0 && amount3 !== 0) {
        // If three numbers exist before balance, it's Amount, Fee, Balance
        finalAmount = amount1; 
    }

    rows.push({
      date: toISO(date),
      description: description,
      amount: finalAmount,
      balance: balance
    });
  }

  if (rows.length === 0) {
    console.error("No transactions matched the Master Regex. Check RAW text format.");
    throw new ParseError("CAPITEC_NO_TRANSACTIONS", "Could not extract transactions from PDF layout.");
  }

  return rows;
}

/* --- Helpers --- */
function toISO(date) {
  const [dd, mm, yyyy] = date.split("/");
  return `${yyyy}-${mm}-${dd}`;
}

function parseAmount(val) {
  if (!val) return 0;
  // Remove spaces (thousands separator) and keep numbers, dots, and minus signs
  const sanitized = val.replace(/\s/g, "").replace(/[^0-9.-]/g, "");
  return parseFloat(sanitized) || 0;
}