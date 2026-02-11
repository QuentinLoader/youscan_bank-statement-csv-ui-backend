/**
 * FNB Parser (Diagnostic Mode)
 * * Includes console logging to debug PDF text extraction.
 * * Uses "relaxed" regex to handle text with missing spaces (mashed text).
 */

export const parseFnb = (text) => {
  // --- DIAGNOSTIC LOGGING START ---
  // This will print the raw text to your server console.
  // Copy the output between the "---" markers if you still get 0 items.
  console.log("--- RAW PDF TEXT START ---");
  console.log(text.substring(0, 1000) + "..."); // Print first 1000 characters
  console.log("--- RAW PDF TEXT END ---");
  // --- DIAGNOSTIC LOGGING END ---

  const transactions = [];

  // ===========================================================================
  // 1. METADATA EXTRACTION
  // ===========================================================================
  // Robust matching for merged headers (e.g., "Account Number123456")
  const accountMatch = text.match(/Account\D*?(\d{11})/i) || text.match(/(\d{11})/);
  const account = accountMatch ? accountMatch[1] : "Unknown";

  const statementIdMatch = text.match(/BBST(\d+)/i);
  const uniqueDocNo = statementIdMatch ? statementIdMatch[1] : "Unknown";

  // Client Name: Matches "PROPERTIES", "LIVING BRANCH", "LTD", "PTY" etc.
  const clientMatch = text.match(/\*?([A-Z\s\.]+(?:PROPERTIES|LIVING|TRADING|LTD|PTY)[A-Z\s\.]*)/i);
  const clientName = clientMatch ? clientMatch[1].trim() : "Unknown";

  // Year Detection: Looks for YYYY/MM/DD pattern in the header
  let currentYear = new Date().getFullYear();
  const dateHeader = text.match(/(20\d{2})\/\d{2}\/\d{2}/);
  if (dateHeader) currentYear = parseInt(dateHeader[1]);

  // ===========================================================================
  // 2. TEXT CLEANUP
  // ===========================================================================
  let cleanText = text
    .replace(/Page \d+ of \d+/gi, ' ') 
    .replace(/Transactions in RAND/i, '')
    .replace(/\r\n/g, '\n'); 

  // ===========================================================================
  // 3. PARSING LOGIC (The "Mashed" Regex)
  // ===========================================================================
  // Pattern handles: "20JanDescription100.00" (Zero whitespace required)
  // 1. Date (DD Mon)
  // 2. Description (Non-greedy)
  // 3. Amount (Number.Number)
  // 4. Balance (Number.Number)
  
  const mashedRegex = /(\d{1,2})\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*(.*?)\s*([0-9,]+\.[0-9]{2})(Cr|Dr)?\s*([0-9,]+\.[0-9]{2})(Cr|Dr)?/gi;

  let match;
  while ((match = mashedRegex.exec(cleanText)) !== null) {
    const day = match[1].padStart(2, '0');
    const monthRaw = match[2];
    let description = match[3].trim();
    const amountRaw = match[4];
    const amountSign = match[5]; // Cr or Dr
    const balanceRaw = match[6];
    
    // --- Validation ---
    if (description.toLowerCase().includes('opening balance')) continue;
    if (description.length > 150) continue; // Skip false positives

    // --- Date Formatting ---
    const months = { Jan:'01', Feb:'02', Mar:'03', Apr:'04', May:'05', Jun:'06', Jul:'07', Aug:'08', Sep:'09', Oct:'10', Nov:'11', Dec:'12' };
    const month = months[monthRaw] || months[monthRaw.substring(0,3)]; 
    
    let txYear = currentYear;
    // Handle Year Rollover (Dec transaction in Jan statement)
    if (month === '12' && new Date().getMonth() < 3) txYear = currentYear - 1;
    
    const dateStr = `${day}/${month}/${txYear}`;

    // --- Amount Formatting ---
    let amount = parseFloat(amountRaw.replace(/,/g, ''));
    let balance = parseFloat(balanceRaw.replace(/,/g, ''));

    // FNB Logic: Cr = Income (+), No Sign = Expense (-)
    if (amountSign === 'Cr') {
      amount = Math.abs(amount);
    } else {
      amount = -Math.abs(amount);
    }
    
    // --- Description Cleanup ---
    // Remove loose numbers/dates at start of description
    description = description.replace(/^[\d\-\.\s]+/, '');

    transactions.push({
      date: dateStr,
      description: description,
      amount: amount,
      balance: balance,
      account: account,
      bankName: "FNB",
      clientName: clientName,
      uniqueDocNo: uniqueDocNo
    });
  }

  return transactions;
};