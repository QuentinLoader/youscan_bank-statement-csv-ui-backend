export const parseFnb = (text) => {
  const transactions = [];

  // 1. BASIC CLEANUP
  let cleanText = text;
  
  // 2. METADATA EXTRACTION
  const accountMatch = cleanText.match(/(\d{11})\s+\d{4}\/\d{2}\/\d{2}\s+GOLD BUSINESS ACCOUNT/);
  const account = accountMatch ? accountMatch[1] : "Unknown";

  const statementIdMatch = cleanText.match(/Tax Invoice\/Statement Number\s*:\s*(\d+)/i);
  const statementId = statementIdMatch ? statementIdMatch[1] : "Unknown";

  const clientMatch = cleanText.match(/\*([A-Z\s&]+(?:PROPERTIES|PTY|LTD|CC)?)\s*\d+/);
  const clientName = clientMatch ? clientMatch[1].trim() : "Unknown";

  // Extract year from statement date
  let statementYear = 2025;
  const yearMatch = cleanText.match(/Statement Date\s*:\s*\d+\s+\w+\s+(\d{4})/i);
  if (yearMatch) statementYear = parseInt(yearMatch[1]);

  // 3. FIND AND EXTRACT TRANSACTION SECTION
  const transStartMatch = cleanText.match(/Date\s+Description\s+Amount\s+Balance\s+Accrued\s+Bank\s+Charges/i);
  if (!transStartMatch) {
    console.warn("Transaction table not found");
    return transactions;
  }

  let transSection = cleanText.substring(transStartMatch.index + transStartMatch[0].length);
  
  // Stop at Closing Balance
  const closingMatch = transSection.match(/Closing Balance/);
  if (closingMatch) {
    transSection = transSection.substring(0, closingMatch.index);
  }

  // 4. PARSE TRANSACTIONS
  // Split by date pattern to get individual transaction blocks
  const lines = transSection.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  
  for (let line of lines) {
    // Match transaction line pattern:
    // Date Description Amount(Cr?) Balance(Cr?) [BankCharges]
    // Example: "17 Jan Internet Trf From Ssprops Reserve Acc 9,500.00Cr 9,977.15Cr"
    
    const transMatch = line.match(/^(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec))\s+(.+?)\s+([\d,]+\.\d{2})(Cr)?\s+([\d,]+\.\d{2})(Cr)?(?:\s+([\d.]+))?$/i);
    
    if (!transMatch) continue;
    
    const dateStr = transMatch[1];
    let description = transMatch[2];
    const amountStr = transMatch[3];
    const amountCr = transMatch[4];
    const balanceStr = transMatch[5];
    const balanceCr = transMatch[6];
    const bankCharges = transMatch[7];
    
    // Skip header-like lines
    if (description.toLowerCase().includes('opening balance') ||
        description.toLowerCase().includes('accrued')) {
      continue;
    }
    
    // Clean description - remove embedded reference numbers that might interfere
    // Keep the text description only
    description = description.trim().replace(/\s{2,}/g, ' ');
    
    // Parse amounts
    let amount = parseFloat(amountStr.replace(/,/g, ''));
    if (!amountCr || amountCr !== 'Cr') {
      amount = -amount; // Debit transactions are negative
    }
    
    const balance = parseFloat(balanceStr.replace(/,/g, ''));
    
    // Format date
    const [day, monthName] = dateStr.split(/\s+/);
    const monthMap = {
      jan: "01", feb: "02", mar: "03", apr: "04",
      may: "05", jun: "06", jul: "07", aug: "08",
      sep: "09", oct: "10", nov: "11", dec: "12"
    };
    const month = monthMap[monthName.toLowerCase().substring(0, 3)] || "01";
    const formattedDate = `${day.padStart(2, '0')}/${month}/${statementYear}`;
    
    transactions.push({
      date: formattedDate,
      description: description,
      amount: amount,
      balance: balance,
      account: account,
      clientName: clientName,
      uniqueDocNo: statementId,
      bankName: "FNB"
    });
  }

  return transactions;
};