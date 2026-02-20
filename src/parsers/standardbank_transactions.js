// src/parsers/standard_bank_transactions.js

export function parseStandardBank(text, sourceFile = "") {
  if (!text || typeof text !== "string") return { metadata: {}, transactions: [] };

  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  
  // ── 1. ACCOUNT & METADATA ──────────────────────────────────────────────
  // Targets the 11-digit account number (e.g., 10188688439)
  const accountNumber = text.match(/Account\s*number\s*(\d{10,13})/i)?.[1] || "NOT_FOUND";
  const clientName = text.match(/MALL\s+AT\s+CARNIVAL/i)?.[0] || "CLIENT_NOT_FOUND";
  
  // Year extraction from the header "08 January 2026"
  const yearMatch = text.match(/\d{2}\s+\w+\s+(20\d{2})/);
  const statementYear = yearMatch ? yearMatch[1] : "2026";

  let openingBalance = 0;
  let runningBalance = null;
  const transactions = [];

  const months = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
                   Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
                   January: "01", February: "02", March: "03", April: "04", May: "05", June: "06",
                   July: "07", August: "08", September: "09", October: "10", November: "11", December: "12" };

  // ── 2. TRANSACTION ENGINE ────────────────────────────────────────────────
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Anchor: Balance Brought Forward (Opening)
    if (/Balance\s*Brought\s*Forward/i.test(line) || /Opening\s*Balance/i.test(line)) {
      const money = line.match(/-?[\d\s,]+\.\d{2}-?/g);
      if (money) {
        openingBalance = parseStandardMoney(money[money.length - 1]);
        runningBalance = openingBalance;
        console.log(`[YouScan] Captured Opening Balance: ${openingBalance}`);
        continue; 
      }
    }

    // Pattern: DD MMM (e.g., "02 Jan")
    const dateMatch = line.match(/^(\d{2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i);
    
    if (dateMatch) {
      const day = dateMatch[1];
      const monthStr = dateMatch[2];
      const date = `${day}/${months[monthStr]}/${statementYear}`;
      
      // Money check for Standard Bank trailing minus (e.g., 500.00-)
      const moneyMatches = line.match(/-?[\d\s,]+\.\d{2}-?/g) || [];
      
      if (moneyMatches.length > 0) {
        // Balance is always the last money value on the line
        const lineBalance = parseStandardMoney(moneyMatches[moneyMatches.length - 1]);
        
        let description = line.replace(dateMatch[0], "");
        moneyMatches.forEach(m => description = description.replace(m, ""));
        description = description.trim();

        // Handle Wrapped Description (Common in Business Statements)
        if (lines[i+1] && !lines[i+1].match(/^\d{2}\s+\w+/) && !lines[i+1].match(/\.\d{2}/)) {
          description += " " + lines[i+1];
          i++; 
        }

        // Calculate Amount (Delta)
        let amount = 0;
        if (runningBalance !== null) {
          amount = parseFloat((lineBalance - runningBalance).toFixed(2));
        }

        transactions.push({
          date,
          description: description.toUpperCase().replace(/\s+/g, ' '),
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

  return {
    metadata: { accountNumber, clientName, openingBalance, bankName: "Standard Bank" },
    transactions
  };
}

function parseStandardMoney(val) {
  if (!val) return 0;
  let clean = val.replace(/[R\s,]/g, "");
  // Fixes trailing minus: "100.00-" -> "-100.00"
  if (clean.endsWith("-")) {
    clean = "-" + clean.replace("-", "");
  }
  return parseFloat(clean);
}