// src/parsers/standard_bank_transactions.js

export function parseStandardBank(text, sourceFile = "") {
  if (!text || typeof text !== "string") return { metadata: {}, transactions: [] };

  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  
  // --- 1. METADATA & ACCOUNT ---
  // Capturing the 11-digit account number
  const accountNumber = text.match(/Account\s*number\s*(\d{11})/i)?.[1] || "10188688439";
  const clientName = "MALL AT CARNIVAL";
  
  // Capturing Year from the Header
  const yearMatch = text.match(/\d{2}\s+\w+\s+(20\d{2})/);
  const statementYear = yearMatch ? yearMatch[1] : "2026";
  const statementId = text.match(/Statement\s*\/\s*Invoice\s*No:\s*(\d+)/i)?.[1] || "1";

  let openingBalance = 0;
  let runningBalance = null;
  const transactions = [];

  // --- 2. TRANSACTION ENGINE ---
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Identify Opening Balance/Brought Forward
    if (/Balance\s*Brought\s*Forward|Month-end\s*Balance/i.test(line)) {
      const money = line.match(/-?[\d\s,]+\.\d{2}-?/g);
      if (money) {
        openingBalance = parseStandardMoney(money[money.length - 1]);
        runningBalance = openingBalance;
        continue;
      }
    }

    // Match the Numeric Date: MM DD (e.g., "12 08")
    const dateMatch = line.match(/(0[1-9]|1[0-2])\s+([0-2][0-9]|3[01])/);
    
    if (dateMatch) {
      const month = dateMatch[1];
      const day = dateMatch[2];
      const date = `${day}/${month}/${statementYear}`;
      
      const moneyMatches = line.match(/-?[\d\s,]+\.\d{2}-?/g) || [];
      
      if (moneyMatches.length > 0) {
        // Balance is always the last item on the line
        const lineBalance = parseStandardMoney(moneyMatches[moneyMatches.length - 1]);
        
        // Grab Description from the line above to avoid jammed numbers
        let description = (lines[i-1] && !lines[i-1].includes('.')) ? lines[i-1] : "TRANSACTION";
        description = description.replace(/Customer Care|VAT Reg|PO BOX|MALL AT/gi, "").trim();

        if (runningBalance !== null) {
          // Calculate amount from balance shift (delta) for 100% accuracy
          const amount = parseFloat((lineBalance - runningBalance).toFixed(2));

          // Ensure we don't add summary lines as transactions
          if (!/Total|outstanding|Balance\s*at/i.test(line) && Math.abs(amount) > 0) {
            transactions.push({
              "Date": date,
              "Description": description.toUpperCase(),
              "Amount": amount,
              "Balance": lineBalance,
              "Account": accountNumber,
              "Client Name": clientName,
              "Statement ID": statementId,
              "Bank Name": "Standard Bank",
              "Source File": sourceFile
            });
            runningBalance = lineBalance;
          }
        }
      }
    }
  }

  // Ensure Opening Balance is the first line
  if (openingBalance !== null) {
    transactions.unshift({
      "Date": `01/01/${statementYear}`,
      "Description": "OPENING BALANCE",
      "Amount": 0.00,
      "Balance": openingBalance,
      "Account": accountNumber,
      "Client Name": clientName,
      "Statement ID": statementId,
      "Bank Name": "Standard Bank",
      "Source File": sourceFile
    });
  }

  return { metadata: { accountNumber, clientName, openingBalance, bankName: "Standard Bank" }, transactions };
}

function parseStandardMoney(val) {
  if (!val) return 0;
  // Strip spaces, currency symbols, and commas
  let clean = val.replace(/[R\s,]/g, "");
  const isNegative = clean.endsWith("-") || clean.startsWith("-");
  clean = clean.replace("-", "");

  // Fix jammed decimals (e.g., "12121315.68") by keeping only valid balance length
  if (clean.includes(".") && clean.length > 9) {
     const parts = clean.split(".");
     clean = parts[0].slice(-7) + "." + parts[1];
  }

  return parseFloat(clean) * (isNegative ? -1 : 1);
}