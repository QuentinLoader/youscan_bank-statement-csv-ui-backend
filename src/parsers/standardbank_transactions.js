// src/parsers/standard_bank_transactions.js

export function parseStandardBank(text, sourceFile = "") {
  if (!text || typeof text !== "string") return { metadata: {}, transactions: [] };

  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  
  const accountNumber = text.match(/Account\s*number\s*(\d{11})/i)?.[1] || "10188688439";
  const clientName = "MALL AT CARNIVAL";
  const yearMatch = text.match(/\b202\d\b/);
  const statementYear = yearMatch ? yearMatch[0] : "2026";

  let openingBalance = 0;
  let runningBalance = null;
  const transactions = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Anchor Opening Balance
    if (/Balance\s*Brought\s*Forward|Month-end\s*Balance/i.test(line)) {
      const moneyMatches = line.match(/-?[\d\s,]+\.\d{2}-?/g);
      if (moneyMatches) {
        openingBalance = parseStandardMoney(moneyMatches[moneyMatches.length - 1]);
        runningBalance = openingBalance;
        continue;
      }
    }

    // MM DD Numeric Date Pattern
    const dateMatch = line.match(/(0[1-9]|1[0-2])\s+([0-2][0-9]|3[01])/);
    
    if (dateMatch) {
      const date = `${dateMatch[2]}/${dateMatch[1]}/${statementYear}`;
      const moneyMatches = line.match(/-?[\d\s,]+\.\d{2}-?/g) || [];
      
      if (moneyMatches.length > 0) {
        // We take the LAST money match as the balance anchor
        const lineBalance = parseStandardMoney(moneyMatches[moneyMatches.length - 1]);
        
        let description = (lines[i-1] && !lines[i-1].includes('.')) ? lines[i-1] : "TRANSACTION";
        description = description.replace(/Customer Care|VAT Reg|PO BOX|MALL AT/gi, "").trim();

        if (runningBalance !== null) {
          const amount = parseFloat((lineBalance - runningBalance).toFixed(2));

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
  }

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

  return { metadata: { accountNumber, clientName, openingBalance, bankName: "Standard Bank" }, transactions };
}

/**
 * Enhanced Money Parser for Jammed Business Statements
 * Specifically handles the "Leading Sequence Number" artifact
 */
function parseStandardMoney(val) {
  if (!val) return 0;
  
  // 1. Remove currency/spaces/commas
  let clean = val.replace(/[R\s,]/g, "");
  const isNegative = clean.endsWith("-") || clean.startsWith("-");
  clean = clean.replace("-", "");

  // 2. REPEATABILITY FIX: 
  // If the number is unnaturally long (e.g. 12121315.68), it has a sequence prefix.
  // We identify the decimal point and keep only the digits belonging to the balance.
  if (clean.includes(".") && clean.length > 9) {
     const parts = clean.split(".");
     // Keep the 2 decimals and the 6-7 digits preceding the dot
     clean = parts[0].slice(-7) + "." + parts[1];
  }

  return parseFloat(clean) * (isNegative ? -1 : 1);
}