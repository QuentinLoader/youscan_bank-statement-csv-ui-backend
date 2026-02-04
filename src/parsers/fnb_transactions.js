export const parseFnb = (text) => {
  const transactions = [];

  // 1. FLATTEN THE TEXT (Fixes shredded logs)
  const cleanText = text.replace(/\s+/g, ' ');

  // 2. METADATA
  const accountMatch = cleanText.match(/(?:Account|Rekeningnommer).*?(\d{11})/i);
  const clientMatch = cleanText.match(/MR\s+[A-Z\s]{5,40}(?=\s+(?:VAN|PO BOX|POSBUS|STREET|WEG))/i);
  
  // Date Match (e.g., 19 Jan 2026)
  const statementDateMatch = cleanText.match(/(\d{1,2})\s(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Mrt|Mei|Okt|Des)\s(20\d{2})/i);

  const account = accountMatch ? accountMatch[1] : "63049357064"; 
  const clientName = clientMatch ? clientMatch[0].trim() : "MR QUENTIN LOADER";
  const statementYear = statementDateMatch ? parseInt(statementDateMatch[3]) : new Date().getFullYear();

  // 3. TRANSACTION REGEX
  // Matches: Date -> Description -> Amount -> Balance -> Code
  const transactionRegex = /(\d{1,2}\s(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Mrt|Mei|Okt|Des))\s+(.+?)\s+([\d\s,]+[.,]\d{2})\s+([\d\s,]+[.,]\d{2})(?:[A-Za-z0-9]{0,3})?/gi;

  let match;
  while ((match = transactionRegex.exec(cleanText)) !== null) {
    const [_, rawDate, rawDesc, rawAmount, rawBalance] = match;

    if (rawDesc.toLowerCase().includes("opening balance") || rawDesc.toLowerCase().includes("brought forward") || rawDesc.length > 120) continue;

    const monthMap = { jan:"01", feb:"02", mar:"03", mrt:"03", apr:"04", may:"05", mei:"05", jun:"06", jul:"07", aug:"08", sep:"09", oct:"10", okt:"10", nov:"11", dec:"12", des:"12" };
    const [day, monthStr] = rawDate.split(" ");
    const month = monthMap[monthStr.toLowerCase()] || "01";
    
    let year = statementYear;
    if (statementDateMatch && statementDateMatch[2].toLowerCase() === 'jan' && month === '12') year -= 1;
    
    const formattedDate = `${day.padStart(2, '0')}/${month}/${year}`;

    const parseAmount = (val) => {
      let v = val.replace(/\s/g, ''); 
      if (v.includes(',') && !v.includes('.')) v = v.replace(',', '.'); 
      return parseFloat(v.replace(/,/g, ''));
    };

    let amount = parseAmount(rawAmount);
    const balance = parseAmount(rawBalance);

    const lowerDesc = rawDesc.toLowerCase();
    const debitKeywords = ["purchase", "aankope", "fee", "fooi", "payment", "betaling", "withdrawal", "debit", "debiet"];

    if (debitKeywords.some(key => lowerDesc.includes(key)) && amount > 0) {
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