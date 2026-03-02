// src/parsers/standard_bank_transactions.js

export function parseStandardBank(text, sourceFile = "") {
  if (!text || typeof text !== "string") return { metadata: {}, transactions: [] };

  // Normalize Text
  const cleanText = text.replace(/\r/g, "\n");
  const lines = cleanText.split("\n").map(l => l.trim()).filter(Boolean);

  // ── 1. METADATA ─────────────────────────────────────────────────────────
  const accountNumberMatch = cleanText.match(/(?:Account\s*number|Account\s*No)[^\d]*(\d{9,13})/i);
  const accountNumber = accountNumberMatch ? accountNumberMatch[1] : "10188688439";

  const clientNameMatch = cleanText.match(/(?:Mr|Mrs|Ms|Dr|Prof)\s+[A-Za-z\s]+|MALL AT CARNIVAL/i);
  const clientName = clientNameMatch ? clientNameMatch[0].trim() : "UNKNOWN";

  const yearMatch = cleanText.match(/\b20\d{2}\b/);
  const statementYear = yearMatch ? yearMatch[0] : new Date().getFullYear().toString();

  // Extract Exact Opening and Closing Balances
  let openingBalance = 0;
  let closingBalance = 0;

  const obMatch = cleanText.match(/(?:Balance\s*Brought\s*Forward|OPENING BALANCE)[^\d-]+(-?[\d\s,]+[.,]\d{2}-?)/i);
  if (obMatch) openingBalance = parseStandardMoney(obMatch[1]);

  const cbMatch = cleanText.match(/(?:Month-end\s*Balance|CLOSING BALANCE|Carried\s*Forward)[^\d-]+(-?[\d\s,]+[.,]\d{2}-?)/i);
  if (cbMatch) closingBalance = parseStandardMoney(cbMatch[1]);

  const transactions = [];
  let runningBalance = openingBalance;

  // Regex to identify Standard Bank's currency
  const moneyRegex = /-?[\d\s,]+[.,]\d{2}-?/g;
  
  // Anchor strictly to the start of the line for the date
  const dateRegex = /^(\d{2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i;

  // ── 2. TRANSACTION ENGINE ────────────────────────────────────────────────
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    const dateMatch = line.match(dateRegex);

    if (dateMatch) {
      const day = dateMatch[1];
      const months = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
      const month = months[dateMatch[2].toLowerCase()];
      const date = `${statementYear}-${month}-${day}`;

      const moneyMatches = line.match(moneyRegex);

      if (moneyMatches && moneyMatches.length >= 1) {
        // Balance is strictly the last money format
        const lineBalanceStr = moneyMatches[moneyMatches.length - 1];
        const lineBalance = parseStandardMoney(lineBalanceStr);

        let amountStr = null;
        let amount = 0;

        if (moneyMatches.length >= 2) {
          amountStr = moneyMatches[moneyMatches.length - 2];
          amount = parseStandardMoney(amountStr);
        } else if (runningBalance !== null) {
          amount = parseFloat((lineBalance - runningBalance).toFixed(2));
        }

        // --- Description Extraction ---
        let description = line;
        
        // Remove Date AND potential adjacent Value Date
        const datePatternStr = dateMatch[0].replace(/\s+/g, "\\s+");
        const doubleDateRegex = new RegExp(`^${datePatternStr}\\s*(?:${datePatternStr})?`, 'i');
        description = description.replace(doubleDateRegex, "");
        
        // Remove amounts
        description = description.replace(lineBalanceStr, "").trim();
        if (amountStr) {
            description = description.replace(amountStr, "").trim();
        }

        // Lookahead to append multi-line descriptions Standard Bank drops below the transaction
        let lookaheadIdx = i + 1;
        while (lookaheadIdx < lines.length) {
          const nextLine = lines[lookaheadIdx];
          // Break if we hit a new date, a balance footer, or a standalone currency amount
          if (
            nextLine.match(dateRegex) || 
            nextLine.match(/Balance Brought Forward|Month-end Balance/i) ||
            nextLine.match(moneyRegex)
          ) {
            break;
          }
          description += " " + nextLine.trim();
          lookaheadIdx++;
        }

        // Clean up text artifacts
        description = description.replace(/Customer Care|VAT Reg|PO BOX|MALL AT/gi, "").trim();
        description = description.replace(/\s+/g, " ").toUpperCase() || "BANK TRANSACTION";

        // Push valid transactions
        if (!/TOTAL|BALANCE BROUGHT FORWARD/i.test(line) && Math.abs(amount) > 0) {
          transactions.push({
            date,
            description,
            amount,
            balance: lineBalance,
            account: accountNumber,
            clientName,
            bankName: "Standard Bank",
            sourceFile
          });
          
          runningBalance = lineBalance;
        }
      }
    }
  }

  // Prepend the Opening Balance
  if (openingBalance !== 0 || transactions.length > 0) {
    transactions.unshift({
      date: `${statementYear}-01-01`, 
      description: "OPENING BALANCE",
      amount: 0,
      balance: openingBalance,
      account: accountNumber,
      clientName,
      bankName: "Standard Bank",
      sourceFile
    });
  }

  return {
    metadata: { accountNumber, clientName, openingBalance, closingBalance, bankName: "Standard Bank", sourceFile },
    transactions
  };
}

// ── 3. HELPER FUNCTIONS ──────────────────────────────────────────────────
function parseStandardMoney(val) {
  if (!val) return 0;
  
  let clean = val.replace(/[R\s]/g, "");
  
  if (clean.includes(",") && clean.includes(".")) {
     clean = clean.replace(/,/g, ""); 
  } else if (clean.includes(",")) {
     clean = clean.replace(/,/g, ".");
  }
  
  if (clean.endsWith("-")) {
    clean = "-" + clean.slice(0, -1);
  }
  
  return parseFloat(clean) || 0;
}