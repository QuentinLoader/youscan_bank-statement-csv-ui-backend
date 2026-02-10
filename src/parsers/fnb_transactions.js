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
  // Look for the table header to find where transactions start
  const tableHeaderMatch = cleanText.match(/(Date|Datum)\s+(Description|Beskrywing)\s+(Amount|Bedrag)\s+(Balance|Balans)/i);
  if (!tableHeaderMatch) {
    console.warn("Could not find transaction table header");
    return transactions;
  }
  
  const transactionSection = cleanText.substring(tableHeaderMatch.index + tableHeaderMatch[0].length);

  // 4. SPLIT INTO TRANSACTION LINES
  // Match patterns: Date followed by description, amount (with Cr/Dr), and balance
  // Each transaction should have: Date Description Amount(Cr/Dr) Balance
  const transactionPattern = /(\d{2}\/\d{2}\/\d{4}|\d{4}\/\d{2}\/\d{2}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Mrt|Mei|Okt|Des))\s+(.*?)(?=\d{2}\/\d{2}\/\d{4}|\d{4}\/\d{2}\/\d{2}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Mrt|Mei|Okt|Des)|Closing Balance|Page Total|$)/gi;

  const matches = [...transactionSection.matchAll(transactionPattern)];

  for (const match of matches) {
    const dateStr = match[1].trim();
    let dataBlock = match[2].trim();

    // Skip header rows
    const lowerBlock = dataBlock.toLowerCase();
    if (lowerBlock.includes("opening balance") || 
        lowerBlock.includes("brought forward") ||
        lowerBlock.includes("page total") ||
        dataBlock.length < 5) {
      continue;
    }

    // 5. EXTRACT AMOUNTS AND BALANCE FROM THE TRANSACTION LINE
    // Strategy: Find all amounts, then identify which are transaction amounts vs balance
    // Format is typically: Description Amount(Cr/Dr) Balance
    // But amounts can appear in description too, so we need the last two valid amounts
    
    // Match currency amounts (with optional Cr/Dr markers)
    const amountPattern = /\b([\d\s,]+\.\d{2})\s*(Cr|Dr|Kt|Dt)?\b/gi;
    const allAmounts = [...dataBlock.matchAll(amountPattern)];
    
    // Filter out reference numbers (numbers without proper formatting)
    const validAmounts = allAmounts.filter(amt => {
      const numStr = amt[1].replace(/[\s,]/g, '');
      // Must be a reasonable currency amount (not a reference number)
      return numStr.length <= 12 && (amt[1].includes(',') || amt[1].includes(' ') || parseFloat(numStr) < 100000000);
    });

    if (validAmounts.length < 2) {
      continue; // Need at least amount and balance
    }

    // Last amount is balance, second-to-last is transaction amount
    const balanceMatch = validAmounts[validAmounts.length - 1];
    const amountMatch = validAmounts[validAmounts.length - 2];

    // 6. PARSE NUMBERS
    const parseAmount = (matchObj) => {
      const numStr = matchObj[1].replace(/[\s,]/g, '');
      return parseFloat(numStr);
    };

    let amount = parseAmount(amountMatch);
    const balance = parseAmount(balanceMatch);

    // 7. EXTRACT DESCRIPTION (everything before the amount)
    const amountIndex = amountMatch.index;
    let description = dataBlock.substring(0, amountIndex).trim();
    
    // Clean up description
    description = description.replace(/^[\d\s\.,]+/, '').trim();
    description = description.replace(/^(Kt|Dt|Dr|Cr)\s+/i, '').trim();
    description = description.replace(/\s+/g, ' ').trim();

    // 8. DETERMINE SIGN (Credit vs Debit)
    const amountIndicator = amountMatch[2] || '';
    if (amountIndicator.toUpperCase() === 'CR' || amountIndicator.toUpperCase() === 'KT') {
      amount = Math.abs(amount);  // Credit = Positive
    } else {
      amount = -Math.abs(amount); // Debit = Negative
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