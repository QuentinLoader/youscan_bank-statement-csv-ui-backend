export const parseFnb = (text) => {
  const transactions = [];

  // 1. METADATA EXTRACTION
  const accountMatch = text.match(/(\d{11})/);
  const account = accountMatch ? accountMatch[1] : "Unknown";

  const statementIdMatch = text.match(/BBST(\d+)/i);
  const statementId = statementIdMatch ? statementIdMatch[1] : "Unknown";

  const clientMatch = text.match(/\*([A-Z\s]+PROPERTIES[A-Z\s]*?)(?:\d|$)/);
  const clientName = clientMatch ? clientMatch[1].trim() : "Unknown";

  let statementYear = 2025;
  const yearMatch = text.match(/(\d{4})\/\d{2}\/\d{2}/);
  if (yearMatch) statementYear = parseInt(yearMatch[1]);

  // 2. FIND TRANSACTION SECTION
  // Look for "Transactions in RAND" and stop at "Closing Balance"
  const transStartMatch = text.match(/Transactions in RAND.*?(?:Date.*?Description.*?Amount.*?Balance|$)/is);
  if (!transStartMatch) {
    console.warn("Transaction section not found");
    return transactions;
  }

  let transSection = text.substring(transStartMatch.index + transStartMatch[0].length);
  
  // Stop at "Closing Balance" - but be careful not to include it
  const closingMatch = transSection.match(/Closing Balance/i);
  if (closingMatch) {
    transSection = transSection.substring(0, closingMatch.index);
  }

  // 3. SPLIT BY DATES THEN PARSE EACH BLOCK
  // Split the continuous text by date markers
  const dateSplitRegex = /(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec))/gi;
  const parts = transSection.split(dateSplitRegex);
  
  const matches = [];
  
  // Process date-data pairs
  for (let i = 1; i < parts.length; i += 2) {
    const dateStr = parts[i];
    const dataBlock = parts[i + 1] || "";
    
    if (dataBlock.length < 5) continue;
    
    // Skip headers
    if (dataBlock.toLowerCase().includes('opening balance') ||
        dataBlock.toLowerCase().includes('description')) {
      continue;
    }
    
    // Find all currency amounts in this block
    const amountRegex = /([\d,]+\.\d{2})(Cr)?/g;
    const amounts = [...dataBlock.matchAll(amountRegex)];
    
    // Filter valid amounts (not reference numbers)
    const validAmounts = amounts.filter(amt => {
      const num = parseFloat(amt[1].replace(/,/g, ''));
      // Reject if > 100 million OR if large number without commas
      if (num > 100000000) return false;
      if (num >= 1000 && !amt[1].includes(',')) return false;
      return true;
    });
    
    if (validAmounts.length < 2) continue;
    
    // Last two valid amounts are: amount, balance
    const amountMatch = validAmounts[validAmounts.length - 2];
    const balanceMatch = validAmounts[validAmounts.length - 1];
    
    // Extract description (everything before the amount)
    const descEnd = dataBlock.indexOf(amountMatch[0]);
    let description = dataBlock.substring(0, descEnd).trim();
    
    matches.push({
      dateStr,
      description,
      amountStr: amountMatch[1],
      amountCr: amountMatch[2],
      balanceStr: balanceMatch[1],
      balanceCr: balanceMatch[2]
    });
  }
  
  // Now process all matches
  for (const match of matches) {
    const { dateStr, amountStr, amountCr, balanceStr, balanceCr } = match;
    let { description } = match;

  
  // Now process all matches
  for (const match of matches) {
    const { dateStr, amountStr, amountCr, balanceStr, balanceCr } = match;
    let { description } = match;

    // Clean description
    description = description.trim();
    
    // Remove trailing numbers (reference codes and amounts that leaked in)
    // Keep only text description
    description = description.replace(/[\d\s,\.]+(?:Cr)?$/i, '').trim();
    
    // Remove excess whitespace
    description = description.replace(/\s+/g, ' ').trim();
    
    // Remove leading numbers
    description = description.replace(/^[\d\s,\.;:]+/, '').trim();

    // Skip if description is too short
    if (description.length < 3) continue;

    // Parse amount
    let amount = parseFloat(amountStr.replace(/,/g, ''));
    
    // Sanity check: amount shouldn't be absurdly large (indicates parsing error)
    if (amount > 1000000000) continue;
    
    // Credit = positive, Debit = negative
    if (amountCr === 'Cr') {
      amount = Math.abs(amount);
    } else {
      amount = -Math.abs(amount);
    }

    // Parse balance
    const balance = parseFloat(balanceStr.replace(/,/g, ''));
    
    // Sanity check on balance
    if (balance > 1000000000) continue;

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