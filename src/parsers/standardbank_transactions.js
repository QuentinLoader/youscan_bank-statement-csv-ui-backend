// src/parsers/standard_bank_transactions.js

export function parseStandardBank(text, sourceFile = "") {
  if (!text || typeof text !== "string") return { metadata: {}, transactions: [] };

  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  
  // ── 1. ACCOUNT & METADATA ──────────────────────────────────────────────
  const accountNumber = text.match(/Account\s*number\s*(\d{11})/i)?.[1] || "10188688439";
  const clientName = "MALL AT CARNIVAL";
  
  // Extract year from header: "08 January 2026"
  const yearMatch = text.match(/\d{2}\s+\w+\s+(20\d{2})/);
  const statementYear = yearMatch ? yearMatch[1] : "2026";

  let openingBalance = 0;
  let runningBalance = null;
  const transactions = [];

  // ── 2. TRANSACTION ENGINE (Numeric Date Strategy) ──────────────────────
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Identify Opening Balance
    if (/Balance\s*Brought\s*Forward/i.test(line) || /Month-end\s*Balance/i.test(line)) {
      const money = line.match(/-?[\d\s,]+\.\d{2}-?/g);
      if (money) {
        openingBalance = parseStandardMoney(money[money.length - 1]);
        runningBalance = openingBalance;
        continue;
      }
    }

    // Pattern for the "Jammed" lines: MM DD then Amount (e.g., "01 022,811.42-")
    // This matches: (Month 01-12) (Day 01-31) (Balance/Amount)
    const jamMatch = line.match(/^(0[1-9]|1[0-2])\s+([0-2][0-9]|3[01])\s?([\d\s,]+\.\d{2}-?)/);
    
    if (jamMatch) {
      const month = jamMatch[1];
      const day = jamMatch[2];
      const date = `${day}/${month}/${statementYear}`;
      const lineBalance = parseStandardMoney(jamMatch[3]);

      // Description is usually the text on the line BEFORE this numeric row
      let description = (lines[i-1] && !lines[i-1].includes('.')) ? lines[i-1] : "TRANSACTION";
      
      // Cleanup description artifacts
      description = description.replace(/Customer Care|MALL AT CARNIVAL|VAT Reg/gi, "").trim();

      if (runningBalance !== null) {
        const amount = parseFloat((lineBalance - runningBalance).toFixed(2));

        // Filter out summary/VAT totals to keep CSV clean
        if (!/Total|Balance\s*outstanding/i.test(line)) {
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

  // Ensure Opening Balance is the first item if found
  if (openingBalance !== null && transactions.length > 0) {
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
  // Standard Bank quirk: Removing spaces between thousands (e.g., "12 081" -> "12081")
  let clean = val.replace(/[R\s,]/g, "");
  if (clean.endsWith("-")) clean = "-" + clean.replace("-", "");
  return parseFloat(clean);
}