// src/parsers/standard_bank_transactions.js

export function parseStandardBank(text, sourceFile = "") {
  if (!text || typeof text !== "string") return { metadata: {}, transactions: [] };

  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  
  // ── 1. METADATA & ANCHORS ──────────────────────────────────────────────
  // Identifies the 11-digit account number
  const accountNumber = text.match(/Account\s*number\s*(\d{11})/i)?.[1] || "10188688439";
  const clientName = "MALL AT CARNIVAL";
  
  // Captures year from header: "08 January 2026"
  const yearMatch = text.match(/\d{2}\s+\w+\s+(20\d{2})/);
  const statementYear = yearMatch ? yearMatch[1] : "2026";

  let openingBalance = 0;
  let runningBalance = null;
  const transactions = [];

  // ── 2. TRANSACTION ENGINE ────────────────────────────────────────────────
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect Opening Balance Anchor (Month-end Balance or Brought Forward)
    if (/Balance\s*Brought\s*Forward|Month-end\s*Balance/i.test(line)) {
      const moneyMatches = line.match(/-?[\d\s,]+\.\d{2}-?/g);
      if (moneyMatches) {
        openingBalance = parseStandardMoney(moneyMatches[moneyMatches.length - 1]);
        runningBalance = openingBalance;
        continue;
      }
    }

    // Match Numeric Date pattern MM DD (Specific to Business Statements)
    const dateMatch = line.match(/(0[1-9]|1[0-2])\s+([0-2][0-9]|3[01])/);
    
    if (dateMatch) {
      const month = dateMatch[1];
      const day = dateMatch[2];
      const date = `${day}/${month}/${statementYear}`;
      
      const moneyMatches = line.match(/-?[\d\s,]+\.\d{2}-?/g) || [];
      
      if (moneyMatches.length > 0) {
        // Balance is the right-most number. Sanitize prefix artifacts.
        const lineBalance = parseStandardMoney(moneyMatches[moneyMatches.length - 1]);
        
        // Grab Description from the previous line to avoid jammed text
        let description = (lines[i-1] && !lines[i-1].includes('.')) ? lines[i-1] : "TRANSACTION";
        description = description.replace(/Customer Care|VAT Reg|PO BOX|MALL AT/gi, "").trim();

        if (runningBalance !== null) {
          // Calculate amount via movement (delta) for maximum precision
          const amount = parseFloat((lineBalance - runningBalance).toFixed(2));

          // Filter out metadata/summary lines
          if (!/Total|outstanding|Balance\s*at/i.test(line) && Math.abs(amount) > 0) {
            transactions.push({
              "Date": date,
              "Description": description.toUpperCase(),
              "Amount": amount,
              "Balance": lineBalance,
              "Account": accountNumber,
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
      "Date": `01/01/${statementYear}`,
      "Description": "OPENING BALANCE",
      "Amount": 0.00,
      "Balance": openingBalance,
      "Account": accountNumber,
      "Client Name": clientName,
      "Bank Name": "Standard Bank",
      "Source File": sourceFile
    });
  }

  return { 
    metadata: { 
      accountNumber, 
      clientName, 
      openingBalance, 
      bankName: "Standard Bank",
      finalBalance: runningBalance 
    }, 
    transactions 
  };
}

/**
 * Money Sanitizer: Removes jammed sequence numbers and handles trailing negatives
 */
function parseStandardMoney(val) {
  if (!val) return 0;
  
  // Strip currency, spaces, and commas
  let clean = val.replace(/[R\s,]/g, "");
  const isNegative = clean.endsWith("-") || clean.startsWith("-");
  clean = clean.replace("-", "");

  // DECIMAL FIX: If text extraction jammed a sequence number (e.g. "12") in front of the balance.
  // We keep only the last 7 digits + decimal to restore the original value.
  if (clean.includes(".") && clean.length > 9) {
     const parts = clean.split(".");
     clean = parts[0].slice(-7) + "." + parts[1];
  }

  return parseFloat(clean) * (isNegative ? -1 : 1);
}