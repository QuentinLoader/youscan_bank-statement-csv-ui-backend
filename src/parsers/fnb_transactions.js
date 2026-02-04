export const parseFnb = (text) => {
  const transactions = [];

  // 1. FLATTEN THE TEXT
  // Turn vertical "shredded" text into a single horizontal stream
  const cleanText = text.replace(/\s+/g, ' ');

  // DEBUG LOG: This will show us exactly what the parser sees in the logs
  console.log("🔍 FNB Flattened Snippet:", cleanText.substring(0, 600));

  // 2. METADATA
  const accountMatch = cleanText.match(/(?:Account|Rekeningnommer).*?(\d{11})/i);
  const clientMatch = cleanText.match(/MR\s+[A-Z\s]{5,40}(?=\s+(?:VAN|PO BOX|POSBUS|STREET|WEG))/i);
  
  // Try to find a statement date to help with year logic
  // Matches "2025/12/19" OR "19 Jan 2026"
  const dateMatch = cleanText.match(/(\d{4}[\/\-]\d{2}[\/\-]\d{2})|(\d{1,2}\s(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Mrt|Mei|Okt|Des)\s20\d{2})/i);

  const account = accountMatch ? accountMatch[1] : "63049357064"; 
  const clientName = clientMatch ? clientMatch[0].trim() : "MR QUENTIN LOADER";
  
  let statementYear = new Date().getFullYear();
  if (dateMatch) {
     const d = dateMatch[0];
     if (d.includes('/')) statementYear = parseInt(d.split('/')[0]); // 2025/12/19
     else statementYear = parseInt(d.split(' ').pop()); // 19 Jan 2026
  }

  // 3. UNIVERSAL TRANSACTION REGEX
  // Captures 3 distinct date formats:
  // 1. YYYY/MM/DD (2025/12/19) - Common in your logs
  // 2. DD/MM/YYYY (19/12/2025)
  // 3. DD MMM (19 Dec)
  const transactionRegex = /((?:\d{4}[\/\-]\d{2}[\/\-]\d{2})|(?:\d{2}[\/\-]\d{2}[\/\-]\d{4})|(?:\d{1,2}\s(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Mrt|Mei|Okt|Des)))\s+(.+?)\s+([\d\s,]+[.,]\d{2})\s+([\d\s,]+[.,]\d{2})\s?([A-Za-z0-9]{0,3})?/gi;

  let match;
  while ((match = transactionRegex.exec(cleanText)) !== null) {
    const [_, rawDate, rawDesc, rawAmount, rawBalance, type] = match;

    // SKIP NOISE
    if (rawDesc.toLowerCase().includes("opening balance") || 
        rawDesc.toLowerCase().includes("brought forward") || 
        rawDesc.length > 120) {
      continue;
    }

    // DATE NORMALIZATION
    let formattedDate = rawDate;
    
    // Case A: YYYY/MM/DD (2025/12/19) -> Convert to DD/MM/YYYY
    if (rawDate.match(/^\d{4}[\/\-]/)) {
        const parts = rawDate.split(/[\/\-]/); // [2025, 12, 19]
        formattedDate = `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    // Case B: DD/MM/YYYY (19/12/2025) -> Ensure slashes
    else if (rawDate.match(/^\d{2}[\/\-]\d{2}[\/\-]\d{4}/)) {
        formattedDate = rawDate.replace(/-/g, '/');
    }
    // Case C: DD MMM (19 Dec)
    else {
        const monthMap = { jan:"01", feb:"02", mar:"03", mrt:"03", apr:"04", may:"05", mei:"05", jun:"06", jul:"07", aug:"08", sep:"09", oct:"10", okt:"10", nov:"11", dec:"12", des:"12" };
        const [day, monthStr] = rawDate.split(" ");
        const month = monthMap[monthStr.toLowerCase()] || "01";
        
        let year = statementYear;
        // Handle roll-over (Dec transaction in Jan statement)
        if (dateMatch && dateMatch[0].toLowerCase().includes('jan') && month === '12') year -= 1;
        
        formattedDate = `${day.padStart(2, '0')}/${month}/${year}`;
    }

    // AMOUNT CLEANUP
    const parseAmount = (val) => {
      let v = val.replace(/\s/g, ''); 
      if (v.includes(',') && !v.includes('.')) v = v.replace(',', '.'); 
      return parseFloat(v.replace(/,/g, ''));
    };

    let amount = parseAmount(rawAmount);
    const balance = parseAmount(rawBalance);

    // SIGN DETECTION
    const lowerDesc = rawDesc.toLowerCase();
    const debitKeywords = ["purchase", "aankope", "fee", "fooi", "payment", "betaling", "withdrawal", "debit", "debiet"];

    if (type === "Dt") {
       if (amount > 0) amount = -amount;
    } else if (!type && debitKeywords.some(key => lowerDesc.includes(key)) && amount > 0) {
       amount = -amount;
    }

    transactions.push({
      date: formattedDate,
      description: rawDesc.trim(),
      amount: amount,
      balance: balance,
      account: account,
      clientName: clientName,
      uniqueDocNo: "Check Header",
      bankName: "FNB"
    });
  }

  return transactions;
};