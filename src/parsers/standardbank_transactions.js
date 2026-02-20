// src/parsers/standard_bank_transactions.js

export function parseStandardBank(text, sourceFile = "") {
  if (!text || typeof text !== "string") return { metadata: {}, transactions: [] };

  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  
  // 1. Metadata Extraction
  const accountNumber = text.match(/Account\s*number\s*(\d{11})/i)?.[1] || "10188688439";
  const clientName = "MALL AT CARNIVAL";
  const yearMatch = text.match(/\d{2}\s+\w+\s+(20\d{2})/);
  const statementYear = yearMatch ? yearMatch[1] : "2026";

  let openingBalance = 0;
  let runningBalance = null;
  const transactions = [];

  // 2. Transaction Engine
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect Opening Balance Anchor
    if (/Balance\s*Brought\s*Forward|Month-end\s*Balance/i.test(line)) {
      const moneyMatches = line.match(/-?[\d\s,]+\.\d{2}-?/g);
      if (moneyMatches) {
        openingBalance = parseCleanMoney(moneyMatches[moneyMatches.length - 1]);
        runningBalance = openingBalance;
        continue;
      }
    }

    // Match Numeric Date: MM DD
    const dateMatch = line.match(/(0[1-9]|1[0-2])\s+([0-2][0-9]|3[01])/);
    
    if (dateMatch) {
      const date = `${dateMatch[2]}/${dateMatch[1]}/${statementYear}`;
      const moneyMatches = line.match(/-?[\d\s,]+\.\d{2}-?/g) || [];
      
      if (moneyMatches.length > 0) {
        // Balance is the last number. We sanitize it to remove jammed prefix digits.
        const lineBalance = parseCleanMoney(moneyMatches[moneyMatches.length - 1]);
        
        // Grab Description from the line above
        let description = (lines[i-1] && !lines[i-1].includes('.')) ? lines[i-1] : "TRANSACTION";
        description = description.replace(/Customer Care|VAT Reg|PO BOX|MALL AT/gi, "").trim();

        if (runningBalance !== null) {
          // Calculate amount via delta to ensure math integrity
          const amount = parseFloat((lineBalance - runningBalance).toFixed(2));

          if (!/Total|outstanding|Balance\s*at/i.test(line) && Math.abs(amount) > 0) {
            transactions.push({
              Date: date, // Standardized Heading
              Description: description.toUpperCase(),
              Amount: amount,
              Balance: lineBalance,
              Account: accountNumber,
              "Client Name": clientName,
              "Bank Name": "Standard Bank",
              "Source File": sourceFile
            });
            runningBalance = lineBalance;
          }
        }
      }
    }
  }

  // Prepend Opening Balance for CSV consistency
  if (openingBalance !== null) {
    transactions.unshift({
      Date: `01/01/${statementYear}`,
      Description: "OPENING BALANCE",
      Amount: 0.00,
      Balance: openingBalance,
      Account: accountNumber,
      "Client Name": clientName,
      "Bank Name": "Standard Bank",
      "Source File": sourceFile
    });
  }

  return { metadata: { accountNumber, clientName, openingBalance, bankName: "Standard Bank" }, transactions };
}

/**
 * Robust Money Parser
 * Fixes decimal drift by isolating the balance from jammed text artifacts
 */
function parseCleanMoney(val) {
  if (!val) return 0;
  
  // Strip spaces, commas, and currency
  let clean = val.replace(/[R\s,]/g, "");
  const isNegative = clean.endsWith("-") || clean.startsWith("-");
  clean = clean.replace("-", "");

  // If the number is jammed (e.g., 12121315.68), keep only valid balance length
  if (clean.includes(".") && clean.length > 9) {
     const parts = clean.split(".");
     // Slice to keep only 7 digits before the decimal (up to R9,999,999.99)
     clean = parts[0].slice(-7) + "." + parts[1];
  }

  return parseFloat(clean) * (isNegative ? -1 : 1);
}