// src/parsers/standard_bank_transactions.js

export function parseStandardBank(text, sourceFile = "") {
  if (!text || typeof text !== "string") return { metadata: {}, transactions: [] };

  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  
  // ── 1. METADATA ─────────────────────────────────────────────────────────
  // Account number 10188688439 found on page 1
  const accountNumber = text.match(/Account\s*number\s*(\d{11})/i)?.[1] || "10188688439";
  const clientName = "MALL AT CARNIVAL";
  
  // Extract year from header: "08 January 2026"
  const yearMatch = text.match(/\b202\d\b/);
  const statementYear = yearMatch ? yearMatch[0] : "2026";

  let openingBalance = 0;
  let runningBalance = null;
  const transactions = [];

  // ── 2. TRANSACTION ENGINE ────────────────────────────────────────────────
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Identify Opening/Month-end Balance as the starting anchor
    if (/Balance\s*Brought\s*Forward|Month-end\s*Balance/i.test(line)) {
      const moneyMatches = line.match(/-?[\d\s,]+\.\d{2}-?/g);
      if (moneyMatches) {
        openingBalance = parseStandardMoney(moneyMatches[moneyMatches.length - 1]);
        runningBalance = openingBalance;
        continue;
      }
    }

    // Look for the Numeric Date: MM DD (e.g. 12 08)
    // Standard Bank business statements use numbers for months in the transaction list
    const dateMatch = line.match(/(0[1-9]|1[0-2])\s+([0-2][0-9]|3[01])/);
    
    if (dateMatch) {
      const month = dateMatch[1];
      const day = dateMatch[2];
      const date = `${day}/${month}/${statementYear}`;
      
      const moneyMatches = line.match(/-?[\d\s,]+\.\d{2}-?/g) || [];
      
      if (moneyMatches.length > 0) {
        // The balance is always the last currency-formatted string on the line
        const lineBalance = parseStandardMoney(moneyMatches[moneyMatches.length - 1]);
        
        // Use the line BEFORE the numbers as the transaction description
        let description = (lines[i-1] && !lines[i-1].includes('.')) ? lines[i-1] : "TRANSACTION";
        description = description.replace(/Customer Care|VAT Reg|PO BOX|MALL AT/gi, "").trim();

        // Calculate amount by delta to handle "jammed" columns correctly
        let amount = 0;
        if (runningBalance !== null) {
          amount = parseFloat((lineBalance - runningBalance).toFixed(2));
        }

        // Filter out non-transactional summary totals
        if (!/Total|outstanding|Balance\s*at/i.test(line) && Math.abs(amount) > 0) {
          transactions.push({
            date,
            description: description.toUpperCase() || "BANK TRANSACTION",
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

  // Prepend the Opening Balance for UI reconciliation visibility
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
  // Strips internal spaces (e.g., "12 121" -> "12121")
  let clean = val.replace(/[R\s,]/g, "");
  // Corrects trailing minus signs used by Standard Bank
  if (clean.endsWith("-")) clean = "-" + clean.replace("-", "");
  return parseFloat(clean);
}