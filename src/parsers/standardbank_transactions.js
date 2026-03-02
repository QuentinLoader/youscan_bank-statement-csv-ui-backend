// src/parsers/standard_bank_transactions.js

export function parseStandardBank(text, sourceFile = "") {
  if (!text || typeof text !== "string") return { metadata: {}, transactions: [] };

  // Strip carriage returns to standardize line breaks
  const cleanText = text.replace(/\r/g, "");

  // ── 1. METADATA & YEAR ROLLOVER ─────────────────────────────────────────
  const accountNumberMatch = cleanText.match(/(?:Account\s*Number)[^\d]*([\d\s]+)/i);
  const accountNumber = accountNumberMatch ? accountNumberMatch[1].replace(/\s/g, "") : "UNKNOWN";

  const clientNameMatch = cleanText.match(/(?:MR\.|MRS\.|MS\.|DR\.|PROF\.)\s+[A-Za-z\s]+/i);
  const clientName = clientNameMatch ? clientNameMatch[0].trim() : "UNKNOWN";

  // Handle Dec-Jan crossover statements
  let startYear = new Date().getFullYear();
  let endYear = startYear;
  const periodMatch = cleanText.match(/from\s+\d{2}\s+[a-zA-Z]+\s+(\d{4})\s+to\s+\d{2}\s+[a-zA-Z]+\s+(\d{4})/i);
  if (periodMatch) {
    startYear = parseInt(periodMatch[1], 10);
    endYear = parseInt(periodMatch[2], 10);
  } else {
    const yearMatch = cleanText.match(/\b20\d{2}\b/);
    if (yearMatch) {
        startYear = parseInt(yearMatch[0], 10);
        endYear = startYear;
    }
  }

  // ── 2. CUSTOM CSV LEXER ──────────────────────────────────────────────────
  // Safely breaks down the quoted CSV text without shattering multiline cells
  const rows = [];
  let currentRow = [];
  let currentCell = "";
  let inQuotes = false;

  for (let i = 0; i < cleanText.length; i++) {
    const char = cleanText[i];
    if (inQuotes) {
      if (char === '"' && cleanText[i + 1] === '"') {
        currentCell += '"'; i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        currentCell += char;
      }
    } else {
      if (char === '"') inQuotes = true;
      else if (char === ',') { currentRow.push(currentCell); currentCell = ""; }
      else if (char === '\n') { 
        currentRow.push(currentCell); 
        rows.push(currentRow); 
        currentRow = []; currentCell = ""; 
      }
      else currentCell += char;
    }
  }
  if (currentCell || currentRow.length > 0) { currentRow.push(currentCell); rows.push(currentRow); }

  // ── 3. TRANSACTION ENGINE ────────────────────────────────────────────────
  const transactions = [];
  let openingBalance = null;
  let runningBalance = 0;

  // Regex to match "MM DD" (allows for OCR typos like "12.22")
  const dateRegex = /\b(0[1-9]|1[0-2])[\s.]([0-2][0-9]|3[01])\b/g;
  const balanceRegex = /-?[\d\s.,]+\d{2}-?/g;

  for (const row of rows) {
    // Standard Bank tables usually output 5 columns. Ensure we have at least 4.
    if (row.length >= 4) {
       // Target the final two columns directly
       const datesCol = row[row.length - 2] || "";
       const balancesCol = row[row.length - 1] || "";

       const dateMatches = datesCol.match(dateRegex) || [];
       const balanceMatches = balancesCol.match(balanceRegex) || [];
       
       // Clean balances to prevent picking up stray text dashes
       const validBalances = balanceMatches.filter(b => /\d/.test(b)).map(parseStandardMoney);

       // If the number of dates matches the number of balances, it's a valid transaction chunk!
       if (dateMatches.length === validBalances.length && dateMatches.length > 0) {
           
           // Extract the full description block
           let chunkDesc = (row[0] || "").replace(/\n/g, " ").replace(/\s+/g, " ").trim();
           chunkDesc = chunkDesc.replace(/Customer Care|VAT Reg|PO BOX|MALL AT|Statement|Page \d|0860 123/gi, "").trim();

           // Process each transaction mathematically via the running balance
           for (let i = 0; i < dateMatches.length; i++) {
               const dateStr = dateMatches[i].replace(".", " "); // Fix OCR dots
               const dateParts = dateStr.split(/\s+/);
               const month = dateParts[0];
               const day = dateParts[1];
               
               // Apply Year Rollover Logic
               let txYear = endYear;
               if (startYear !== endYear && month === "12") txYear = startYear;
               const date = `${txYear}-${month}-${day}`;
               
               const balance = validBalances[i];

               // Capture the native Opening Balance from the first row
               if (chunkDesc.includes("BALANCE BROUGHT FORWARD") && openingBalance === null && i === 0) {
                   openingBalance = balance;
                   runningBalance = balance;
                   continue; // Skip pushing this directly to prevent duplicates
               }

               if (openingBalance === null) openingBalance = 0; // Failsafe

               // Calculate true amount via Delta Math (bulletproof)
               const amount = parseFloat((balance - runningBalance).toFixed(2));
               runningBalance = balance;

               if (Math.abs(amount) > 0 || chunkDesc.includes("FEE")) {
                   let finalDesc = chunkDesc.toUpperCase() || "BANK TRANSACTION";
                   // Strip boilerplate if it's a single clean transaction
                   if (dateMatches.length === 1) {
                      finalDesc = finalDesc.replace(/BALANCE BROUGHT FORWARD/gi, "").replace(/##/g, "").trim();
                   }

                   transactions.push({
                      date,
                      description: finalDesc,
                      amount,
                      balance,
                      account: accountNumber,
                      clientName,
                      bankName: "Standard Bank",
                      sourceFile
                   });
               }
           }
       }
    }
  }

  // ── 4. CLOSING & FRONT-END RECONCILIATION ─────────────────────────────────
  let closingBalance = runningBalance;
  // Safely scan across newlines for the closing balance
  const cbMatch = cleanText.match(/Balance outstanding[\s\S]*?(-?[\d\s.,]+\d{2}-?)/i);
  if (cbMatch) {
     closingBalance = parseStandardMoney(cbMatch[1]);
  }

  // Append clean Opening Balance explicitly for UI
  if (openingBalance !== null && openingBalance !== 0 || transactions.length > 0) {
     transactions.unshift({
       date: `${startYear}-01-01`, 
       description: "OPENING BALANCE",
       amount: 0,
       balance: openingBalance || 0,
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
  
  // Standard Bank often trails negative signs (e.g., 1252.94-)
  if (clean.endsWith("-")) clean = "-" + clean.slice(0, -1);
  
  // Robust decimal and thousand separator parsing (handles OCR typos like "1.252.94")
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