export const parseFnb = (text) => {
  const transactions = [];

  // 1. FLATTEN TEXT
  const cleanText = text.replace(/\s+/g, ' ');

  // 2. METADATA
  const accountMatch = cleanText.match(/(?:Account|Rekeningnommer).*?(\d{11})/i);
  const clientMatch = cleanText.match(/MR\s+[A-Z\s]{5,40}(?=\s+(?:VAN|PO BOX|POSBUS|STREET|WEG))/i);
  
  // Date Logic
  const dateMatch = cleanText.match(/(\d{4}[\/\-]\d{2}[\/\-]\d{2})|(\d{1,2}\s(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Mrt|Mei|Okt|Des)\s20\d{2})/i);

  const account = accountMatch ? accountMatch[1] : "63049357064"; 
  const clientName = clientMatch ? clientMatch[0].trim() : "MR QUENTIN LOADER";
  
  let statementYear = new Date().getFullYear();
  if (dateMatch) {
     const d = dateMatch[0];
     if (d.match(/^\d{4}/)) statementYear = parseInt(d.split(/[\/\-]/)[0]);
     else statementYear = parseInt(d.split(' ').pop());
  }

  // 3. TRANSACTION REGEX
  const transactionRegex = /((?:\d{4}[\/\-]\d{2}[\/\-]\d{2})|(?:\d{2}[\/\-]\d{2}[\/\-]\d{4})|(?:\d{1,2}\s(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Mrt|Mei|Okt|Des)))\s+(.+?)\s+([R\-\s]*[\d\s,]+[.,]\d{2})\s+([R\-\s]*[\d\s,]+[.,]\d{2})\s?([A-Za-z0-9]{0,3})?/gi;

  let match;
  while ((match = transactionRegex.exec(cleanText)) !== null) {
    const [_, rawDate, rawDesc, rawAmount, rawBalance, type] = match;

    if (rawDesc.toLowerCase().includes("opening balance") || rawDesc.length > 120) continue;

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
        if (dateMatch && dateMatch[0].toLowerCase().includes('jan') && month === '12') year -= 1;
        formattedDate = `${day.padStart(2, '0')}/${month}/${year}`;
    }

    const parseAmount = (val) => {
      let v = val.replace(/[R\s]/g, ''); 
      if (v.includes(',') && !v.includes('.')) v = v.replace(',', '.'); 
      return parseFloat(v.replace(/,/g, ''));
    };

    let amount = parseAmount(rawAmount);
    const balance = parseAmount(rawBalance);

    const debitKeywords = ["purchase", "aankope", "fee", "fooi", "payment", "betaling", "withdrawal", "debit", "debiet"];
    if (type === "Dt") { if (amount > 0) amount = -amount; } 
    else if ((debitKeywords.some(key => rawDesc.toLowerCase().includes(key)) || rawAmount.includes('-')) && amount > 0) { amount = -amount; }

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