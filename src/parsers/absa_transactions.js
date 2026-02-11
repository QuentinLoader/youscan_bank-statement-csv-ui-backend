/**
 * ABSA Parser (Reconciliation Ready)
 * * Strategy:
 * 1. Anchors on Date (Start) and Balance (End).
 * 2. Normalizes ABSA specific number formats ("1 000,00-").
 * 3. Uses Balance-Driven logic to find the exact transaction amount inside the text.
 * 4. Returns { metadata, transactions } for Lovable Dashboard.
 */

export const parseAbsa = (text) => {
  const transactions = [];

  // ===========================================================================
  // 1. HELPER: ABSA NUMBER PARSER
  // ===========================================================================
  // Handles: "1 234,56" and "1 234,56-" (Trailing minus)
  const parseAbsaNum = (val) => {
    if (!val) return 0;
    let clean = val.trim();
    
    // Check for trailing minus (Debit)
    let isNegative = clean.endsWith('-');
    if (isNegative) {
        clean = clean.substring(0, clean.length - 1);
    }
    
    // Remove spaces (thousands separator) and replace comma with dot
    clean = clean.replace(/\s/g, '').replace(',', '.');
    
    let num = parseFloat(clean);
    return isNegative ? -Math.abs(num) : num;
  };

  // ===========================================================================
  // 2. METADATA EXTRACTION
  // ===========================================================================
  
  // Account Number (Format: 40-6731-0991 or 4123546519)
  const accountMatch = text.match(/Account Number[:\s]*([\d-]+)/i) || text.match(/(\d{2}-\d{4}-\d{4})/);
  let account = accountMatch ? accountMatch[1].replace(/-/g, '') : "Unknown";

  const clientMatch = text.match(/Cheque Account Number:.*?\n\n(.*?)\n/s) || text.match(/Mr\s+[A-Z\s]+/i);
  const clientName = clientMatch ? clientMatch[1].trim() : "Unknown";

  // Opening Balance (Look for "Balance Brought Forward" in the summary or text)
  let openingBalance = 0;
  // Regex: "Balance Brought Forward" followed by number
  const openMatch = text.match(/Balance Brought Forward\s*([0-9\s,]+-?)/i);
  if (openMatch) {
      openingBalance = parseAbsaNum(openMatch[1]);
  }

  // Closing Balance (Usually in the Summary table at the end)
  let closingBalance = 0;
  // We look for the Summary Table "Balance" (not line items)
  // Strategy: Find "Balance" that is NOT "Balance Brought Forward"
  // Often listed as "Balance [Amount]" at bottom of summary
  const summaryMatch = text.match(/Charges.*?\nBalance\s*([0-9\s,]+-?)/s); 
  if (summaryMatch) {
      closingBalance = parseAbsaNum(summaryMatch[1]);
  }

  // ===========================================================================
  // 3. TEXT CLEANUP & FLATTENING
  // ===========================================================================
  let cleanText = text
    .replace(/\s+/g, ' ') 
    .replace(/Page \d+ of \d+/gi, ' ')
    .replace(/Your transactions/i, ' ')
    .replace(/Balance Brought Forward/i, 'Start_Tracking'); // Rename to avoid parsing as tx

  // ===========================================================================
  // 4. PARSING LOGIC
  // ===========================================================================
  // ABSA Row Pattern: 
  // [Date: DD/MM/YYYY] ... [Desc + Amounts] ... [Balance]
  
  // Regex:
  // 1. Date (DD/MM/YYYY)
  // 2. Middle Content (Greedy match until balance)
  // 3. Balance (Number ending with optional minus)
  
  const absaRegex = /(\d{2}\/\d{2}\/\d{4})\s+(.*?)\s+([0-9\s]+,[0-9]{2}-?)/gi;

  let match;
  let runningBalance = openingBalance;

  while ((match = absaRegex.exec(cleanText)) !== null) {
    const dateStr = match[1];
    let content = match[2].trim();
    const balanceRaw = match[3];

    // Parse Balance
    const finalBalance = parseAbsaNum(balanceRaw);

    // --- BALANCE-DRIVEN EXTRACTION ---
    // Calculate expected amount
    let expectedDiff = finalBalance - runningBalance;
    let expectedAbs = Math.abs(expectedDiff);
    let finalAmount = expectedDiff; // Default to the math

    // Extract Description
    // The "content" variable contains Description + Amount + Charge
    // We need to remove the numbers to get the clean description.
    
    // Strategy: Use the expected amount string to "Cut" the content
    // Convert expectedAbs to ABSA format string (e.g. "1 350,00") to search for it?
    // Harder because of spacing inconsistencies.
    
    // Simpler Strategy: Remove all detected currency-like numbers from content
    let description = content;
    
    // Find all numbers in the content that look like currency (X,XX or X XXX,XX)
    const numbersInDesc = content.match(/([0-9\s]+,[0-9]{2}-?)/g);
    
    if (numbersInDesc) {
        // Find which number matches our expected amount
        const matchNum = numbersInDesc.find(numStr => {
            return Math.abs(parseAbsaNum(numStr) - expectedAbs) < 0.02;
        });

        if (matchNum) {
            // Remove the amount from description
            description = description.replace(matchNum, '');
        } else {
            // If explicit amount not found (maybe merged?), blindly trust math
            // and remove all numbers from end of string
            description = description.replace(/[0-9\s,.-]+$/, '');
        }
    }

    // --- CLEANUP ---
    description = description
        .replace(/Settlement/gi, '') // Common ABSA noise
        .replace(/\d{2}\/\d{2}\/\d{4}/, '') // Remove loose dates
        .replace(/\s+/g, ' ')
        .trim();
        
    // Fix Sign logic based on math (Trust the Balance!)
    // If Balance dropped, it is a Debit (Negative)
    // If Balance rose, it is a Credit (Positive)
    
    // Update tracker
    runningBalance = finalBalance;

    transactions.push({
      date: dateStr,
      description: description,
      amount: finalAmount,
      balance: finalBalance,
      account: account,
      uniqueDocNo: "ABSA-Stmt", // Placeholder
      bankName: "ABSA"
    });
  }

  // ===========================================================================
  // 5. RETURN OBJECT
  // ===========================================================================
  return {
    metadata: {
      accountNumber: account,
      openingBalance: openingBalance,
      closingBalance: closingBalance,
      transactionCount: transactions.length,
      bankName: "ABSA"
    },
    transactions: transactions
  };
};