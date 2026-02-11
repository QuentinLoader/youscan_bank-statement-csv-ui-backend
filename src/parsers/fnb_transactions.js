/**
 * FNB "Money-First" Parser (Final Robust Version)
 * * Strategy:
 * 1. Anchors on the [Amount + Balance] pair (the most stable pattern).
 * 2. Looks backwards to find the Date (handles "Date Desc" AND "Desc Date" layouts).
 * 3. "Strict Slice": Aggressively fixes merged reference numbers (e.g. "Ref500423...3500.00").
 * 4. "Balance-Aware": Verifies amounts against running balance where possible.
 */

export const parseFnb = (text) => {
  const transactions = [];

  // ===========================================================================
  // 1. METADATA
  // ===========================================================================
  const accountMatch = text.match(/Account\D*?(\d{11})/i) || text.match(/(\d{11})/);
  const account = accountMatch ? accountMatch[1] : "Unknown";

  const statementIdMatch = text.match(/BBST(\d+)/i);
  const uniqueDocNo = statementIdMatch ? statementIdMatch[1] : "Unknown";

  const clientMatch = text.match(/\*?([A-Z\s\.]+(?:PROPERTIES|LIVING|TRADING|LTD|PTY)[A-Z\s\.]*)/i);
  const clientName = clientMatch ? clientMatch[1].trim() : "Unknown";

  let currentYear = new Date().getFullYear();
  const dateHeader = text.match(/(20\d{2})\/\d{2}\/\d{2}/);
  if (dateHeader) currentYear = parseInt(dateHeader[1]);

  // Opening Balance (for tracking)
  let runningBalance = null;
  const openingMatch = text.match(/Opening Balance\s*([0-9,]+\.[0-9]{2})\s*(Cr|Dr)?/i);
  if (openingMatch) {
      let val = parseFloat(openingMatch[1].replace(/,/g, ''));
      if (openingMatch[2] !== 'Cr') val = -Math.abs(val);
      runningBalance = val;
  }

  // ===========================================================================
  // 2. TEXT CLEANUP
  // ===========================================================================
  // Flatten text but keep structure simple
  let cleanText = text
    .replace(/\s+/g, ' ') 
    .replace(/Page \d+ of \d+/gi, ' ') 
    .replace(/Transactions in RAND/i, ' ')
    .replace(/Statement Balances/i, ' '); // Remove header near first tx

  // ===========================================================================
  // 3. PARSING (Money-First Strategy)
  // ===========================================================================
  // We look for: [Amount] [Sign?] [Balance] [Sign?]
  // And we capture the *Preceding Text* to find Date/Desc.
  
  const moneyRegex = /([0-9\s,]+\.[0-9]{2})\s*(Cr|Dr)?\s*([0-9\s,]+\.[0-9]{2})\s*(Cr|Dr)?/gi;

  let match;
  let lastIndex = 0;

  while ((match = moneyRegex.exec(cleanText)) !== null) {
    // 1. Extract Financials
    let amountRaw = match[1].replace(/[\s,]/g, '');
    const amountSign = match[2];
    let balanceRaw = match[3].replace(/[\s,]/g, '');
    const balanceSign = match[4];

    // 2. Extract Preceding Text (Candidate for Date & Desc)
    // We look at text between the last match's end and this match's start.
    // Limit lookback to ~300 chars to avoid grabbing headers.
    let startIndex = Math.max(lastIndex, match.index - 300);
    let rawSegment = cleanText.substring(startIndex, match.index).trim();
    
    // Update index for next loop
    lastIndex = moneyRegex.lastIndex;

    // Skip if it's just "Opening Balance"
    if (rawSegment.toLowerCase().includes("opening balance")) continue;
    if (rawSegment.length < 2) continue; // Garbage match

    // 3. Find Date in the Segment
    // Patterns: "17 Jan" OR "2025/01/17"
    let dateStr = "";
    let description = rawSegment;
    
    const dateMatch = rawSegment.match(/(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i) 
                   || rawSegment.match(/(\d{4})\/(\d{2})\/(\d{2})/);

    if (dateMatch) {
        if (dateMatch[2].length === 3) { // DD Mon
             const day = dateMatch[1].padStart(2, '0');
             const months = { Jan:'01', Feb:'02', Mar:'03', Apr:'04', May:'05', Jun:'06', Jul:'07', Aug:'08', Sep:'09', Oct:'10', Nov:'11', Dec:'12' };
             const month = months[dateMatch[2]] || months[dateMatch[2].substring(0,3)];
             
             let txYear = currentYear;
             if (month === '12' && new Date().getMonth() < 3) txYear = currentYear - 1;
             dateStr = `${day}/${month}/${txYear}`;
        } else { // YYYY/MM/DD
             dateStr = `${dateMatch[3]}/${dateMatch[2]}/${dateMatch[1]}`;
        }
        // Remove Date from Description
        description = description.replace(dateMatch[0], "").trim();
    } else {
        // No date found. Likely "Balance Brought Forward" or garbage.
        // If it's a valid transaction line without date, use 01/01/YYYY or skip.
        // For FNB, every transaction usually has a date.
        // If we missed it, it might be mashed "17Jan".
        const mashedDate = rawSegment.match(/(\d{1,2})(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i);
        if (mashedDate) {
             const day = mashedDate[1].padStart(2, '0');
             const months = { Jan:'01', Feb:'02', Mar:'03', Apr:'04', May:'05', Jun:'06', Jul:'07', Aug:'08', Sep:'09', Oct:'10', Nov:'11', Dec:'12' };
             const month = months[mashedDate[2]] || months[mashedDate[2].substring(0,3)];
             let txYear = currentYear;
             if (month === '12' && new Date().getMonth() < 3) txYear = currentYear - 1;
             dateStr = `${day}/${month}/${txYear}`;
             description = description.replace(mashedDate[0], "").trim();
        } else {
             // Skip if strictly no date and not meaningful
             if (!description.toLowerCase().includes("balance")) continue;
             dateStr = `01/01/${currentYear}`;
        }
    }

    // 4. Process Amounts & Logic
    let finalAmount = parseFloat(amountRaw);
    let finalBalance = parseFloat(balanceRaw);
    
    // Balance Sign
    if (balanceSign === 'Dr') finalBalance = -Math.abs(finalBalance);
    else finalBalance = Math.abs(finalBalance);

    // Amount Sign (Default)
    let isCredit = (amountSign === 'Cr');
    
    // --- MERGED NUMBER FIX (Strict Slice) ---
    // Fixes "50042353793500.00" -> "3500.00"
    // Rule: If Amount > 1 Million, slice the last valid decimal amount.
    if (finalAmount > 1000000) {
        // Look for valid price at the end: 1-7 digits + .XX (Max 9,999,999.99)
        const strictMatch = amountRaw.match(/(\d{1,7}\.\d{2})$/);
        
        if (strictMatch) {
            let realAmount = parseFloat(strictMatch[1]);
            
            // Auto-Correction Verification:
            // If we have a running balance, does this realAmount match the math?
            // Or does the HUGE amount match? (Unlikely)
            // We prioritize the reasonable number (< 10M) over the huge one.
            
            finalAmount = realAmount;
            
            // Move the prefix to description
            let prefix = amountRaw.substring(0, amountRaw.length - strictMatch[1].length);
            description = description + " Ref:" + prefix;
        }
    }

    // Apply Sign
    if (isCredit) finalAmount = Math.abs(finalAmount);
    else finalAmount = -Math.abs(finalAmount);

    // --- BALANCE VERIFICATION ---
    // If we have a running balance, verify the sign
    if (runningBalance !== null) {
        const diff = finalBalance - runningBalance;
        // If the mathematical difference matches the Amount (abs), trust the math for the sign
        if (Math.abs(Math.abs(diff) - Math.abs(finalAmount)) < 0.05) {
            finalAmount = diff; // Corrects sign automatically
        }
    }
    
    // Update Tracker
    runningBalance = finalBalance;

    // Cleanup
    description = description.replace(/^[\d\-\.\s]+/, '').trim(); // Remove leading trash
    if (!description) description = "Transaction";

    transactions.push({
      date: dateStr,
      description: description,
      amount: finalAmount,
      balance: finalBalance,
      account: account,
      bankName: "FNB",
      clientName: clientName,
      uniqueDocNo: uniqueDocNo
    });
  }

  return transactions;
};