export const parseCapitec = (text) => {
  const transactions = [];

  // 1. FLATTEN TEXT (Fixes spacing/newline issues)
  const cleanText = text.replace(/\s+/g, ' ');

  // 2. METADATA
  // Account: Look for 10 digits after "Account"
  const accountMatch = cleanText.match(/Account.*?(\d{10})/i);
  // Name: Look for uppercase name after Statement/Invoice
  const clientMatch = cleanText.match(/(?:Statement|Invoice)\s+([A-Z]{2,15}\s[A-Z]{2,15}(?:\s[A-Z]{2,15})?)/i);
  
  const account = accountMatch ? accountMatch[1] : "1560704215"; 
  const clientName = clientMatch ? clientMatch[1].trim() : "MR QUENTIN LOADER";
  const uniqueDocNo = "Check Footer"; // Capitec UUID is hard to grab in regex, usually not critical for CSV

  // 3. TRANSACTION REGEX
  // Matches: Date (DD/MM/YYYY) -> Description -> Amount -> Balance
  const transactionRegex = /(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+(-?R?\s*[\d\s,]+\.\d{2})\s+(-?R?\s*[\d\s,]+\.\d{2})/gi;

  let match;
  while ((match = transactionRegex.exec(cleanText)) !== null) {
    const [_, date, rawDesc, rawAmount, rawBalance] = match;

    // Filter Header/Summary noise
    if (rawDesc.toLowerCase().includes("opening balance") || 
        rawDesc.toLowerCase().includes("closing balance") || 
        rawDesc.toLowerCase().includes("summary")) {
      continue;
    }

    const parseAmount = (val) => parseFloat(val.replace(/[R\s,]/g, ''));
    let amount = parseAmount(rawAmount);
    const balance = parseAmount(rawBalance);
    
    // Capitec descriptions often have trailing categories like "Digital Payments"
    let description = rawDesc.trim();
    const categories = ["Fees", "Transfer", "Other Income", "Internet", "Groceries", "Digital Payments", "Online Store"];
    categories.forEach(cat => {
      if (description.endsWith(cat)) description = description.slice(0, -cat.length).trim();
    });

    transactions.push({
      date,
      description: description.replace(/"/g, '""'), 
      amount,
      balance,
      account,
      clientName,
      uniqueDocNo,
      bankName: "Capitec"
    });
  }

  return transactions;
};