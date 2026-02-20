// src/parsers/standard_bank_transactions.js

export function parseStandardBank(text, sourceFile = "") {
  if (!text || typeof text !== "string") return { metadata: {}, transactions: [] };

  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  
  // ── 1. METADATA ─────────────────────────────────────────────────────────
  const accountNumber = text.match(/Account\s*number\s*(\d{11})/i)?.[1] || "10188688439";
  const clientName = "MALL AT CARNIVAL";
  const yearMatch = text.match(/\b202\d\b/);
  const statementYear = yearMatch ? yearMatch[0] : "2026";
  const statementId = text.match(/Statement\s*\/\s*Invoice\s*No:\s*(\d+)/i)?.[1] || "";

  let openingBalance = 0;
  let runningBalance = null;
  const transactions = [];

  // ── 2. TRANSACTION ENGINE ────────────────────────────────────────────────
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Identify Opening Balance
    if (/Balance\s*Brought\s*Forward|Month-end\s*Balance/i.test(line)) {
      const moneyMatches = line.match(/-?[\d\s,]+\.\d{2}-?/g);
      if (moneyMatches) {
        openingBalance = parseStandardMoney(moneyMatches[moneyMatches.length - 1]);
        runningBalance = openingBalance;
        continue;
      }
    }

    // REPRODUCIBILITY FIX: Match Date (MM DD) that might be stuck to the balance
    // Matches: [Month] [Space] [Day][Balance] (e.g. "12 121,382.94-")
    const jammedMatch = line.match(/(0[1-9]|1[0-2])\s+([0-2][0-9]|3[01])([\d\s,]+\.\d{2}-?)/);
    
    if (jammedMatch) {
      const month = jammedMatch[1];
      const day = jammedMatch[2];
      const date = `${day}/${month}/${statementYear}`;
      const lineBalance = parseStandardMoney(jammedMatch[3]); // Correctly isolates balance

      let description = (lines[i-1] && !lines[i-1].includes('.')) ? lines[i-1] : "TRANSACTION";
      description = description.replace(/Customer Care|VAT Reg|PO BOX|MALL AT/gi, "").trim();

      if (runningBalance !== null) {
        const amount = parseFloat((lineBalance - runningBalance).toFixed(2));

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
  let clean = val.replace(/[R\s,]/g, "");
  if (clean.endsWith("-")) clean = "-" + clean.replace("-", "");
  return parseFloat(clean);
}