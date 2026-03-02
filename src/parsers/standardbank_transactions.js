// src/parsers/standard_bank_transactions.js

export function parseStandardBank(text, sourceFile = "") {
  if (!text || typeof text !== "string") return { metadata: {}, transactions: [] };

  const cleanText = text.replace(/\r/g, "\n");
  const lines = cleanText.split("\n").map(l => l.trim()).filter(Boolean);

  // ── 1. METADATA & STATEMENT PERIOD ────────────────────────────────────────
  // Strip spaces from account number (e.g. 1009 547 382 1)
  const accountNumberMatch = cleanText.match(/(?:Account\s*Number)[^\d]*([\d\s]+)/i);
  const accountNumber = accountNumberMatch ? accountNumberMatch[1].replace(/\s/g, "") : "UNKNOWN";

  const clientNameMatch = cleanText.match(/(?:MR\.|MRS\.|MS\.|DR\.|PROF\.)\s+[A-Za-z\s]+/i);
  const clientName = clientNameMatch ? clientNameMatch[0].trim() : "UNKNOWN";

  // Handle Year Rollovers (e.g., Statement from 08 December 2025 to 08 January 2026)
  let startYear = new Date().getFullYear();
  let endYear = startYear;
  const periodMatch = cleanText.match(/from\s+\d{2}\s+[a-zA-Z]+\s+(\d{4})\s+to\s+\d{2}\s+[a-zA-Z]+\s+(\d{4})/i);
  if (periodMatch) {
    startYear = parseInt(periodMatch[1], 10);
    endYear = parseInt(periodMatch[2], 10);
  }

  // Exact Opening and Closing Balances
  let openingBalance = 0;
  let closingBalance = 0;

  const obMatch = cleanText.match(/BALANCE BROUGHT FORWARD.*?(?:0[1-9]|1[0-2])\s+(?:[0-2][0-9]|3[01])\s+(-?[\d\s,]+[.,]\d{2}-?)/i);
  if (obMatch) openingBalance = parseStandardMoney(obMatch[1]);

  const cbMatch = cleanText.match(/Balance outstanding.*?(-?[\d\s,]+[.,]\d{2}-?)/i);
  if (cbMatch) closingBalance = parseStandardMoney(cbMatch[1]);

  const transactions = [];

  // ── 2. TRANSACTION ENGINE ────────────────────────────────────────────────
  // Captures: 1(Description) 2(Amount) 3(Month) 4(Day) 5(Balance)
  const txRegex = /^(.*?)\s+(-?[\d\s,]+[.,]\d{2}-?)\s+(0[1-9]|1[0-2])\s+([0-2][0-9]|3[01])\s+(-?[\d\s,]+[.,]\d{2}-?)$/i;
  
  // Boilerplate to ignore when scanning for wrapped descriptions
  const ignorePatterns = /Customer Care|VAT Reg|PO BOX|MALL AT|Statement|Page \d|0860 123|@standardbank|ACHIEVA/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const match = line.match(txRegex);

    if (match) {
      // It's a valid transaction line
      let description = match[1].trim();
      const amountStr = match[2];
      const month = match[3];
      const day = match[4];
      const balanceStr = match[5];

      // Determine the correct year based on month crossover (e.g., Dec vs Jan)
      let txYear = endYear;
      if (startYear !== endYear && month === "12") {
        txYear = startYear;
      }

      const date = `${txYear}-${month}-${day}`;
      const amount = parseStandardMoney(amountStr);
      const balance = parseStandardMoney(balanceStr);

      transactions.push({
        date,
        description: description.toUpperCase(),
        amount,
        balance,
        account: accountNumber,
        clientName,
        bankName: "Standard Bank",
        sourceFile
      });

    } else if (transactions.length > 0) {
      // If it doesn't match the transaction pattern, it might be a wrapped description for the PREVIOUS transaction
      if (
        !line.match(/BALANCE BROUGHT FORWARD|Month-end Balance|Balance outstanding/i) &&
        !line.match(ignorePatterns) &&
        !line.match(/^Total/i) &&
        line.length > 3
      ) {
        // Append this floating text to the description of the last recorded transaction
        transactions[transactions.length - 1].description += " " + line.toUpperCase().trim();
      }
    }
  }

  // Prepend Opening Balance for clean UI
  if (openingBalance !== 0 || transactions.length > 0) {
    const obDate = transactions.length > 0 ? transactions[0].date : `${startYear}-01-01`;
    transactions.unshift({
      date: obDate, 
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
    metadata: { 
      accountNumber, 
      clientName, 
      openingBalance, 
      closingBalance, 
      bankName: "Standard Bank", 
      sourceFile 
    },
    transactions
  };
}

// ── 3. HELPER FUNCTIONS ──────────────────────────────────────────────────
function parseStandardMoney(val) {
  if (!val) return 0;
  
  let clean = val.replace(/[R\s]/g, "");
  
  // South African decimal handling
  if (clean.includes(",") && clean.includes(".")) {
     clean = clean.replace(/,/g, ""); 
  } else if (clean.includes(",")) {
     clean = clean.replace(/,/g, ".");
  }
  
  // Convert trailing minus to leading minus (e.g. 1252.94- -> -1252.94)
  if (clean.endsWith("-")) {
    clean = "-" + clean.slice(0, -1);
  }
  
  return parseFloat(clean) || 0;
}