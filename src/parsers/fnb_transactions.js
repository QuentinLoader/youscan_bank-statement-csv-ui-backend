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

  // 2. SPLIT BY TRANSACTION DATES
  // FNB dates appear as "17 Jan", "01 Feb", etc.
  // Split the text using dates as delimiters
  const dateSplitRegex = /(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec))/g;
  const parts = text.split(dateSplitRegex);

  // Process parts: odd indices are dates, even indices are the transaction data following that date
  for (let i = 1; i < parts.length; i += 2) {
    const dateStr = parts[i].trim();
    const dataBlock = parts[i + 1] || "";
    
    if (dataBlock.length < 10) continue;

    // Skip header sections
    if (dataBlock.toLowerCase().includes('opening balance') ||
        dataBlock.toLowerCase().includes('description amount balance')) {
      continue;
    }

    // 3. EXTRACT AMOUNTS FROM DATA BLOCK
    // Look for currency amounts: patterns like "9,500.00Cr" or "1,000.00" or "8,977.15Cr"
    const amountPattern = /([\d,]+\.\d{2})(Cr)?/g;
    const amounts = [...dataBlock.matchAll(amountPattern)];

    // Need at least 2 amounts (transaction amount and balance)
    if (amounts.length < 2) continue;

    // Last amount is the balance, second-to-last is the transaction amount
    const balanceMatch = amounts[amounts.length - 1];
    const amountMatch = amounts[amounts.length - 2];

    // 4. EXTRACT DESCRIPTION
    // Everything from start of data block up to the transaction amount
    const amountIndex = amountMatch.index;
    let description = dataBlock.substring(0, amountIndex).trim();
    
    // Clean description
    description = description.replace(/\s+/g, ' ').trim();
    
    // Remove any leading numbers or special characters
    description = description.replace(/^[\d\s\.,;:]+/, '').trim();
    
    // Skip if description is too short or looks like a header
    if (description.length < 3 || 
        description.toLowerCase().includes('accrued') ||
        description.toLowerCase().includes('charges')) {
      continue;
    }

    // 5. PARSE NUMBERS
    let amount = parseFloat(amountMatch[1].replace(/,/g, ''));
    const balance = parseFloat(balanceMatch[1].replace(/,/g, ''));
    
    // Credit transactions have "Cr" suffix (positive), debits don't (negative)
    if (amountMatch[2] === 'Cr') {
      amount = Math.abs(amount);
    } else {
      amount = -Math.abs(amount);
    }

    // 6. FORMAT DATE
    const [day, monthName] = dateStr.split(/\s+/);
    const monthMap = {
      jan: "01", feb: "02", mar: "03", apr: "04",
      may: "05", jun: "06", jul: "07", aug: "08",
      sep: "09", oct: "10", nov: "11", dec: "12"
    };
    const month = monthMap[monthName.toLowerCase().substring(0, 3)] || "01";
    const formattedDate = `${day.padStart(2, '0')}/${month}/${statementYear}`;

    // 7. ADD TRANSACTION
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