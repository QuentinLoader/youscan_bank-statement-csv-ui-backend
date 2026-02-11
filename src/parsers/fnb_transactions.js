/**
 * FNB "Global Pattern" Parser
 * * Strategy:
 * - Abandons line-by-line parsing (which fails when layout breaks).
 * - Scans the raw text stream for the "Transaction Fingerprint":
 * [Date] -> [Description] -> [Amount] -> [Balance]
 * - Handles "Merged Text" (e.g., "Ref1234500.00") by isolating the financial numbers first.
 * - Extracts Metadata (Account, Client) using loose regex to handle mashed headers.
 */

export const parseFnb = (text) => {
  const transactions = [];

  // ===========================================================================
  // 1. METADATA EXTRACTION (Robust Mode)
  // ===========================================================================
  // We use \D* (non-digits) to skip over merged text labels like "NumberDate..."
  
  // Account Number: Look for 11 digits
  const accountMatch = text.match(/Account Number\D*(\d{11})/i) || text.match(/(\d{11})/);
  const account = accountMatch ? accountMatch[1] : "Unknown";

  // Statement ID: BBST...
  const statementIdMatch = text.match(/BBST(\d+)/i);
  const uniqueDocNo = statementIdMatch ? statementIdMatch[1] : "Unknown";

  // Client Name: Look for "PROPERTIES" or "LIVING BRANCH" anchor text
  // FNB often puts the name after a "*"
  const clientMatch = text.match(/\*([A-Z\s\(\)]+(?:PROPERTIES|LIVING\sBRANCH|TRADING|HOLDINGS|LTD|PTY)[A-Z\s\(\)]*)/i);
  const clientName = clientMatch ? clientMatch[1].trim() : "Unknown Client";

  // Determine Statement Year
  // We look for a full date YYYY/MM/DD in the header to anchor the year
  let currentYear = new Date().getFullYear();
  const headerDateMatch = text.match(/20\d{2}\/\d{2}\/\d{2}/); 
  if (headerDateMatch) {
    currentYear = parseInt(headerDateMatch[0].substring(0, 4), 10);
  }

  // ===========================================================================
  // 2. TEXT CLEANUP
  // ===========================================================================
  // Remove "Page X of Y" and other noise that breaks the stream
  let cleanText = text
    .replace(/Page \d+ of \d+/gi, ' ') // Replace with space to prevent merge
    .replace(/Delivery Method[^\n]*/gi, ' ')
    .replace(/Branch Number[^\n]*/gi, ' ') 
    .replace(/\s+/g, ' '); // Normalize all whitespace to single spaces

  // ===========================================================================
  // 3. TRANSACTION PARSING (The "Fingerprint" Strategy)
  // ===========================================================================
  // We look for the pattern: 
  // DATE (Group 1) ... TEXT (Group 3) ... AMOUNT (Group 4) ... BALANCE (Group 6)
  
  // Regex Explanation:
  // 1. Date: (\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec))
  // 2. Description: (.*?) -> Non-greedy match until the Amount
  // 3. Amount: ([0-9,]+\.[0-9]{2})(Cr|Dr)?
  // 4. Balance: ([0-9,]+\.[0-9]{2})(Cr|Dr)?
  // 5. Fee (Optional): (?:\s+([0-9,]+\.[0-9]{2})(Cr|Dr)?)?
  
  const transactionPattern = /(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec))\s+(.*?)\s+([0-9,]+\.[0-9]{2})(Cr|Dr)?\s+([0-9,]+\.[0-9]{2})(Cr|Dr)?(?:\s+([0-9,]+\.[0-9]{2})(Cr|Dr)?)?/gi;

  let match;
  while ((match = transactionPattern.exec(cleanText)) !== null) {
    const rawDate = match[1];
    let description = match[2].trim();
    
    const amountStr = match[3];
    const amountSign = match[4]; // Cr or Dr
    
    const balanceStr = match[5];
    // match[6] is Balance Sign
    
    const feeStr = match[7]; // Optional Fee
    
    // --- VALIDATION: Description Length ---
    // If the regex grabbed 500 characters of text between dates, it's likely a false positive 
    // or skipped a transaction. Valid descriptions are usually < 100 chars.
    if (description.length > 120) continue;

    // --- VALIDATION: "Opening Balance" ---
    if (description.toLowerCase().includes("opening balance")) continue;

    // --- PARSING NUMBERS ---
    let amount = parseFloat(amountStr.replace(/,/g, ''));
    let balance = parseFloat(balanceStr.replace(/,/g, ''));
    let fee = feeStr ? parseFloat(feeStr.replace(/,/g, '')) : 0;

    // Apply Sign Logic
    // FNB: Cr = Credit (Positive), Dr or No Sign = Debit (Negative)
    if (amountSign === 'Cr') {
      amount = Math.abs(amount);
    } else {
      amount = -Math.abs(amount);
    }

    // --- PARSING DATE ---
    // rawDate is "20 Jan"
    const dateParts = rawDate.split(/\s+/);
    const day = dateParts[0].padStart(2, '0');
    const monthStr = dateParts[1].toLowerCase();
    const months = { jan:'01', feb:'02', mar:'03', apr:'04', may:'05', jun:'06', jul:'07', aug:'08', sep:'09', oct:'10', nov:'11', dec:'12' };
    const month = months[monthStr];

    // Year Handling:
    // If statement is Jan 2026, and transaction is Dec, it's Dec 2025.
    let txYear = currentYear;
    if (month === '12' && new Date().getMonth() < 3) {
       // Heuristic: If we are early in the year, Dec is likely last year
       txYear = currentYear - 1;
    }
    
    const dateFormatted = `${day}/${month}/${txYear}`;

    // --- CLEANUP DESCRIPTION ---
    // Remove any leading non-alphanumeric chars (dashes, commas)
    description = description.replace(/^[\s\.,-]+/, '');

    transactions.push({
      date: dateFormatted,
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

  // --- FALLBACK FOR YYYY/MM/DD DATES ---
  // Some FNB statements use YYYY/MM/DD instead of "DD Mon"
  if (transactions.length === 0) {
      const isoPattern = /(\d{4}\/\d{2}\/\d{2})\s+(.*?)\s+([0-9,]+\.[0-9]{2})(Cr|Dr)?\s+([0-9,]+\.[0-9]{2})(Cr|Dr)?/gi;
      while ((match = isoPattern.exec(cleanText)) !== null) {
          // Logic mirrors above, but date parsing differs
          const rawDate = match[1]; // 2025/01/20
          let description = match[2].trim();
          let amount = parseFloat(match[3].replace(/,/g, ''));
          let balance = parseFloat(match[5].replace(/,/g, ''));
          
          if (match[4] !== 'Cr') amount = -Math.abs(amount);

          // Convert YYYY/MM/DD to DD/MM/YYYY
          const [y, m, d] = rawDate.split('/');
          const dateFormatted = `${d}/${m}/${y}`;

          if (description.toLowerCase().includes("opening balance")) continue;

          transactions.push({
              date: dateFormatted,
              description: description,
              amount: amount,
              balance: balance,
              account: account,
              bankName: "FNB",
              bankLogo: "fnb",
              clientName: clientName,
              uniqueDocNo: uniqueDocNo
          });
      }
  }

  return transactions;
};