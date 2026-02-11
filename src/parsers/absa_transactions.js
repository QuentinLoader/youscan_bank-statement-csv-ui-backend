/**
 * ABSA Parser - Production Ready
 * Handles both line-by-line and condensed PDF text extraction formats
 * Fixes: Date parsing, multi-line descriptions, footer leaks, number formatting
 */

export const parseAbsa = (text) => {
  const transactions = [];

  // Helper function for parsing South African number format
  const parseNum = (val) => {
    if (!val) return 0;
    let clean = val.trim();
    
    // Check for negative indicator (trailing or leading -)
    let isNeg = clean.endsWith('-') || clean.startsWith('-');
    
    // Remove all non-numeric except comma and period
    clean = clean.replace(/[^0-9,.]/g, '');
    
    // South African format: "1 382,23" -> replace comma with period
    if (clean.includes(',')) {
      clean = clean.replace(',', '.');
    }
    
    const num = parseFloat(clean) || 0;
    return isNeg ? -Math.abs(num) : num;
  };

  // Pre-process: Add spaces between letters and numbers
  let cleanText = text
    .replace(/([a-zA-Z])([0-9])/g, '$1 $2')
    .replace(/([0-9])([a-zA-Z])/g, '$1 $2')
    .replace(/(\.\d{2})([0-9])/g, '$1 $2'); // Fix merged amounts

  // Extract account number
  const accountMatch = text.match(/(\d{2}[-\s]?\d{4}[-\s]?\d{4})/) || 
                      text.match(/Account.*?(\d{10,})/i);
  let account = accountMatch ? accountMatch[1].replace(/[-\s]/g, '') : "Unknown";

  // Extract opening balance
  let openingBalance = 0;
  const openMatch = cleanText.match(/Balance Brought Forward\s*([0-9\s,.]+[-]?)/i);
  if (openMatch) {
    openingBalance = parseNum(openMatch[1]);
  }

  // Extract closing balance  
  let closingBalance = 0;
  const closeMatch = cleanText.match(/Charges\s*([0-9\s,.]+[-]?)\s*Balance\s*([0-9\s,.]+[-]?)/i);
  if (closeMatch) {
    closingBalance = parseNum(closeMatch[2]);
  }

  // Footer detection
  const footerStopWords = [
    "Our Privacy Notice",
    "Page 1",
    "Page 2",
    "ABSA Bank Limited",
    "Tax Invoice",
    "Authorised Financial Services",
    "Registration Number",
    "Vat Registration",
    "CREDIT INTEREST RATE",
    "SERVICE FEE:",
    "MNTHLY ACCT FEE",
    "ABSA BUSINESS BANKING",
    "ABSA: OUR UPDATED",
    "YOUR PRICING PLAN",
    "CHARGE: A = ADMINISTRATION",
    "* = VAT R",
    "Cheque account statement",
    "Return address"
  ];

  // Check if footer text exists
  const hasFooter = (content) => {
    return footerStopWords.some(word => content.includes(word));
  };

  // Split by date pattern
  const chunks = cleanText.split(/(?=\d{1,2}\/\d{2}\/\d{4})/);
  let runningBalance = openingBalance;

  chunks.forEach((chunk, index) => {
    // Match date at start of chunk
    let dateMatch = chunk.match(/^(\d{1,2})\/(\d{2})\/(\d{4})/);
    if (!dateMatch) return;

    // Parse date - fix potential single digit day issue
    let day = dateMatch[1];
    
    // Fix the "12th" bug where "2" from "12" ends up in next chunk
    if (day.length === 1 && index > 0) {
      const prevChunk = chunks[index - 1].trim();
      // Check if previous chunk ends with a digit (could be first digit of day)
      const lastChar = prevChunk[prevChunk.length - 1];
      if (lastChar >= '0' && lastChar <= '9' && lastChar !== '0') {
        day = lastChar + day;
      }
    }

    const dateStr = `${day.padStart(2, '0')}/${dateMatch[2]}/${dateMatch[3]}`;
    let rawContent = chunk.substring(dateMatch[0].length).trim();
    
    // Skip Balance Brought Forward
    if (rawContent.toLowerCase().includes("balance brought forward") ||
        rawContent.toLowerCase().includes("bal brought forward")) {
      transactions.push({
        date: dateStr,
        description: "Bal Brought Forward",
        amount: 0,
        balance: runningBalance,
        account: account,
        bankName: "ABSA"
      });
      return;
    }

    // Check for footer - stop processing this chunk
    if (hasFooter(rawContent)) {
      // Extract content before footer
      let cleanContent = rawContent;
      for (const stopWord of footerStopWords) {
        const idx = rawContent.indexOf(stopWord);
        if (idx !== -1) {
          cleanContent = rawContent.substring(0, idx);
          break;
        }
      }
      rawContent = cleanContent;
      
      // If no content left, skip
      if (rawContent.trim().length === 0) return;
    }

    // Extract all numbers
    const numRegex = /([0-9\s]+[.,][0-9]{2}[-]?)/g;
    const allNums = rawContent.match(numRegex) || [];
    
    if (allNums.length === 0) return;

    let finalAmount = 0;
    let currentBalance = runningBalance;
    let matchedBalanceStr = "";
    let matchedAmountStr = "";

    // Method 1: Try to find balance using running balance calculation
    for (let i = allNums.length - 1; i >= 0; i--) {
      let balCandidate = parseNum(allNums[i]);
      
      for (let j = i - 1; j >= 0; j--) {
        let amtCandidate = parseNum(allNums[j]);
        
        // Check if: runningBalance + amount ≈ balance
        if (Math.abs(runningBalance + amtCandidate - balCandidate) < 0.05) {
          finalAmount = amtCandidate;
          currentBalance = balCandidate;
          matchedAmountStr = allNums[j];
          matchedBalanceStr = allNums[i];
          break;
        }
      }
      
      if (matchedBalanceStr) break;
    }

    // Method 2: If math fails, use rightmost number as balance
    if (!matchedBalanceStr && allNums.length >= 1) {
      currentBalance = parseNum(allNums[allNums.length - 1]);
      matchedBalanceStr = allNums[allNums.length - 1];
      
      // Try to get amount from second-to-last
      if (allNums.length >= 2) {
        const potentialAmount = parseNum(allNums[allNums.length - 2]);
        if (Math.abs(runningBalance + potentialAmount - currentBalance) < 0.05) {
          finalAmount = potentialAmount;
          matchedAmountStr = allNums[allNums.length - 2];
        } else {
          // Calculate from balance change
          finalAmount = currentBalance - runningBalance;
        }
      } else {
        finalAmount = currentBalance - runningBalance;
      }
    }

    // Extract description
    let description = rawContent;
    
    // Remove the matched numbers
    if (matchedBalanceStr) {
      description = description.replace(matchedBalanceStr, '');
    }
    if (matchedAmountStr) {
      description = description.replace(matchedAmountStr, '');
    }
    
    // Remove all remaining numbers
    description = description.replace(numRegex, '');
    
    // Clean description
    description = description
      .replace(/Settlement/gi, ' ')
      .replace(/Headoffice/gi, ' ')
      .replace(/Notifyme/gi, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^[\s\W]+/, '')
      .replace(/[\s\W]+$/, '')
      .trim();

    runningBalance = currentBalance;

    transactions.push({
      date: dateStr,
      description: description || "Transaction",
      amount: finalAmount,
      balance: currentBalance,
      account: account,
      bankName: "ABSA"
    });
  });

  return {
    metadata: {
      accountNumber: account,
      openingBalance,
      closingBalance,
      bankName: "ABSA"
    },
    transactions
  };
};