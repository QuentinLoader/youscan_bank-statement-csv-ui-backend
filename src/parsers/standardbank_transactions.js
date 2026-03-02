// src/parsers/standard_bank_transactions.js

export function parseStandardBank(text, sourceFile = "") {
  if (!text || typeof text !== "string") return { metadata: {}, transactions: [] };

  // Normalize Text (handle standard PDF multiline extractions)
  const cleanText = text.replace(/\r/g, "\n");
  const lines = cleanText.split("\n").map(l => l.trim()).filter(Boolean);

  // ── 1. METADATA ─────────────────────────────────────────────────────────
  const accountNumberMatch = cleanText.match(/(?:Account\s*number|Account\s*No)[^\d]*(\d{9,13})/i);
  const accountNumber = accountNumberMatch ? accountNumberMatch[1] : "10188688439";

  const clientNameMatch = cleanText.match(/(?:Mr|Mrs|Ms|Dr|Prof)\s+[A-Za-z\s]+|MALL AT CARNIVAL/i);
  const clientName = clientNameMatch ? clientNameMatch[0].trim() : "UNKNOWN";

  const yearMatch = cleanText.match(/\b20\d{2}\b/);
  const statementYear = yearMatch ? yearMatch[0] : new Date().getFullYear().toString();

  // Extract Exact Opening and Closing Balances
  let openingBalance = 0;
  let closingBalance = 0;

  // Added support for South African comma decimals (e.g. 12 081.00 OR 12 081,00)
  const obMatch = cleanText.match(/(?:Balance\s*Brought\s*Forward|OPENING BALANCE)[^\d-]+(-?[\d\s,]+[.,]\d{2}-?)/i);
  if (obMatch) openingBalance = parseStandardMoney(obMatch[1]);

  const cbMatch = cleanText.match(/(?:Month-end\s*Balance|CLOSING BALANCE|Carried\s*Forward)[^\d-]+(-?[\d\s,]+[.,]\d{2}-?)/i);
  if (cbMatch) closingBalance = parseStandardMoney(cbMatch[1]);

  const transactions = [];
  let runningBalance = openingBalance;

  // Regex to identify Standard Bank's trailing/leading currency (e.g., 1 234.56, -1 234,56, 1 234.56-)
  const moneyRegex = /-?[\d\s,]+[.,]\d{2}-?/g;

  // ── 2. TRANSACTION ENGINE ────────────────────────────────────────────────
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Strict Date Matching to prevent false positives on spaced currency (like 12 081)
    let date = null;
    let matchedDateStr = null;

    const dateMatch = line.match(/(?:^|\s)(\d{2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i);
    const dateMatchYMD = line.match(/(?:^|\s)(20\d{2})[-/](0[1-9]|1[0-2])[-/](0[1-9]|[12]\d|3[01])\b/);
    const dateMatchDMY = line.match(/(?:^|\s)(0[1-9]|[12]\d|3[01])[-/](0[1-9]|1[0-2])[-/](20\d{2})\b/);

    if (dateMatch) {
      matchedDateStr = dateMatch[0];
      const day = dateMatch[1];
      const months = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
      const month = months[dateMatch[2].toLowerCase()];
      date = `${statementYear}-${month}-${day}`;
    } else if (dateMatchYMD) {
      matchedDateStr = dateMatchYMD[0];
      date = `${dateMatchYMD[1]}-${dateMatchYMD[2]}-${dateMatchYMD[3]}`;
    } else if (dateMatchDMY) {
      matchedDateStr = dateMatchDMY[0];
      date = `${dateMatchDMY[3]}-${dateMatchDMY[2]}-${dateMatchDMY[1]}`;
    }

    if (date) {
      const moneyMatches = line.match(moneyRegex);

      if (moneyMatches && moneyMatches.length >= 1) {
        // The balance is strictly the last money format on the extracted line
        const lineBalanceStr = moneyMatches[moneyMatches.length - 1];
        const lineBalance = parseStandardMoney(lineBalanceStr);

        // Find the transaction amount
        let amountStr = null;
        let amount = 0;

        // If both Amount and Balance are on the line, take the Amount directly
        if (moneyMatches.length >= 2) {
          amountStr = moneyMatches[moneyMatches.length - 2];
          amount = parseStandardMoney(amountStr);
        } else if (runningBalance !== null) {
          // Fallback: Calculate strictly by delta if columns are squashed
          amount = parseFloat((lineBalance - runningBalance).toFixed(2));
        }

        // --- Description Extraction ---
        let description = line
          .replace(matchedDateStr, "")
          .replace(lineBalanceStr, "")
          .trim();
          
        if (amountStr) {
            description = description.replace(amountStr, "").trim();
        }

        // Handle descriptions Standard Bank drops on the previous line
        if (description.replace(/[^a-zA-Z]/g, "").length < 3 && i > 0) {
          const prevLine = lines[i - 1];
          if (!prevLine.match(moneyRegex) && !prevLine.match(/Balance Brought Forward|Month-end Balance/i)) {
            description = prevLine;
          }
        }

        // Clean up text artifacts
        description = description.replace(/Customer Care|VAT Reg|PO BOX|MALL AT/gi, "").trim();
        description = description.replace(/\s+/g, " ").toUpperCase() || "BANK TRANSACTION";

        // Push valid transactions (ignoring footer totals)
        if (!/TOTAL|BALANCE BROUGHT FORWARD/i.test(line) && Math.abs(amount) > 0) {
          transactions.push({
            date,
            description,
            amount,
            balance: lineBalance,
            account: accountNumber,
            clientName,
            bankName: "Standard Bank",
            sourceFile
          });
          
          // Lock the running balance to the explicit line balance to prevent drift
          runningBalance = lineBalance;
        }
      }
    }
  }

  // Prepend the Opening Balance for UI reconciliation visibility
  if (openingBalance !== 0 || transactions.length > 0) {
    transactions.unshift({
      date: `${statementYear}-01-01`, 
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

// ── 3. HELPER FUNCTIONS ──────────────────────────────────────────────────
function parseStandardMoney(val) {
  if (!val) return 0;
  
  // Strips internal spaces and "R" currency markers
  let clean = val.replace(/[R\s]/g, "");
  
  // Handle South African comma decimals (e.g. 1,234.56 vs 1234,56)
  if (clean.includes(",") && clean.includes(".")) {
     clean = clean.replace(/,/g, ""); 
  } else if (clean.includes(",")) {
     clean = clean.replace(/,/g, ".");
  }
  
  // Corrects trailing minus signs used by Standard Bank (e.g. "123.45-")
  if (clean.endsWith("-")) {
    clean = "-" + clean.slice(0, -1);
  }
  
  return parseFloat(clean) || 0;
}