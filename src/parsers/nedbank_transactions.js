// src/parsers/nedbank_transactions.js

export function parseNedbank(text, sourceFile = "") {
  if (!text || typeof text !== "string") return { metadata: {}, transactions: [] };

  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  
  // ── 1. ACCOUNT NUMBER EXTRACTION WITH LOGGING ────────────────────────────
  const accountNumber = extractAccountNumber(text, lines);

  let clientName = "";
  let openingBalance = 0;
  let closingBalance = 0;
  const transactions = [];

  const nameMatch = text.match(/(?:Mr|Mrs|Ms|Dr|Prof)\s+[A-Z\s]{5,}/i);
  if (nameMatch) clientName = nameMatch[0].trim();

  // ── 2. TRANSACTION ENGINE ────────────────────────────────────────────────
  const DATE_RE = /^(\d{2}\/\d{2}\/\d{4})/;
  const MONEY_RE = /-?\d{1,3}(?:[,\s]\d{3})*\.\d{2}/g;
  let runningBalance = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const dateMatch = line.match(DATE_RE);

    if (dateMatch) {
      const date = dateMatch[1];
      const moneyInLine = line.match(MONEY_RE) || [];
      const lineBalance = moneyInLine.length > 0 ? parseMoney(moneyInLine[moneyInLine.length - 1]) : null;

      let description = line.replace(DATE_RE, "");
      moneyInLine.forEach(m => description = description.replace(m, ""));
      description = description.replace(/[*R,]/g, "").replace(/^\d{6}/, "").trim();

      // Handle multi-line wrap
      if (lines[i+1] && !lines[i+1].match(DATE_RE) && !lines[i+1].match(MONEY_RE) && !/Account|Page|Balance/i.test(lines[i+1])) {
        description += " " + lines[i+1].trim();
        i++; 
      }

      // Process Opening Balance
      if (/Opening\s*balance/i.test(description)) {
        openingBalance = lineBalance;
        runningBalance = lineBalance;
        transactions.push({
          date,
          description: "OPENING BALANCE",
          amount: 0,
          balance: lineBalance,
          account: accountNumber,
          clientName,
          bankName: "Nedbank",
          sourceFile
        });
        continue;
      }

      // Process Movements
      if (lineBalance !== null && runningBalance !== null) {
        const amount = parseFloat((lineBalance - runningBalance).toFixed(2));
        if (!/Closing\s*balance/i.test(description)) {
          transactions.push({
            date,
            description: description.toUpperCase(),
            amount,
            balance: lineBalance,
            account: accountNumber,
            clientName,
            bankName: "Nedbank",
            sourceFile
          });
          runningBalance = lineBalance;
        } else {
          closingBalance = lineBalance;
        }
      }
    }
  }

  return {
    metadata: { accountNumber, clientName, openingBalance, closingBalance, bankName: "Nedbank", sourceFile },
    transactions
  };
}

/**
 * Strategy-based account number extractor with logging
 */
function extractAccountNumber(text, lines) {
  console.log("[YouScan Debug] Starting Account Number Extraction...");

  // Strategy 1: Look for 10-digit number following label (same line or next)
  for (let i = 0; i < Math.min(lines.length, 50); i++) {
    if (/Account\s*number/i.test(lines[i])) {
      const match = lines[i].match(/(\d{10})/);
      if (match) {
        console.log(`[YouScan Debug] Found Account in Strategy 1 (Same Line): ${match[1]}`);
        return match[1];
      }
      if (lines[i+1] && lines[i+1].match(/^\d{10}$/)) {
        console.log(`[YouScan Debug] Found Account in Strategy 1 (Next Line): ${lines[i+1]}`);
        return lines[i+1].trim();
      }
    }
  }

  // Strategy 2: Global scan for known account format 1605XXXXXX
  const globalMatch = text.match(/1605\d{6}/);
  if (globalMatch) {
    console.log(`[YouScan Debug] Found Account in Strategy 2 (Pattern Match): ${globalMatch[0]}`);
    return globalMatch[0];
  }

  console.warn("[YouScan Debug] FAILED to identify Account Number. Check raw text block above.");
  return "NOT_FOUND";
}

function parseMoney(value) {
  if (!value) return 0;
  return parseFloat(value.replace(/[R\s,]/g, ""));
}