// src/parsers/nedbank_transactions.js

export function parseNedbank(text, sourceFile = "") {
  if (!text || typeof text !== "string") return { metadata: {}, transactions: [] };

  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  
  // ── 1. INITIALIZE STATE ──────────────────────────────────────────────────
  let accountNumber = "";
  let clientName = "";
  let openingBalance = null;
  let closingBalance = null;
  const transactions = [];
  let runningBalance = null;

  // ── 2. METADATA EXTRACTION (High Reliability) ───────────────────────────
  // Account Number: Look for number following "Account number" [cite: 19, 20]
  const accMatch = text.match(/Account\s*number\s*\n?\s*(\d{10,})/i);
  if (accMatch) accountNumber = accMatch[1];

  // Client Name: Specifically looking for the Mr/Ms line [cite: 3]
  const nameMatch = text.match(/(?:Mr|Mrs|Ms|Dr|Prof)\s+[A-Z\s]{5,}/i);
  if (nameMatch) clientName = nameMatch[0].trim();

  // Summary Block Fallback: Capture Opening/Closing from the top table [cite: 37, 38, 46, 47]
  const summaryOpening = text.match(/Opening\s*balance\s*R?([\d,\s]+\.\d{2})/i);
  if (summaryOpening) openingBalance = parseMoney(summaryOpening[1]);

  const summaryClosing = text.match(/Closing\s*balance\s*R?([\d,\s]+\.\d{2})/i);
  if (summaryClosing) closingBalance = parseMoney(summaryClosing[1]);

  // ── 3. TRANSACTION PROCESSING ───────────────────────────────────────────
  const DATE_RE = /^(\d{2}\/\d{2}\/\d{4})/;
  const MONEY_RE = /-?\d{1,3}(?:[,\s]\d{3})*\.\d{2}/g;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const dateMatch = line.match(DATE_RE);

    if (dateMatch) {
      const date = dateMatch[1];
      const moneyMatches = line.match(MONEY_RE) || [];
      
      // A: IDENTIFY OPENING BALANCE LINE 
      if (/Opening\s*balance/i.test(line)) {
        const val = parseMoney(moneyMatches[moneyMatches.length - 1]);
        openingBalance = val;
        runningBalance = val;
        continue; // Do not add opening balance as a transaction row
      }

      // B: IDENTIFY CLOSING BALANCE LINE 
      if (/Closing\s*balance/i.test(line)) {
        closingBalance = parseMoney(moneyMatches[moneyMatches.length - 1]);
        continue;
      }

      // C: PROCESS STANDARD TRANSACTION
      if (moneyMatches.length > 0) {
        const currentLineBalance = parseMoney(moneyMatches[moneyMatches.length - 1]);
        
        // Description Logic: Capture text, handle wraps, and remove artifacts 
        let description = line.replace(DATE_RE, "");
        moneyMatches.forEach(m => description = description.replace(m, ""));
        description = description.replace(/[*R,]/g, "").replace(/^\d{6}/, "").trim();

        // Check for multi-line description wrap
        if (lines[i+1] && !lines[i+1].match(DATE_RE) && !lines[i+1].match(MONEY_RE)) {
          description += " " + lines[i+1].trim();
          i++; 
        }

        // Calculate Amount (Delta)
        let amount = 0;
        if (runningBalance !== null) {
          amount = parseFloat((currentLineBalance - runningBalance).toFixed(2));
        }

        transactions.push({
          date,
          description: description.toUpperCase(),
          amount,
          balance: currentLineBalance,
          account: accountNumber,
          clientName,
          bankName: "Nedbank",
          sourceFile
        });

        runningBalance = currentLineBalance;
      }
    }
  }

  return {
    metadata: {
      accountNumber,
      clientName,
      openingBalance: openingBalance || 0, // Ensure R0.00 isn't returned if found 
      closingBalance: closingBalance || runningBalance,
      bankName: "Nedbank",
      sourceFile
    },
    transactions
  };
}

function parseMoney(value) {
  if (!value) return 0;
  return parseFloat(value.replace(/[R\s,]/g, ""));
}