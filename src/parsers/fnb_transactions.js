/**
 * FNB PDF Statement Parser
 * Designed to handle:
 * - Merged Description/Amount (e.g., "Ref1234500.00")
 * - Variable Column Orders (Date inside description)
 * - "Accrued Fee" columns that offset Amount/Balance detection
 * - Standard FNB Date formats (DD MMM or YYYY/MM/DD)
 */

export const parseFnb = (text) => {
  const transactions = [];

  // ===========================================================================
  // 1. METADATA EXTRACTION
  // ===========================================================================
  const accountMatch = text.match(/Account Number\s*[:\.]?\s*(\d{11})/i) || text.match(/(\d{11})/);
  const account = accountMatch ? accountMatch[1] : "Unknown";

  const statementIdMatch = text.match(/Statement Number\s*[:\.]?\s*(\d+)/i) || text.match(/BBST(\d+)/i);
  const uniqueDocNo = statementIdMatch ? statementIdMatch[1] : "Unknown";

  // Attempt to find Statement Period to determine the year
  // Pattern: "Statement Period: 15 January 2025 to 15 February 2025"
  let currentYear = new Date().getFullYear();
  const periodMatch = text.match(/Statement Period.*?\d{1,2}\s+[A-Za-z]+\s+(\d{4})/i);
  if (periodMatch) {
    currentYear = parseInt(periodMatch[1], 10);
  }

  // Client Name: Usually follows "Properties" or is in the header
  const clientMatch = text.match(/([A-Z\s]+PROPERTIES)/) || text.match(/\*([A-Z\s]+PROPERTIES)/);
  const clientName = clientMatch ? clientMatch[1].trim().replace(/^\*/, '') : "Unknown";

  // ===========================================================================
  // 2. PRE-PROCESSING & CLEANUP
  // ===========================================================================
  // Remove page headers/footers to prevent them from breaking transaction blocks
  // Common FNB footer patterns: "Page X of Y", "Delivery Method", "Branch Number"
  let cleanText = text
    .replace(/Page \d+ of \d+/gi, '')
    .replace(/Delivery Method.*?$/gim, '')
    .replace(/Branch Number.*?Account Number.*?Date/is, '') // Table headers
    .replace(/Opening Balance.*?Closing Balance/is, (match) => match) // Keep the middle
    .replace(/Transactions in RAND/i, 'START_TRANSACTIONS'); // Marker

  // Isolate the transaction section
  const startMarker = cleanText.indexOf('START_TRANSACTIONS');
  if (startMarker !== -1) {
    cleanText = cleanText.substring(startMarker);
  }
  
  // Remove the "Closing Balance" summary section at the bottom to avoid false positives
  const closingMarker = cleanText.match(/Closing Balance\s+[\d,]+\.\d{2}/i);
  if (closingMarker) {
    cleanText = cleanText.substring(0, closingMarker.index);
  }

  // ===========================================================================
  // 3. ROW SEGMENTATION (The "Anchor" Strategy)
  // ===========================================================================
  // Instead of splitting by newline (which breaks wrapped text) or Date (which moves),
  // we identify lines by looking for the "Balance" patterns.
  // FNB Pattern: Description -> [Date?] -> Amount -> Balance -> [Fee?]
  
  // We'll split by looking for the Balance Amount which is strictly formatted (X.XX or X.XXCr)
  // followed by an optional Fee (X.XX) and then a Newline or Date.
  
  // Normalize newlines to spaces to handle wrapped lines first, then re-introduce breaks based on logic?
  // Easier approach: Use a regex that finds the specific "Amount...Balance...(Fee)" ending.
  
  // Regex Explanation:
  // 1. Capture the main block (Description + Date)
  // 2. Capture Amount (with potential merged text handling later)
  // 3. Capture Balance (Look for Cr/Dr suffix)
  // 4. Capture Optional Fee
  
  // Strategy: Split text into a list of potential transaction strings.
  // We use the "Balance" column as the delimiter because it's the most consistent anchor.
  
  // Find all Balance occurrences: number + "Cr" or "Dr" (or just number if followed by newline)
  // But strictly, FNB balances usually have 'Cr' or 'Dr' in text dumps or are just plain numbers.
  // Based on the source, they have "Cr".
  
  const rawLines = cleanText.split(/\n+/);
  let buffer = "";
  
  const processedRows = [];

  for (let line of rawLines) {
    // If line is empty or just a header, skip/continue
    if (line.trim().length < 3) continue;
    if (line.includes('Description') && line.includes('Amount')) continue; 

    buffer += " " + line.trim();

    // Heuristic: Does the buffer end with a valid transaction pattern?
    // Valid patterns:
    // 1. ... Amount(Cr?) Balance(Cr?) Fee
    // 2. ... Amount(Cr?) Balance(Cr?)
    
    // Regex to detect end of transaction:
    // Looks for: Number(Cr/Dr) SPACE Number(Cr/Dr) (Optional: SPACE Number)? End-of-string
    const endPattern = /([\d,]+\.\d{2})(Cr|Dr)?\s+([\d,]+\.\d{2})(Cr|Dr)?(?:\s+([\d,]+\.\d{2}))?$/i;
    
    if (endPattern.test(buffer)) {
      processedRows.push(buffer.trim());
      buffer = ""; // Reset buffer for next transaction
    }
  }
  
  // If buffer remains (maybe last line didn't catch), try to push it
  if (buffer.trim().length > 10) processedRows.push(buffer.trim());

  // ===========================================================================
  // 4. DATA EXTRACTION
  // ===========================================================================
  
  processedRows.forEach(row => {
    // 1. Identify numbers at the end of the string
    // We use a "Global" match to find all price-like patterns in the row
    // Pattern: 1,234.56 or 1234.56, optional Cr/Dr
    const numberPattern = /([0-9,]+\.[0-9]{2})(Cr|Dr)?/g;
    let allNumbers = [];
    let match;
    while ((match = numberPattern.exec(row)) !== null) {
      allNumbers.push({
        full: match[0],
        value: parseFloat(match[1].replace(/,/g, '')),
        isCredit: match[2] === 'Cr',
        isDebit: match[2] === 'Dr' || match[2] === undefined, // Default to Dr if no sign, but checking logic below
        index: match.index,
        endIndex: match.index + match[0].length
      });
    }

    if (allNumbers.length < 2) return; // Not a valid transaction line

    // 2. Assign Amount and Balance based on position
    // Scenario A: Amount, Balance, Fee (3 numbers)
    // Scenario B: Amount, Balance (2 numbers)
    
    let amountObj, balanceObj;
    let feeVal = 0;

    // Filter out obvious non-financial numbers (like dates 2025.01 if they matched, though regex expects .XX)
    // For FNB, Fee is usually < 500. Balance is usually cumulative.
    
    const lastNum = allNumbers[allNumbers.length - 1];
    const secondLastNum = allNumbers[allNumbers.length - 2];
    
    // Check if the last number is a Fee (usually small, positive, no Cr/Dr suffix in text dump often)
    // In the bad CSV, Fee was 15.00.
    // If we have 3 numbers, assume Amount, Balance, Fee
    if (allNumbers.length >= 3) {
       // Check if the last number looks like a fee (small, usually < 100)
       // And the middle number looks like a Balance (often ends in Cr)
       amountObj = allNumbers[allNumbers.length - 3];
       balanceObj = allNumbers[allNumbers.length - 2];
       feeVal = lastNum.value;
    } else {
       // Only 2 numbers found.
       // CHECK FOR MERGED AMOUNT: e.g. "Text5000.00"
       // The regex `([0-9,]+\.[0-9]{2})` captures "5000.00" even if it's attached to text.
       // So `allNumbers` should actually contain it.
       amountObj = secondLastNum;
       balanceObj = lastNum;
    }

    // 3. EXTRACT DESCRIPTION & DATE
    // Everything before `amountObj.index` is the Description + Date
    let descAndDate = row.substring(0, amountObj.index).trim();
    
    // Fix "Merged" Amount Text:
    // If the char before amountObj is NOT a space, it might be a merge.
    // But since we sliced using `substring(0, index)`, `descAndDate` is clean of the amount numbers.
    // However, if the text was "Reference1234.50", `descAndDate` is "Reference". Correct.
    // If the text was "Phone0831234567 500.00", and parser missed the space?
    // "Phone0831234567500.00" -> regex sees "500.00". `descAndDate` becomes "Phone0831234567". Correct.
    
    // 4. FIND DATE
    // Date can be "DD MMM" (20 Jan) or "YYYY/MM/DD"
    // FNB often puts the date at the START or just AFTER the first word.
    let dateStr = "";
    let finalDesc = descAndDate;

    // Regex for date: DD Mon or D Mon (e.g., 20 Jan, 3 Feb)
    const dateRegex = /\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i;
    const dateMatch = descAndDate.match(dateRegex);

    if (dateMatch) {
      dateStr = dateMatch[0];
      // Remove date from description
      finalDesc = descAndDate.replace(dateMatch[0], "").trim();
      
      // Calculate full date
      const monthMap = { jan:"01", feb:"02", mar:"03", apr:"04", may:"05", jun:"06", jul:"07", aug:"08", sep:"09", oct:"10", nov:"11", dec:"12" };
      const day = dateMatch[1].padStart(2, '0');
      const month = monthMap[dateMatch[2].toLowerCase().substring(0,3)];
      
      // Year logic: If Month is Dec and current is Jan, likely previous year.
      // But we have `currentYear` from metadata.
      // Refine year if needed (e.g. statement spans Dec '24 - Jan '25)
      let txYear = currentYear;
      if (month === '12' && (new Date().getMonth() < 3)) {
         txYear = currentYear - 1; // Basic heuristic
      }
      
      dateStr = `${day}/${month}/${txYear}`;
    } else {
      // Fallback: look for YYYY/MM/DD
      const isoDate = descAndDate.match(/(\d{4})\/(\d{2})\/(\d{2})/);
      if (isoDate) {
         dateStr = `${isoDate[3]}/${isoDate[2]}/${isoDate[1]}`;
         finalDesc = descAndDate.replace(isoDate[0], "").trim();
      } else {
         dateStr = `01/01/${currentYear}`; // Default fallback
      }
    }

    // Cleanup Description
    finalDesc = finalDesc
        .replace(/^[,\.\-\s]+/, '') // Remove leading punctuation
        .replace(/[,\.\-\s]+$/, '') // Remove trailing
        .replace(/\s+/g, ' ');      // Collapse spaces

    // 5. FINALIZE AMOUNTS
    // Check Cr/Dr on Amount
    let finalAmount = amountObj.value;
    
    // In FNB statements:
    // If it has "Cr", it is positive (Money In).
    // If it has no tag or "Dr", it is negative (Money Out).
    // HOWEVER, the source text sometimes puts "Cr" on credits and nothing on debits.
    // We must trust the text tags.
    
    if (amountObj.isCredit) {
        finalAmount = Math.abs(finalAmount);
    } else {
        finalAmount = -Math.abs(finalAmount);
    }

    // 6. VALIDATION (Optional but good)
    // We could check if Balance + Amount = PrevBalance, but skipping for now to ensure we capture everything.

    transactions.push({
      date: dateStr,
      description: finalDesc,
      amount: finalAmount,
      balance: balanceObj.value, // Keep absolute, usually signed in CSV export
      fee: feeVal,
      account: account,
      bankName: "FNB",
      bankLogo: "fnb",
      clientName: clientName,
      uniqueDocNo: uniqueDocNo
    });
  });

  return transactions;
};