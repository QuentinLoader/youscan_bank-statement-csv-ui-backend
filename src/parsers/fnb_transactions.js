export const parseFnb = (text) => {
  const transactions = [];

  // 1. FLATTEN THE TEXT
  // This fixes the "shredded" / "staircase" log issue by merging everything into one line.
  // We double-space distinct parts to ensure words don't merge (e.g., "FeeR500").
  const cleanText = text.replace(/\s+/g, '  ');

  // 2. METADATA EXTRACTION
  // We use relaxed regex because headers are often messy in the logs.
  const accountMatch = cleanText.match(/(?:Account|Rekeningnommer).*?(\d{11})/i);
  const clientMatch = cleanText.match(/MR\s+[A-Z\s]{5,40}(?=\s+(?:VAN|PO BOX|POSBUS|STREET|WEG))/i);
  
  // Extract Statement Date to determine the year (e.g., "19 Jan 2026")
  const statementDateMatch = cleanText.match(/(\d{1,2})\s(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Mrt|Mei|Okt|Des)\s(20\d{2})/i);

  // Fallbacks
  const account = accountMatch ? accountMatch[1] : "Check CSV"; 
  const clientName = clientMatch ? clientMatch[0].trim() : "MR QUENTIN LOADER";
  const statementYear = statementDateMatch ? parseInt(statementDateMatch[3]) : new Date().getFullYear();

  // 3. TRANSACTION REGEX
  // Matches: Date (19 Jan) ... Description ... Amount (123.45) ... Balance (123.45) ... Optional Indicator (Dr/Cr)
  // We use a non-greedy match (.+?) for the description to stop at the first valid amount.
  const transactionRegex = /(\d{1,2}\s(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Mrt|Mei|Okt|Des))\s+(.+?)\s+([\d\s,]+\.\d{2})\s+([\d\s,]+\.\d{2})(?:[A-Za-z]{0,2})?/gi;

  let match;
  while ((match = transactionRegex.exec(cleanText)) !== null) {
    const [_, rawDate, rawDesc, rawAmount, rawBalance] = match;

    // SKIP NOISE: Ignore Summary lines or Header text that matches the pattern accidentally
    if (rawDesc.toLowerCase().includes("opening balance") || 
        rawDesc.toLowerCase().includes("opening saldo") ||
        rawDesc.toLowerCase().includes("brought forward") ||
        rawDesc.length > 120) {
      continue;
    }

    // DATE PARSING
    const monthMap = { 
      jan:"01", feb:"02", mar:"03", mrt:"03", apr:"04", may:"05", mei:"05", jun:"06", 
      jul:"07", aug:"08", sep:"09", oct:"10", okt:"10", nov:"11", dec:"12", des:"12" 
    };
    
    const [day, monthStr] = rawDate.split(" ");
    const month = monthMap[monthStr.toLowerCase()] || "01";
    
    // Year Logic: If statement is Jan 2026, but trans is Dec, it's Dec 2025.
    let year = statementYear;
    if (statementDateMatch && statementDateMatch[2].toLowerCase() === 'jan' && month === '12') {
      year -= 1;
    }
    const formattedDate = `${day.padStart(2, '0')}/${month}/${year}`;

    // AMOUNT CLEANUP
    // Remove spaces and handle commas if they are thousands separators
    const parseAmount = (val) => parseFloat(val.replace(/\s/g, '').replace(/,/g, ''));
    let amount = parseAmount(rawAmount);
    const balance = parseAmount(rawBalance);

    // SIGN DETECTION (DEBIT vs CREDIT)
    // Since flattening loses column position, we use description keywords to identify debits.
    const lowerDesc = rawDesc.toLowerCase();
    const debitKeywords = [
      "purchase", "aankope", "fee", "fooi", "payment", "betaling", 
      "withdrawal", "onttrekking", "debit", "debiet", "tikkie", "airtime", "data", "atm", "pos"
    ];

    // If it's a known debit keyword, make it negative. 
    // Otherwise, assume positive (Income/Transfers In) unless context suggests otherwise.
    const isDebit = debitKeywords.some(key => lowerDesc.includes(key));
    if (isDebit && amount > 0) {
      amount = -amount;
    }

    transactions.push({
      date: formattedDate,
      description: rawDesc.trim(),
      amount: amount,
      balance: balance,
      account: account,
      clientName: clientName,
      uniqueDocNo: "Check Header", // FNB often puts this in a weird place
      bankName: "FNB"
    });
  }

  return transactions;
};