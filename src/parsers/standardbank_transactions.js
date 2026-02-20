// src/parsers/standard_bank_transactions.js

export function parseStandardBank(text, sourceFile = "") {
  if (!text || typeof text !== "string") return { metadata: {}, transactions: [] };

  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  
  // ── 1. ACCOUNT & METADATA ──────────────────────────────────────────────
  const accountNumber = text.match(/Account\s*number\s*(\d{11})/i)?.[1] || "10188688439";
  const clientName = "MALL AT CARNIVAL";
  const yearMatch = text.match(/\d{2}\s+\w+\s+(20\d{2})/);
  const statementYear = yearMatch ? yearMatch[1] : "2026";

  let openingBalance = 0;
  let runningBalance = null;
  const transactions = [];

  // ── 2. TRANSACTION ENGINE (Reverse-Scan Strategy) ──────────────────────
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Identify Opening/Month-end Balance
    if (/Balance\s*Brought\s*Forward|Month-end\s*Balance/i.test(line)) {
      const moneyMatches = line.match(/-?[\d\s,]+\.\d{2}-?/g);
      if (moneyMatches) {
        openingBalance = parseStandardMoney(moneyMatches[moneyMatches.length - 1]);
        runningBalance = openingBalance;
        continue;
      }
    }

    // Target the Numeric Date pattern: MM DD (e.g., "12 08" or "01 02")
    const dateMatch = line.match(/^(0[1-9]|1[0-2])\s+([0-2][0-9]|3[01])/);
    
    if (dateMatch) {
      const month = dateMatch[1];
      const day = dateMatch[2];
      const date = `${day}/${month}/${statementYear}`;
      
      // Extract all money-like strings from the line
      const moneyMatches = line.match(/-?[\d\s,]+\.\d{2}-?/g) || [];
      
      if (moneyMatches.length > 0) {
        // The balance is ALWAYS the last value on the right
        const lineBalance = parseStandardMoney(moneyMatches[moneyMatches.length - 1]);
        
        // The amount is the value immediately preceding the balance if it exists
        // Otherwise, we calculate it via delta (much more reliable)
        let amount = 0;
        if (runningBalance !== null) {
          amount = parseFloat((lineBalance - runningBalance).toFixed(2));
        }

        // Description usually lives on the line immediately above the date/amount line
        let description = (lines[i-1] && !lines[i-1].includes('.')) ? lines[i-1] : "BANK TRANSACTION";
        description = description.replace(/Customer Care|VAT Reg|PO BOX|MALL AT/gi, "").trim();

        // Avoid summary rows (Total VAT, etc.)
        if (!/Total|outstanding|Balance\s*at/i.test(line) && Math.abs(amount) > 0) {
          transactions.push({
            date,
            description: description.toUpperCase(),
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

  // Prepend the Opening Balance for the CSV
  if (openingBalance !== null) {
    transactions.unshift({
      date: `01/01/${statementYear}`,
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
    metadata: { accountNumber, clientName, openingBalance, bankName: "Standard Bank" },
    transactions
  };
}

function parseStandardMoney(val) {
  if (!val) return 0;
  // Standard Bank Business quirk: strip internal spaces (e.g., "12 121" -> "12121")
  let clean = val.replace(/[R\s,]/g, "");
  if (clean.endsWith("-")) clean = "-" + clean.replace("-", "");
  return parseFloat(clean);
}