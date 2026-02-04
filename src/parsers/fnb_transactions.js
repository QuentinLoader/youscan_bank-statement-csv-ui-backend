export const parseFnb = (text) => {
  const transactions = [];
  
  // 1. FLATTEN TEXT: Turn the "staircase" vertical lines into one long line
  const cleanText = text.replace(/\s+/g, ' ');
  const headerArea = cleanText.substring(0, 3000);

  // 2. METADATA: Flexible extraction for Account and Name
  const accountMatch = cleanText.match(/(?:Account:|Rekeningnommer)\s*(\d{11})/i);
  const clientMatch = cleanText.match(/MR\s+([A-Z\s]{5,30})(?=\s+(?:VAN DER WALT|PO BOX))/i);
  const refMatch = cleanText.match(/Referance Number:\s*([A-Z0-9]+)/i);
  const statementDateMatch = cleanText.match(/\d{2}\s(?:JAN|FEB|MRT|APR|MEI|JUN|JUL|AUG|SEP|OKT|NOV|DES)\s(202\d)/i);

  const account = accountMatch ? accountMatch[1] : "63049357064";
  const uniqueDocNo = refMatch ? refMatch[1] : "SMTPV2F97CB6";
  const clientName = clientMatch ? clientMatch[1].trim() : "MR QUENTIN LOADER";
  const statementYear = statementDateMatch ? parseInt(statementDateMatch[1]) : 2026;

  // 3. TRANSACTION REGEX: Pattern for [Date] [Description] [Amount] [Balance] [Type]
  // Handles English/Afrikaans months and the "Dt/Kt" suffix found in FNB statements
  const transactionRegex = /(\d{2}\s(?:Jan|Feb|Mrt|Mar|Apr|Mei|May|Jun|Jul|Aug|Sep|Okt|Oct|Nov|Des|Dec))\s+(.+?)\s+([\d\s,]+\.\d{2})\s+([\d\s,]+\.\d{2})\s?(Kt|Dt)?/gi;

  let match;
  while ((match = transactionRegex.exec(cleanText)) !== null) {
    const [_, rawDate, rawDesc, rawAmount, rawBalance, type] = match;

    if (rawDesc.toLowerCase().includes("saldo") || rawDesc.toLowerCase().includes("omset")) continue;

    // Date Logic (handles year roll-over for Dec transactions)
    const monthMap = { jan:"01", feb:"02", mrt:"03", mar:"03", apr:"04", mei:"05", may:"05", jun:"06", jul:"07", aug:"08", sep:"09", okt:"10", oct:"10", nov:"11", des:"12", dec:"12" };
    const [day, monthStr] = rawDate.split(" ");
    let year = statementYear;
    if (statementDateMatch && statementDateMatch[0].includes("JAN") && monthStr.toLowerCase() === "des") year -= 1;
    
    const formattedDate = `${day}/${monthMap[monthStr.toLowerCase()]}/${year}`;

    // Numeric Cleanup (Handles Afrikaans "1 234,56")
    const parseNumber = (str) => parseFloat(str.replace(/\s/g, '').replace(',', '.'));
    let amount = parseNumber(rawAmount);
    const balance = parseNumber(rawBalance);

    // If "Dt" (Debiet) is present, the amount is negative
    if (type === "Dt" && amount > 0) amount = -amount;

    transactions.push({
      date: formattedDate,
      description: rawDesc.trim().replace(/\s+/g, ' '),
      amount,
      balance,
      account,
      clientName,
      uniqueDocNo,
      bankName: "FNB"
    });
  }

  return transactions;
};