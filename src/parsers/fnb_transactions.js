/**
 * FNB "Anchor & Look-Back" Parser
 * * Strategy:
 * 1. Find the FINANCIALS first (Amount + Balance pair).
 * 2. Look BACKWARDS from the financial match to find the nearest DATE.
 * 3. The text in between is the DESCRIPTION.
 * * This solves the issue where text merging ("Ref1234500.00") breaks forward-looking regexes.
 */

export const parseFnb = (text) => {
  const transactions = [];

  // ===========================================================================
  // 1. METADATA EXTRACTION (Robust Mode)
  // ===========================================================================
  // Account Number: Look for 11 digits anywhere near "Account"
  const accountMatch = text.match(/Account\D*(\d{11})/i) || text.match(/(\d{11})/);
  const account = accountMatch ? accountMatch[1] : "Unknown";

  // Statement ID: BBST followed by digits
  const statementIdMatch = text.match(/BBST(\d+)/i);
  const uniqueDocNo = statementIdMatch ? statementIdMatch[1] : "Unknown";

  // Client Name: Look for "PROPERTIES" or "LIVING BRANCH"
  const clientMatch = text.match(/\*([A-Z\s\(\)\.\-]+(?:PROPERTIES|LIVING|TRADING|LTD|PTY)[A-Z\s\(\)\.\-]*)/i);
  const clientName = clientMatch ? clientMatch[1].trim() : "Unknown Client";

  // Determine Statement Year from Header (YYYY/MM/DD)
  let currentYear = new Date().getFullYear();
  const headerDateMatch = text.match(/20\d{2}\/\d{2}\/\d{2}/); 
  if (headerDateMatch) {
    currentYear = parseInt(headerDateMatch[0].substring(0, 4), 10);
  }

  // ===========================================================================
  // 2. TEXT CLEANUP
  // ===========================================================================
  // Normalize whitespace but KEEP textual relationships
  let cleanText = text
    .replace(/Page \d+ of \d+/gi, ' ') 
    .replace(/Delivery Method[^\n]*/gi, ' ')
    .replace(/Branch Number[^\n]*/gi, ' ') 
    .replace(/\s+/g, ' '); // Collapse spaces

  // ===========================================================================
  // 3. TRANSACTION PARSING (Financial Anchor)
  // ===========================================================================
  
  // We look for the ending sequence of a transaction:
  // [Amount] [Cr/Dr]? [Balance] [Cr/Dr]? [Fee?]
  // Regex: 
  // Group 1: Amount
  // Group 2: Amount Sign
  // Group 3: Balance
  // Group 4: Balance Sign
  // Group 5: Fee (Optional)
  
  const financialRegex = /([0-9,]+\.[0-9]{2})(Cr|Dr)?\s+([0-9,]+\.[0-9]{2})(Cr|Dr)?(?:\s+([0-9,]+\.[0-9]{2})(Cr|Dr)?)?/gi;

  let match;
  let lastEndIndex = 0; // Track where the last transaction ended

  while ((match = financialRegex.exec(cleanText)) !== null) {
    // We found a financial block. Now let's analyze the text BEFORE it.
    // The "Search Area" is from the end of the previous transaction to the start of this one.
    
    // Safety check: limit search area to ~200 chars to avoid grabbing huge chunks of header text
    let searchStart = Math.max(lastEndIndex, match.index - 200);
    let rawSegment = cleanText.substring(searchStart, match.index).trim();
    
    // Update lastEndIndex for the next loop (start searching after this match)
    lastEndIndex = financialRegex.lastIndex;

    // --- FIND DATE IN SEGMENT ---
    // We look for the DATE that starts this transaction.
    // It should be near the beginning of `rawSegment`.
    
    // Patterns: "DD Mon" (20 Jan) OR "YYYY/MM/DD"
    // Note: We use \b to ensure we don't match inside a word, but sloppy PDF text might need relaxation.
    
    let dateStr = "";
    let description = rawSegment;
    
    // Regex 1: DD Mon (e.g. 20 Jan, 03 Feb)
    const datePattern = /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i;
    let dateMatch = rawSegment.match(datePattern);
    
    // Regex 2: YYYY/MM/DD (e.g. 2025/01/20)
    if (!dateMatch) {
       dateMatch = rawSegment.match(/(\d{4})\/(\d{2})\/(\d{2})/);
    }

    if (dateMatch) {
        // We found a date! 
        // The description is everything AFTER this date in the segment.
        // (And sometimes text appears BEFORE the date in FNB PDFs, but usually it's Date -> Desc)
        
        // Let's extract the date string and normalize it
        if (dateMatch[2].length === 3) { 
            // It's DD Mon
            const day = dateMatch[1].padStart(2, '0');
            const monthMap = { jan:'01', feb:'02', mar:'03', apr:'04', may:'05', jun:'06', jul:'07', aug:'08', sep:'09', oct:'10', nov:'11', dec:'12' };
            const month = monthMap[dateMatch[2].toLowerCase()];
            
            // Year Logic
            let txYear = currentYear;
            if (month === '12' && new Date().getMonth() < 3) txYear = currentYear - 1;
            
            dateStr = `${day}/${month}/${txYear}`;
        } else {
            // It's YYYY/MM/DD
            dateStr = `${dateMatch[3]}/${dateMatch[2]}/${dateMatch[1]}`; // Convert to DD/MM/YYYY
        }
        
        // Remove the date from the description text
        // We also remove anything *before* the date (likely garbage from previous line)
        const dateIndex = rawSegment.indexOf(dateMatch[0]);
        description = rawSegment.substring(dateIndex + dateMatch[0].length).trim();
        
    } else {
        // No date found in the text segment.
        // This is likely a "Balance Brought Forward" line or garbage.
        // If it's a valid transaction without a date, we default to 01/01/Year or skip.
        if (!description.toLowerCase().includes("balance")) continue; 
        dateStr = `01/01/${currentYear}`;
    }

    // --- PARSE FINANCIALS ---
    const amountStr = match[1];
    const amountSign = match[2]; // Cr or Dr
    const balanceStr = match[3];
    const feeStr = match[5]; // Optional Fee

    let amount = parseFloat(amountStr.replace(/,/g, ''));
    let balance = parseFloat(balanceStr.replace(/,/g, ''));
    let fee = feeStr ? parseFloat(feeStr.replace(/,/g, '')) : 0;

    // FNB Logic: Cr = Income (+), Dr/Null = Expense (-)
    // BUT: If the description is "Opening Balance", we skip or handle differently.
    if (description.toLowerCase().includes("opening balance")) continue;

    if (amountSign === 'Cr') {
        amount = Math.abs(amount);
    } else {
        amount = -Math.abs(amount);
    }

    // --- CLEANUP ---
    description = description
        .replace(/^\s*[\d\.,-]+\s*/, '') // Remove loose numbers at start
        .replace(/\s+/g, ' ')            // Fix spaces
        .trim();

    if (description.length < 3) continue; // Skip empty descriptions

    transactions.push({
      date: dateStr,
      description: description,
      amount: amount,
      balance: balance,
      fee: fee,
      account: account,
      bankName: "FNB",
      bankLogo: "fnb",
      clientName: clientName,
      uniqueDocNo: uniqueDocNo
    });
  }

  return transactions;
};