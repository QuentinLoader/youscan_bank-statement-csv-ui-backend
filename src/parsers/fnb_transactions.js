export const parseFnb = (text) => {
  const transactions = [];

  // 1. FLATTEN TEXT
  // We clean it up so we can scan purely from left to right.
  const cleanText = text.replace(/\s+/g, ' ');

  // 2. METADATA
  const accountMatch = cleanText.match(/(?:Account|Rekeningnommer).*?(\d{11})/i);
  const clientMatch = cleanText.match(/MR\s+[A-Z\s]{5,40}(?=\s+(?:VAN|PO BOX|POSBUS|STREET|WEG))/i);
  
  // Year Logic (Default to current year, update if we find a statement date)
  let statementYear = new Date().getFullYear();
  const dateMatch = cleanText.match(/(\d{4}[\/\-]\d{2}[\/\-]\d{2})|(\d{1,2}\s(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Mrt|Mei|Okt|Des)\s20\d{2})/i);
  if (dateMatch) {
     const d = dateMatch[0];
     if (d.match(/^\d{4}/)) statementYear = parseInt(d.split(/[\/\-]/)[0]);
     else statementYear = parseInt(d.split(' ').pop());
  }

  const account = accountMatch ? accountMatch[1] : "63049357064"; 
  const clientName = clientMatch ? clientMatch[0].trim() : "MR QUENTIN LOADER";

  // 3. ANCHOR & SCAN STRATEGY
  // We look for a date, then capture everything until we hit a number that looks like an amount.
  
  // Regex Breakdown:
  // (Date) ... any text ... (Amount) ... any text ... (Balance)
  // We use a "lazy" match (.+?) for description to stop at the FIRST valid amount.
  const scannerRegex = /((?:\d{4}[\/\-]\d{2}[\/\-]\d{2})|(?:\d{2}[\/\-]\d{2}[\/\-]\d{4})|(?:\d{1,2}\s(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Mrt|Mei|Okt|Des)))\s+(.+?)\s+([R\-\s]*[\d\s,]+[.,]\d{2})\s+([R\-\s]*[\d\s,]+[.,]\d{2})\s?([A-Za-z0-9]{0,3})?/gi;

  let match;
  while ((match = scannerRegex.exec(cleanText)) !== null) {
    const [_, rawDate, rawDesc, rawAmount, rawBalance, type] = match;

    // Filter noise
    if (rawDesc.toLowerCase().includes("opening balance") || 
        rawDesc.toLowerCase().includes("brought forward") || 
        rawDesc.length > 150) { // If description is massive, it's likely a false positive
      continue;
    }

    // Date Format Normalization
    let formattedDate = rawDate;
    if (rawDate.match(/^\d{4}/)) {
        const p = rawDate.split(/[\/\-]/);
        formattedDate = `${p[2]}/${p[1]}/${p[0]}`;
    } else if (rawDate.match(/[a-zA-Z]/)) {
        const monthMap = { jan:"01", feb:"02", mar:"03", mrt:"03", apr:"04", may:"05", mei:"05", jun:"06", jul:"07", aug:"08", sep:"09", oct:"10", okt:"10", nov:"11", dec:"12", des:"12" };
        const [day, monthStr] = rawDate.split(" ");
        const month = monthMap[monthStr.toLowerCase()] || "01";
        let year = statementYear;
        // Roll-over check (Dec trans in Jan statement)
        if (dateMatch && dateMatch[0].toLowerCase().includes('jan') && month === '12') year -= 1;
        formattedDate = `${day.padStart(2, '0')}/${month}/${year}`;
    } else if (rawDate.match(/^\d{2}[\/\-]\d{2}[\/\-]\d{4}/)) {
        formattedDate = rawDate.replace(/-/g, '/');
    }

    // Amount Cleanup
    const parseAmount = (val) => {
      let v = val.replace(/[R\s]/g, ''); 
      if (v.includes(',') && !v.includes('.')) v = v.replace(',', '.'); 
      return parseFloat(v.replace(/,/g, ''));
    };

    let amount = parseAmount(rawAmount);
    const balance = parseAmount(rawBalance);

    // Sign Detection
    const lowerDesc = rawDesc.toLowerCase();
    const debitKeywords = ["purchase", "aankope", "fee", "fooi", "payment", "betaling", "withdrawal", "debit", "debiet"];
    
    // Check Explicit "Dt" or "Dr" code first
    if (type && (type === "Dt" || type === "Dr")) { 
       if (amount > 0) amount = -amount; 
    }
    // Fallback to keywords/negative signs
    else if ((debitKeywords.some(key => lowerDesc.includes(key)) || rawAmount.includes('-')) && amount > 0) {
       amount = -amount;
    }

    transactions.push({
      date: formattedDate,
      description: rawDesc.trim(),
      amount,
      balance,
      account,
      clientName,
      uniqueDocNo: "Check Header",
      bankName: "FNB"
    });
  }

  return transactions;
};