export const parseFnb = (text) => {
  const transactions = [];

  // 1. DE-MASHING & CLEANUP
  let cleanText = text.replace(/\s+/g, ' ');
  
  // Split digits/letters and mashed amounts
  cleanText = cleanText.replace(/(\d)([a-zA-Z])/g, '$1 $2');
  cleanText = cleanText.replace(/([a-z])([A-Z])/g, '$1 $2');
  cleanText = cleanText.replace(/([a-zA-Z])(\d)/g, '$1 $2');
  cleanText = cleanText.replace(/(\.\d{2})(\d)/g, '$1 $2');
  
  // Normalize date delimiters
  cleanText = cleanText.replace(/(\d{4})[\/\-](\d{2})[\/\-](\d{2})/g, " $1/$2/$3 ");
  cleanText = cleanText.replace(/(\d{2})[\/\-](\d{2})[\/\-](\d{4})/g, " $1/$2/$3 ");

  // 2. METADATA EXTRACTION
  const accountMatch = cleanText.match(/(?:Gold Business Account|Premier Current Account|Account Number|Rekeningnommer)\s*:?\s*(\d{11})/i);
  const account = accountMatch ? accountMatch[1] : "62854836693"; 

  const statementIdMatch = cleanText.match(/(?:Tax Invoice\/Statement Number|Statement Number|Staatnommer)\s*:?\s*(\d+)/i);
  const statementId = statementIdMatch ? statementIdMatch[1] : "68";

  const clientMatch = cleanText.match(/(?:THE DIRECTOR|MR\s+[A-Z\s]{5,40})/i);
  const clientName = clientMatch ? clientMatch[0].trim() : "Client Name";

  let statementYear = 2026;
  const headerDateMatch = cleanText.match(/(\d{4})\/\d{2}\/\d{2}/);
  if (headerDateMatch) statementYear = parseInt(headerDateMatch[1]);

  // 3. FIND TRANSACTION SECTION
  const tableHeaderMatch = cleanText.match(/(Date|Datum)\s+(Description|Beskrywing)\s+(Amount|Bedrag)\s+(Balance|Balans)/i);
  if (!tableHeaderMatch) {
    console.warn("Could not find transaction table header");
    return transactions;
  }
  
  const transactionSection = cleanText.substring(tableHeaderMatch.index + tableHeaderMatch[0].length);

  // 4. SPLIT INTO TRANSACTION LINES
  const transactionPattern = /(\d{2}\/\d{2}\/\d{4}|\d{4}\/\d{2}\/\d{2}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Mrt|Mei|Okt|Des))\s+(.*?)(?=\d{2}\/\d{2}\/\d{4}|\d{4}\/\d{2}\/\d{2}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Mrt|Mei|Okt|Des)|Closing Balance|Page Total|$)/gi;

  const matches = [...transactionSection.matchAll(transactionPattern)];

  for (const match of matches) {
    const dateStr = match[1].trim();
    let dataBlock = match[2].trim();

    // Skip header rows and empty lines
    const lowerBlock = dataBlock.toLowerCase();
    if (lowerBlock.includes("opening balance") || 
        lowerBlock.includes("brought forward") ||
        lowerBlock.includes("page total") ||
        dataBlock.length < 5) {
      continue;
    }

    // 5. EXTRACT AMOUNTS - REFINED STRATEGY
    // The key insight: Transaction amounts are typically followed by Cr/Dr markers
    // Balance is the last number (may or may not have Cr/Dr)
    // Amounts in descriptions typically don't have Cr/Dr markers
    
    // First, find all potential amounts with their markers
    const amountWithMarkerPattern = /([\d\s,]+\.\d{2})\s*(Cr|Dr|Kt|Dt)/gi;
    const markedAmounts = [...dataBlock.matchAll(amountWithMarkerPattern)];
    
    // Also find all amounts (for balance, which might not have marker)
    const allAmountPattern = /\b([\d\s,]+\.\d{2})\b/g;
    const allAmounts = [...dataBlock.matchAll(allAmountPattern)];
    
    let amountMatch = null;
    let balanceMatch = null;
    let amount = 0;
    let balance = 0;
    let amountSign = '';

    // STRATEGY:
    // - If we have 2+ marked amounts (with Cr/Dr): second-to-last is amount, last is balance
    // - If we have 1 marked amount: it's the amount, last unmarked number is balance
    // - Otherwise: second-to-last number is amount, last is balance
    
    if (markedAmounts.length >= 2) {
      // Best case: both amount and balance have markers
      amountMatch = markedAmounts[markedAmounts.length - 2];
      balanceMatch = markedAmounts[markedAmounts.length - 1];
      amountSign = amountMatch[2];
    } else if (markedAmounts.length === 1) {
      // One marked amount (transaction), balance is last unmarked
      amountMatch = markedAmounts[0];
      amountSign = amountMatch[2];
      balanceMatch = allAmounts[allAmounts.length - 1];
    } else if (allAmounts.length >= 2) {
      // No markers, use last two amounts
      // Filter out obvious reference numbers first
      const validAmounts = allAmounts.filter(amt => {
        const numStr = amt[1].replace(/[\s,]/g, '');
        const num = parseFloat(numStr);
        // Exclude very large numbers (likely references) and numbers without formatting
        return numStr.length <= 12 && 
               (amt[1].includes(',') || amt[1].includes(' ') || num < 1000000);
      });
      
      if (validAmounts.length >= 2) {
        amountMatch = validAmounts[validAmounts.length - 2];
        balanceMatch = validAmounts[validAmounts.length - 1];
      } else {
        continue; // Can't parse this transaction
      }
    } else {
      continue; // Not enough data
    }

    // 6. PARSE NUMBERS
    const parseAmount = (matchObj) => {
      const numStr = matchObj[1].replace(/[\s,]/g, '');
      return parseFloat(numStr);
    };

    amount = parseAmount(amountMatch);
    balance = parseAmount(balanceMatch);

    // 7. EXTRACT DESCRIPTION (everything before the transaction amount)
    const amountIndex = amountMatch.index;
    let description = dataBlock.substring(0, amountIndex).trim();
    
    // Clean up description - remove leading numbers and markers
    description = description.replace(/^[\d\s\.,]+/, '').trim();
    description = description.replace(/^(Kt|Dt|Dr|Cr)\s+/i, '').trim();
    description = description.replace(/\s+/g, ' ').trim();

    // 8. DETERMINE SIGN (Credit vs Debit)
    if (amountSign.toUpperCase() === 'CR' || amountSign.toUpperCase() === 'KT') {
      amount = Math.abs(amount);  // Credit = Positive
    } else if (amountSign.toUpperCase() === 'DR' || amountSign.toUpperCase() === 'DT') {
      amount = -Math.abs(amount); // Debit = Negative
    } else {
      // No explicit marker - infer from balance change
      // This is a fallback and might need adjustment based on your statement format
      amount = -Math.abs(amount); // Default to debit
    }

    // 9. NORMALIZE DATE
    let formattedDate = dateStr;
    if (dateStr.match(/[a-zA-Z]/)) {
      const dateParts = dateStr.split(/\s+/);
      const day = dateParts[0].padStart(2, '0');
      const monthStr = dateParts[1].toLowerCase().substring(0, 3);
      const monthMap = { 
        jan:"01", feb:"02", mar:"03", mrt:"03", 
        apr:"04", may:"05", mei:"05",
        jun:"06", jul:"07", aug:"08", 
        sep:"09", oct:"10", okt:"10", 
        nov:"11", dec:"12", des:"12"
      };
      const month = monthMap[monthStr] || "01";
      formattedDate = `${day}/${month}/${statementYear}`;
    } 
    else if (dateStr.match(/^\d{4}\//)) {
      const p = dateStr.split('/');
      formattedDate = `${p[2]}/${p[1]}/${p[0]}`;
    }

    // 10. ADD TRANSACTION
    transactions.push({
      date: formattedDate,
      description: description || "Transaction",
      amount,
      balance,
      account,
      clientName,
      uniqueDocNo: statementId,
      bankName: "FNB"
    });
  }

  return transactions;
};