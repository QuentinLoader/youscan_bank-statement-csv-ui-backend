// src/parsers/nedbank_transactions.js
// Built against actual pdfplumber text extraction output from Nedbank statements.
// Key quirks handled:
//   - Words run together: "Openingbalance", "Closingbalance", "Accountnumber"
//   - Asterisk glued to amount: "250.00*"
//   - Tran-list prefix: "000643 26/06/2025 VAT ..."
//   - Columns: [Fees] [Debits] [Credits] [Balance] — only balance is always present

export function parseNedbank(text, sourceFile = "") {
  if (!text || typeof text !== "string") {
    return { metadata: {}, transactions: [] };
  }

  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);

  // ── Metadata ─────────────────────────────────────────────────────────────
  let accountNumber  = "";
  let clientName     = "";
  const bankName     = "Nedbank";
  let statementId    = "";
  let openingBalance = null;
  let closingBalance = null;

  // Account number — "Current account 1605175781" or "Accountnumber 1605175781"
  const accMatch = text.match(/(?:Current account|Accountnumber)[^\d]*(\d{8,12})/i);
  if (accMatch) accountNumber = accMatch[1];

  // Client name — first line starting with Mr/Mrs/Ms/Dr
  const nameMatch = text.match(/^((?:Mr|Mrs|Ms|Dr|Prof)\.?\s+[A-Z][A-Z\s]+)$/m);
  if (nameMatch) clientName = nameMatch[1].trim();

  // Envelope / statement ID
  const envMatch = text.match(/Envelope[:\s]+(\d+)\s+of\s+\d+/i);
  if (envMatch) statementId = envMatch[1];

  // ── Find where the transaction list starts ────────────────────────────────
  // Look for the header row that contains "Debits" AND "Balance" AND "Credits"
  const headerIdx = lines.findIndex(l =>
    /Debits/i.test(l) && /Balance/i.test(l) && /Credits/i.test(l)
  );
  const txLines = headerIdx >= 0 ? lines.slice(headerIdx + 1) : lines;

  // Money pattern: optional minus, digits, optional comma-thousands, dot-cents,
  // optional trailing asterisk (fees marker)
  const MONEY_RE = /-?\d{1,3}(?:,\d{3})*\.\d{2}\*?/g;

  // Match a transaction line: optional leading tran-list number, then a DD/MM/YYYY date
  const LINE_RE = /^(?:\d+\s+)?(\d{2}\/\d{2}\/\d{4})\s+(.+)$/;

  const transactions = [];
  let previousBalance = null;

  for (const line of txLines) {
    const lm = line.match(LINE_RE);
    if (!lm) continue;

    const date = lm[1];
    const rest = lm[2];

    // ── Opening balance line ──────────────────────────────────────────────
    if (/opening\s*balance/i.test(rest)) {
      const money = rest.match(MONEY_RE);
      if (money) {
        openingBalance = parseMoney(money[money.length - 1]);
        previousBalance = openingBalance;
      }
      continue; // not a transaction row
    }

    // ── Closing balance line ──────────────────────────────────────────────
    if (/closing\s*balance/i.test(rest)) {
      const money = rest.match(MONEY_RE);
      if (money) closingBalance = parseMoney(money[money.length - 1]);
      continue;
    }

    // ── Collect money values ──────────────────────────────────────────────
    const moneyMatches = rest.match(MONEY_RE);
    if (!moneyMatches || moneyMatches.length < 1) continue;

    // Balance is always the LAST money value on the line
    const balance = parseMoney(moneyMatches[moneyMatches.length - 1]);

    // ── Description: text before the first money token ────────────────────
    const firstMoneyIdx = rest.search(/-?\d{1,3}(?:,\d{3})*\.\d{2}\*?/);
    let description = firstMoneyIdx > 0
      ? rest.slice(0, firstMoneyIdx).trim()
      : rest.trim();

    // Strip trailing asterisk, whitespace, or "= R" artefacts left by inline VAT amounts
    description = description.replace(/[\s*]+$/, "").replace(/\s*=\s*R\s*$/, "").trim();

    // ── Amount derived from balance movement ──────────────────────────────
    // This is more reliable than parsing the debit/credit column because the
    // PDF column alignment is inconsistent after text extraction.
    let amount = 0;
    if (previousBalance !== null) {
      amount = parseFloat((balance - previousBalance).toFixed(2));
    } else if (moneyMatches.length >= 2) {
      // No previous balance yet — use second-to-last value as a fallback
      amount = parseMoney(moneyMatches[moneyMatches.length - 2]);
    }

    previousBalance = balance;

    transactions.push({
      date,
      description,
      amount,
      balance,
      account:    accountNumber,
      clientName,
      statementId,
      bankName,
      sourceFile
    });
  }

  // Fallback: grab closing balance from summary block if not found in tx list
  if (closingBalance === null) {
    const cb = text.match(/[Cc]losing\s*balance\s+R?([\d,]+\.\d{2})/);
    if (cb) closingBalance = parseMoney(cb[1]);
  }

  return {
    metadata: {
      accountNumber,
      clientName,
      bankName,
      statementId,
      openingBalance,
      closingBalance,
      sourceFile
    },
    transactions
  };
}

function parseMoney(value) {
  if (typeof value !== "string") return 0;
  return parseFloat(value.replace(/[*,]/g, ""));
}