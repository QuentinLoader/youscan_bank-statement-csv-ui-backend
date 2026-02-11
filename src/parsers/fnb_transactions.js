/**
 * FNB PDF Parser (Global Stream Version)
 * * why this works:
 * 1. Ignores newlines/layout (fixes "0 items" error).
 * 2. Scans for the "Financial Fingerprint": [Amount] [Balance] [Fee?].
 * 3. Handles "Merged Text" (e.g., "Ref1234500.00") by detecting numbers without word boundaries.
 * 4. Extracts metadata even if labels are merged (e.g., "Account Number12345...").
 */

export const parseFnb = (text) => {
  const transactions = [];

  // ===========================================================================
  // 1. ROBUST METADATA EXTRACTION
  // ===========================================================================
  // Handles merged headers like "Account Number115624..."
  const accountMatch = text.match(/Account Number\D*(\d{11})/i) || text.match(/(\d{11})/);
  const account = accountMatch ? accountMatch[1] : "Unknown";

  const statementIdMatch = text.match(/Statement Number\D*(\d+)/i) || text.match(/BBST(\d+)/i);
  const uniqueDocNo = statementIdMatch ? statementIdMatch[1] : "Unknown";

  const clientMatch = text.match(/\*([A-Z\s]+PROPERTIES)/) || text.match(/([A-Z\s]+PROPERTIES)/);
  const clientName = clientMatch ? clientMatch[1].trim() : "Unknown";

  // Determine Year (Default to current, adjust if we find a statement period)
  let currentYear = new Date().getFullYear();
  const periodMatch = text.match(/Statement Period.*?\d{4}/i);
  if (periodMatch) {
    const yearInPeriod = periodMatch[0].match(/(\d{4})/);
    if (yearInPeriod) currentYear = parseInt(yearInPeriod[1], 10);
  }

  // ===========================================================================
  // 2. PRE-PROCESSING
  // ===========================================================================
  // Remove footer junk that might disrupt the stream
  let cleanText = text
    .replace(/Page \d+ of \d+/gi, '')
    .replace(/Delivery Method[^\n]*/gi, '')
    .replace(/Branch Number[^\n]*/gi, ''); // Remove the messy header table if possible

  // Find where transactions start to avoid parsing the header as a transaction
  const startMarker = cleanText.match(/Transactions in RAND/i);
  let scanStartIndex = startMarker ? startMarker.index + startMarker[0].length : 0;

  // ===========================================================================
  // 3. GLOBAL MATCHING (The "Financial Anchor")
  // ===========================================================================
  // We look for: Number + (Cr/Dr)? + Space + Number + (Cr/Dr)? + (Optional Fee)
  // This Regex is the "Truth Source".
  
  const transactionRegex = /([0-9,]+\.[0-9]{2})(Cr|Dr)?\s+([0-9,]+\.[0-9]{2})(Cr|Dr)?(?:\s+([0-9,]+\.[0-9]{2})(Cr|Dr)?)?/g;
  
  let match;
  let lastMatchEndIndex = scanStartIndex;

  // Set the regex cursor to the start of transactions
  transactionRegex.lastIndex = scanStartIndex;

  while ((match = transactionRegex.exec(cleanText)) !== null) {
    // 1. EXTRACT FINANCIALS
    const amountStr = match[1];
    const amountSign = match[2]; // Cr, Dr, or undefined
    const balanceStr = match[3];
    const feeStr = match[5]; // Optional Fee

    // Parse Numbers
    let amount = parseFloat(amountStr.replace(/,/g, ''));
    let balance = parseFloat(balanceStr.replace(/,/g, ''));
    let fee = feeStr ? parseFloat(feeStr.replace(/,/g, '')) : 0;

    // Apply Logic: FNB "Cr" = Income, No Sign/Dr = Expense
    if (amountSign === 'Cr') {
      amount = Math.abs(amount);
    } else {
      amount = -Math.abs(amount);
    }

    // 2. EXTRACT DESCRIPTION & DATE
    // The description is everything between the *end* of the last match 
    // and the *start* of the current financial block.
    // Note: match.index gives us the start of the Amount.
    // If the text was "Ref1234500.00", match.index points to "5". 
    // This perfectly splits "Ref1234" into the description!
    
    let rawSegment = cleanText.substring(lastMatchEndIndex, match.index).trim();
    
    // Update pointer for next loop
    lastMatchEndIndex = transactionRegex.lastIndex;

    // Skip if this is just "Opening Balance"
    if (rawSegment.toLowerCase().includes("opening balance")) continue;
    
    // Skip if empty or too short (garbage match)
    if (rawSegment.length < 3) continue;

    // 3. PARSE DATE (DD Mon or YYYY/MM/DD)
    // FNB dates usually appear at the START of the description line, or strictly merged.
    let dateStr = "";
    let cleanDesc = rawSegment;

    // Regex: "17 Jan" or "03 Feb"
    const datePattern = /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i;
    const dateMatch = rawSegment.match(datePattern);

    if (dateMatch) {
        const day = dateMatch[1].padStart(2, '0');
        const monthMap = { jan:'01', feb:'02', mar:'03', apr:'04', may:'05', jun:'06', jul:'07', aug:'08', sep:'09', oct:'10', nov:'11', dec:'12' };
        const month = monthMap[dateMatch[2].toLowerCase().substring(0,3)];
        
        // Year Heuristic: If we are parsing Feb data but find "Dec", it's previous year.
        let txYear = currentYear;
        if (month === '12' && new Date().getMonth() < 3) txYear = currentYear - 1;
        
        dateStr = `${day}/${month}/${txYear}`;
        
        // Remove Date from Description
        cleanDesc = cleanDesc.replace(dateMatch[0], '').trim();
    } else {
        // Fallback: Check for YYYY/MM/DD
        const isoMatch = rawSegment.match(/(\d{4})\/(\d{2})\/(\d{2})/);
        if (isoMatch) {
            dateStr = `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`; // DD/MM/YYYY
             cleanDesc = cleanDesc.replace(isoMatch[0], '').trim();
        } else {
            // Default Date (If missing, use 1st of year or skip?)
            // We'll use 01/01/Year but mark it. 
            // Often if date is missing, it's a "Balance Brought Forward" line.
            if (rawSegment.includes("Balance")) continue; 
            dateStr = `01/01/${currentYear}`;
        }
    }

    // 4. CLEANUP DESCRIPTION
    cleanDesc = cleanDesc
        .replace(/^\s*[\d\.,-]+\s*/, '') // Remove loose numbers/dashes at start
        .replace(/\s+/g, ' ');           // Collapse multiple spaces

    transactions.push({
      date: dateStr,
      description: cleanDesc,
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