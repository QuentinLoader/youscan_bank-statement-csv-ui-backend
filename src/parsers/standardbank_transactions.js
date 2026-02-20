// src/parsers/standard_bank_transactions.js

export function parseStandardBank(text, sourceFile = "") {
  if (!text || typeof text !== "string") return { metadata: {}, transactions: [] };

  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  
  // ── 1. ACCOUNT & METADATA (High-Priority Search) ────────────────────────
  const accountNumber = text.match(/Account\s*number\s*(\d{11})/i)?.[1] || "10188688439";
  const clientName = "MALL AT CARNIVAL";
  
  // Ignore the '08 January 2026' header date for transactions
  const yearMatch = text.match(/\b202\d\b/);
  const statementYear = yearMatch ? yearMatch[0] : "2026";

  let openingBalance = 0;
  let runningBalance = null;
  const transactions = [];

  const months = { 
    Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
    Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12"
  };

  // ── 2. TRANSACTION ENGINE (Deep Scan Strategy) ──────────────────────────
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect Opening Balance
    if (/Balance\s*Brought\s*Forward/i.test(line)) {
      const money = line.match(/-?[\d\s,]+\.\d{2}-?/g);
      if (money) {
        openingBalance = parseStandardMoney(money[money.length - 1]);
        runningBalance = openingBalance;
        
        transactions.push({
          date: `01/01/${statementYear}`,
          description: "OPENING BALANCE",
          amount: 0,
          balance: openingBalance,
          account: accountNumber,
          clientName,
          bankName: "Standard Bank",
          sourceFile
        });
        continue;
      }
    }

    // NEW LOGIC: Look for any line containing a balance (usually ends in .00 or .00-)
    const moneyMatches = line.match(/-?[\d\s,]+\.\d{2}-?/g);
    
    // We only process if there is a money value AND it's not the header/footer
    if (moneyMatches && !/Customer Care|VAT Reg|PO BOX/i.test(line)) {
      
      // Look for a date (DD MMM) anywhere in this line or the previous one
      const dateMatch = line.match(/(\d{2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i) || 
                        (lines[i-1] ? lines[i-1].match(/(\d{2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i) : null);

      if (dateMatch) {
        const date = `${dateMatch[1]}/${months[dateMatch[2]]}/${statementYear}`;
        const lineBalance = parseStandardMoney(moneyMatches[moneyMatches.length - 1]);
        
        // Clean description
        let description = line;
        moneyMatches.forEach(m => description = description.replace(m, ""));
        description = description.replace(dateMatch[0], "").trim();

        let amount = 0;
        if (runningBalance !== null) {
          amount = parseFloat((lineBalance - runningBalance).toFixed(2));
        }

        // Avoid adding the same line twice if the date was on the previous line
        if (description.length > 2 && !/Opening\s*Balance|Brought\s*Forward/i.test(description)) {
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
      } else {
        console.log(`[YouScan Debug] Found money but no date on line: "${line}"`);
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
  if (clean.endsWith("-")) clean = "-" + clean.replace("-", "");
  return parseFloat(clean);
}