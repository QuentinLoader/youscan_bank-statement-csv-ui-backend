// src/parsers/standard_bank_transactions.js

export function parseStandardBank(text, sourceFile = "") {
  if (!text || typeof text !== "string") return { metadata: {}, transactions: [] };

  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);

  // ── 1. METADATA & YEAR ROLLOVER ─────────────────────────────────────────
  const accountNumberMatch = text.match(/(?:Account\s*Number)[^\d]*([\d\s]+)/i);
  const accountNumber = accountNumberMatch ? accountNumberMatch[1].replace(/\s/g, "") : "UNKNOWN";

  const clientNameMatch = text.match(/(?:MR\.|MRS\.|MS\.|DR\.|PROF\.)\s+[A-Za-z\s]+/i);
  const clientName = clientNameMatch ? clientNameMatch[0].trim() : "UNKNOWN";

  let startYear = new Date().getFullYear();
  let endYear = startYear;
  const periodMatch = text.match(/from\s+\d{2}\s+[a-zA-Z]+\s+(\d{4})\s+to\s+\d{2}\s+[a-zA-Z]+\s+(\d{4})/i);
  if (periodMatch) {
    startYear = parseInt(periodMatch[1], 10);
    endYear = parseInt(periodMatch[2], 10);
  } else {
    const yearMatch = text.match(/\b20\d{2}\b/);
    if (yearMatch) {
        startYear = parseInt(yearMatch[0], 10);
        endYear = startYear;
    }
  }

  // ── 2. TRANSACTION ENGINE ────────────────────────────────────────────────
  const transactions = [];
  let openingBalance = null;
  let runningBalance = 0;

  // Strict regex matches: 1(Desc), 2(Amount?), 3(Month), 4(Day), 5(Balance)
  // Anchored to the END of the string to prevent date/balance bleeding
  const txRegex = /^(.*?)\s+(?:(-?[\d\s,]+[.,]\d{2}-?)\s+)?(0[1-9]|1[0-2])[\s.]([0-2][0-9]|3[01])\s+(-?[\d\s,]+[.,]\d{2}-?)$/i;

  for (const line of lines) {
     // Skip footer boilerplate that mimics numbers
     if (/Total charge amount|Account Summary|Balance outstanding/i.test(line)) continue;

     const match = line.match(txRegex);

     if (match) {
         let desc = match[1].trim();
         const amountStr = match[2];
         const month = match[3];
         const day = match[4];
         const balanceStr = match[5];

         const balance = parseStandardMoney(balanceStr);

         // Safely intercept Opening Balance
         if (desc.includes("BALANCE BROUGHT FORWARD") && openingBalance === null) {
             openingBalance = balance;
             runningBalance = balance;
             continue; // We inject this explicitly at the end for the UI
         }

         let txYear = endYear;
         if (startYear !== endYear && month === "12") txYear = startYear;
         const date = `${txYear}-${month}-${day}`;

         let amount = 0;
         if (amountStr) {
             amount = parseStandardMoney(amountStr);
         } else {
             amount = parseFloat((balance - runningBalance).toFixed(2));
         }

         // Clean up Standard Bank artifacts
         desc = desc.replace(/##/g, "").replace(/\s+/g, " ").trim();

         if (Math.abs(amount) > 0 || desc.includes("FEE")) {
             transactions.push({
                 date,
                 description: desc.toUpperCase() || "BANK TRANSACTION",
                 amount,
                 balance,
                 account: accountNumber,
                 clientName,
                 bankName: "Standard Bank",
                 sourceFile
             });
         }
         runningBalance = balance;
         
     } else if (transactions.length > 0) {
         // If a line doesn't match the regex, it's likely a wrapped description from the previous transaction
         const isBoilerplate = /Customer Care|VAT Reg|PO BOX|MALL AT|Statement|Page \d|0860 123|@standardbank|ACHIEVA/i.test(line);
         const isDateLine = /^\d{2} (January|February|March|April|May|June|July|August|September|October|November|December) \d{4}/i.test(line);
         
         if (!isBoilerplate && !isDateLine && line.length > 3) {
             transactions[transactions.length - 1].description += " " + line.replace(/##/g, "").trim().toUpperCase();
         }
     }
  }

  // ── 3. FRONT-END RECONCILIATION ──────────────────────────────────────────
  let closingBalance = runningBalance;
  const cbMatch = text.match(/Balance outstanding.*?(-?[\d\s.,]+\d{2}-?)/i);
  if (cbMatch) {
     closingBalance = parseStandardMoney(cbMatch[1]);
  }

  if (openingBalance !== null) {
     transactions.unshift({
         date: `${startYear}-01-01`,
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
      metadata: { accountNumber, clientName, openingBalance, closingBalance, bankName: "Standard Bank", sourceFile },
      transactions
  };
}

// ── HELPER FUNCTIONS ─────────────────────────────────────────────────────
function parseStandardMoney(val) {
  if (!val) return 0;
  let clean = val.replace(/[R\s]/g, "");
  if (clean.endsWith("-")) clean = "-" + clean.slice(0, -1);
  
  const lastDot = clean.lastIndexOf(".");
  const lastComma = clean.lastIndexOf(",");
  const separatorIdx = Math.max(lastDot, lastComma);
  
  if (separatorIdx !== -1) {
     const before = clean.slice(0, separatorIdx).replace(/[.,]/g, "");
     const after = clean.slice(separatorIdx + 1);
     clean = before + "." + after;
  }
  return parseFloat(clean) || 0;
}