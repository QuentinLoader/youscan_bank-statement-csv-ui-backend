/**
 * ABSA Parser (Enhanced Version)
 * Fixes: Date parsing errors, multi-line descriptions, footer leaks, South African number formatting
 */

export const parseAbsa = (text) => {
  const transactions = [];

  // 1. Helper function for parsing South African number format
  const parseNum = (val) => {
    if (!val) return 0;
    let clean = val.trim();
    
    // Check for negative indicator (trailing or leading -)
    let isNeg = clean.endsWith('-') || clean.startsWith('-');
    
    // Remove all non-numeric except comma and period
    clean = clean.replace(/[^0-9,.]/g, '');
    
    // Handle South African format: "1 382,23" -> 1382.23
    // Replace comma with period for decimal point
    if (clean.includes(',')) {
      clean = clean.replace(',', '.');
    }
    
    const num = parseFloat(clean) || 0;
    return isNeg ? -Math.abs(num) : num;
  };

  // 2. Metadata Extraction
  const accountMatch = text.match(/Account Number:\s*([\d-]+)/i) || 
                      text.match(/(\d{2}[-\s]?\d{4}[-\s]?\d{4})/);
  let account = accountMatch ? accountMatch[1].replace(/[-\s]/g, '') : "Unknown";

  // Extract opening balance from Account Summary
  let openingBalance = 0;
  const openMatch = text.match(/Balance Brought Forward\s+([0-9\s,.]+[-]?)/i);
  if (openMatch) openingBalance = parseNum(openMatch[1]);

  // Extract closing balance from Account Summary
  let closingBalance = 0;
  const closeMatch = text.match(/Charges\s+[0-9\s,.]+[-]?\s+Balance\s+([0-9\s,.]+[-]?)/i);
  if (closeMatch) closingBalance = parseNum(closeMatch[1]);

  // 3. Enhanced footer detection
  const footerStopWords = [
    "Our Privacy Notice",
    "Page 1 of",
    "Page 2 of",
    "ABSA Bank Limited",
    "Tax Invoice",
    "Authorised Financial Services Provider",
    "Registration Number",
    "Vat Registration Number",
    "CREDIT INTEREST RATE",
    "SERVICE FEE:",
    "MNTHLY ACCT FEE",
    "ABSA BUSINESS BANKING",
    "ABSA: OUR UPDATED",
    "YOUR PRICING PLAN",
    "CHARGE: A = ADMINISTRATION",
    "* = VAT",
    "Return address",
    "Cheque account statement"
  ];

  // 4. Line-by-line parsing approach
  const lines = text.split('\n');
  let inTransactionSection = false;
  let currentTransaction = null;
  let runningBalance = openingBalance;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Detect transaction section start
    if (line.includes('Your transactions')) {
      inTransactionSection = true;
      continue;
    }
    
    // Skip header row
    if (line.match(/^Date\s+Transaction Description/i)) {
      continue;
    }
    
    if (!inTransactionSection) continue;
    
    // Check for footer - stop processing
    let hitFooter = false;
    for (const stopWord of footerStopWords) {
      if (line.includes(stopWord)) {
        hitFooter = true;
        break;
      }
    }
    
    if (hitFooter) {
      if (currentTransaction) {
        transactions.push(currentTransaction);
        currentTransaction = null;
      }
      break;
    }
    
    // Match date pattern at start of line (handles both D/MM/YYYY and DD/MM/YYYY)
    const dateMatch = line.match(/^(\d{1,2})\/(\d{2})\/(\d{4})/);
    
    if (dateMatch) {
      // Save previous transaction
      if (currentTransaction) {
        transactions.push(currentTransaction);
      }
      
      // Parse date
      const day = dateMatch[1].padStart(2, '0');
      const month = dateMatch[2];
      const year = dateMatch[3];
      const dateStr = `${day}/${month}/${year}`;
      
      // Get remainder of line after date
      const afterDate = line.substring(dateMatch[0].length).trim();
      
      // Skip "Balance Brought Forward" entry
      if (afterDate.toLowerCase().includes("bal brought forward")) {
        currentTransaction = {
          date: dateStr,
          description: "Bal Brought Forward",
          amount: 0,
          balance: runningBalance,
          account: account,
          bankName: "ABSA"
        };
        continue;
      }
      
      // Extract all numbers from the line
      const numRegex = /([0-9\s]+[.,][0-9]{2}[-]?)/g;
      const allNums = afterDate.match(numRegex) || [];
      
      if (allNums.length === 0) {
        // No numbers found, just description
        currentTransaction = {
          date: dateStr,
          description: afterDate.replace(/\s+/g, ' ').trim(),
          amount: 0,
          balance: runningBalance,
          account: account,
          bankName: "ABSA"
        };
        continue;
      }
      
      // Parse numbers systematically from right to left
      let balance = runningBalance;
      let credit = 0;
      let debit = 0;
      let amount = 0;
      
      // Balance is typically the last number
      if (allNums.length >= 1) {
        balance = parseNum(allNums[allNums.length - 1]);
      }
      
      // Credit is second-to-last (if it's a positive number)
      if (allNums.length >= 2) {
        const potentialCredit = allNums[allNums.length - 2];
        if (!potentialCredit.includes('-')) {
          const val = parseNum(potentialCredit);
          if (val > 0) {
            credit = val;
          }
        }
      }
      
      // Debit is third-to-last
      if (allNums.length >= 3 && credit === 0) {
        const potentialDebit = allNums[allNums.length - 2];
        const val = parseNum(potentialDebit);
        if (val !== 0) {
          debit = Math.abs(val);
        }
      }
      
      // Calculate transaction amount
      if (credit > 0) {
        amount = credit;
      } else if (debit > 0) {
        amount = -debit;
      } else {
        // Fallback: calculate from balance change
        amount = balance - runningBalance;
      }
      
      // Extract description (remove all numbers)
      let description = afterDate;
      allNums.forEach(num => {
        description = description.replace(num, '');
      });
      
      // Clean description
      description = description
        .replace(/Settlement/gi, '')
        .replace(/Headoffice/gi, '')
        .replace(/Notifyme/gi, '')
        .replace(/\s+/g, ' ')
        .replace(/^\W+/, '')
        .replace(/\W+$/, '')
        .trim();
      
      currentTransaction = {
        date: dateStr,
        description: description || "Transaction",
        amount: amount,
        balance: balance,
        account: account,
        bankName: "ABSA"
      };
      
      runningBalance = balance;
      
    } else if (currentTransaction && line.length > 0) {
      // Continuation line - add to description
      let isFooter = false;
      for (const stopWord of footerStopWords) {
        if (line.includes(stopWord)) {
          isFooter = true;
          break;
        }
      }
      
      if (!isFooter) {
        // Don't add lines that are just numbers
        if (!line.match(/^[0-9\s,.-]+$/)) {
          const cleaned = line
            .replace(/Settlement/gi, '')
            .replace(/Headoffice/gi, '')
            .replace(/Notifyme/gi, '')
            .trim();
          
          if (cleaned.length > 0) {
            currentTransaction.description += ' ' + cleaned;
          }
        }
      }
    }
  }
  
  // Add final transaction
  if (currentTransaction) {
    transactions.push(currentTransaction);
  }
  
  // Final cleanup pass on all descriptions
  transactions.forEach(txn => {
    txn.description = txn.description
      .replace(/\s+/g, ' ')
      .trim();
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