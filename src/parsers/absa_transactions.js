/**
 * ABSA Parser (Date-Split Strategy)
 * * Strategy:
 * 1. Metadata: handled with relaxed regex for mashed text ("Forward0,00").
 * 2. Segmentation: Split text by Date Pattern (DD/MM/YYYY).
 * 3. Extraction: Find all numbers in the chunk. Use "Balance Math" to identify the correct Amount.
 */

export const parseAbsa = (text) => {
  const transactions = [];

  // ===========================================================================
  // 1. HELPER: ABSA NUMBER PARSER
  // ===========================================================================
  const parseAbsaNum = (val) => {
    if (!val) return 0;
    let clean = val.trim();
    
    // Handle trailing minus (100.00-)
    let isNegative = clean.endsWith('-');
    if (isNegative) clean = clean.substring(0, clean.length - 1);
    
    // Remove spaces (thousands) and replace comma with dot
    // Regex: Remove all non-numeric chars except comma and dot
    clean = clean.replace(/[^0-9,.]/g, '').replace(',', '.');
    
    let num = parseFloat(clean);
    return isNegative ? -Math.abs(num) : num;
  };

  // ===========================================================================
  // 2. METADATA EXTRACTION
  // ===========================================================================
  const accountMatch = text.match(/Account\D*?([\d-]{10,})/i) || text.match(/(\d{2}-\d{4}-\d{4})/);
  let account = accountMatch ? accountMatch[1].replace(/-/g, '') : "Unknown";

  // Opening Balance - Fix for mashed "Forward0,00"
  let openingBalance = 0;
  // Look for "Balance Brought Forward" followed immediately by potential number
  const openMatch = text.match(/Balance Brought Forward\D*?([0-9\s]+,[0-9]{2}-?)/i);
  if (openMatch) {
      openingBalance = parseAbsaNum(openMatch[1]);
  }

  // Closing Balance - Look for "Balance" in summary block
  let closingBalance = 0;
  const summaryMatch = text.match(/Charges\D*?Balance\s*([0-9\s]+,[0-9]{2}-?)/is);
  if (summaryMatch) {
      closingBalance = parseAbsaNum(summaryMatch[1]);
  }

  // ===========================================================================
  // 3. TRANSACTION PARSING (Date-Split)
  // ===========================================================================
  let cleanText = text
    .replace(/\s+/g, ' ') 
    .replace(/Page \d+ of \d+/gi, ' ');

  // Split by Date Pattern: Lookahead for DD/MM/YYYY
  // This creates an array where each item starts with a date
  const chunks = cleanText.split(/(?=\d{2}\/\d{2}\/\d{4})/);

  let runningBalance = openingBalance;

  chunks.forEach(chunk => {
    // 1. Validate Chunk starts with Date
    const dateMatch = chunk.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (!dateMatch) return; // Skip headers/garbage

    const dateStr = `${dateMatch[1]}/${dateMatch[2]}/${dateMatch[3]}`;
    let rawContent = chunk.substring(10).trim(); // Remove date from start

    // Skip "Balance Brought Forward" lines if they were caught by split
    if (rawContent.toLowerCase().includes("balance brought forward")) return;

    // 2. SCAVENGE NUMBERS
    // Find all strings that look like ABSA numbers: "1 234,56" or "50,00-"
    // Regex: Digits, optional spaces, comma, 2 digits, optional minus
    const numRegex = /(\d{1,3}(?: \d{3})*,\d{2}-?)/g;
    const numbersFound = rawContent.match(numRegex);

    if (!numbersFound || numbersFound.length === 0) return;

    // 3. BALANCE LOGIC
    // The LAST number in the row is almost certainly the Balance.
    const candidateBalanceStr = numbersFound[numbersFound.length - 1];
    const currentBalance = parseAbsaNum(candidateBalanceStr);

    // Calculate the Amount based on math
    const mathDiff = currentBalance - runningBalance;
    const mathAbs = Math.abs(mathDiff);

    let finalAmount = 0;
    let amountStrFound = null;

    // 4. FIND AMOUNT
    // Does our calculated 'mathDiff' match any of the other numbers found?
    // We search the array (excluding the last one which is the balance)
    const potentialAmounts = numbersFound.slice(0, -1);
    
    // Try to find exact match
    const matchIndex = potentialAmounts.findIndex(numStr => {
        return Math.abs(parseAbsaNum(numStr) - mathAbs) < 0.02;
    });

    if (matchIndex !== -1) {
        // Found it! Logic matches text.
        finalAmount = mathDiff; // Trust the math for sign
        amountStrFound = potentialAmounts[matchIndex];
    } else {
        // Math didn't match perfectly.
        // Fallback: Take the last number before the balance?
        // Or trust the math blindly if we are confident?
        // Let's trust the math if it's non-zero.
        if (potentialAmounts.length > 0) {
            // Take the largest number? Or the one right before balance?
            // Usually Amount is right before Balance.
            // But ABSA has "Charges" column too.
            // Let's trust the math. It auto-corrects signs.
            finalAmount = mathDiff;
        } else {
           // Only one number found (The balance itself)?
           // Then no transaction amount? Skip.
           return;
        }
    }

    // 5. EXTRACT DESCRIPTION
    // Remove the Balance string
    let description = rawContent.replace(candidateBalanceStr, '');
    
    // Remove the Amount string if we found it
    if (amountStrFound) {
        description = description.replace(amountStrFound, '');
    } else {
        // If we didn't find specific string, remove all numbers to be safe
        description = description.replace(numRegex, '');
    }

    // Cleanup
    description = description
        .replace(/Settlement/gi, '') 
        .replace(/^[\d\-\.,\s]+/, '') // Remove leading number junk
        .trim();

    // Update Tracker
    runningBalance = currentBalance;

    transactions.push({
      date: dateStr,
      description: description || "Transaction",
      amount: finalAmount,
      balance: currentBalance,
      account: account,
      uniqueDocNo: "ABSA-Stmt"
    });
  });

  // ===========================================================================
  // 4. RETURN OBJECT
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