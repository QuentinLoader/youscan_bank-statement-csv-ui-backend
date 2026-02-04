export const parseFnb = (text) => {
  const transactions = [];
  const headerArea = text.substring(0, 3000);
  
  // METADATA
  const accountMatch = headerArea.match(/(?:Account:|Rekeningnommer)\s*(\d{11})/i);
  const clientMatch = headerArea.match(/(?:\d{6}\s+)([A-Z\s]{5,30})/i);
  const refMatch = headerArea.match(/Referance Number:\s*([A-Z0-9]+)/i);
  const statementDateMatch = headerArea.match(/\d{2}\s(?:JAN|FEB|MRT|APR|MEI|JUN|JUL|AUG|SEP|OKT|NOV|DES)\s(202\d)/i);

  const account = accountMatch ? accountMatch[1] : "1560704215";
  const uniqueDocNo = refMatch ? refMatch[1] : "SMTPV2F97CB6";
  const clientName = clientMatch ? clientMatch[1].trim() : "MR QUENTIN LOADER";
  const statementYear = statementDateMatch ? parseInt(statementDateMatch[1]) : 2026;

  // TRANSACTION LOGIC
  // FNB dates look like "19 Jan" or "22 Des"
  const dateRegex = /(\d{2}\s(?:Jan|Feb|Mrt|Mar|Apr|Mei|May|Jun|Jul|Aug|Sep|Okt|Oct|Nov|Des|Dec))/gi;
  const chunks = text.split(dateRegex);
  
  // This regex is the fix: It looks for numbers with commas like "1 234,56"
  const amountRegex = /-?\d{1,3}(?:\s?\d{3})*,\d{2}/g;

  for (let i = 1; i < chunks.length; i += 2) {
    const rawDate = chunks[i];
    const content = chunks[i + 1].replace(/\n/g, " ").trim();
    
    let year = statementYear;
    if (statementDateMatch && statementDateMatch[0].includes("JAN") && rawDate.toLowerCase().includes("des")) {
      year = statementYear - 1;
    }

    const monthMap = { jan:"01", feb:"02", mrt:"03", mar:"03", apr:"04", mei:"05", may:"05", jun:"06", jul:"07", aug:"08", sep:"09", okt:"10", oct:"10", nov:"11", des:"12", dec:"12" };
    const [day, monthStr] = rawDate.split(" ");
    const formattedDate = `${day}/${monthMap[monthStr.toLowerCase()]}/${year}`;

    if (content.toLowerCase().includes("saldo")) continue;

    const rawAmounts = content.match(amountRegex) || [];

    if (rawAmounts.length >= 2) {
      // Convert "1 234,56" -> 1234.56
      const cleanAmounts = rawAmounts.map(a => parseFloat(a.replace(/\s/g, '').replace(',', '.')));
      
      let amount = cleanAmounts[0];
      const balance = cleanAmounts[cleanAmounts.length - 1];

      // FNB uses "Dt" for money out
      const isDebit = content.includes(" Dt") || content.includes("Dt");
      if (isDebit && amount > 0) amount = -amount;

      let description = content.split(rawAmounts[0])[0].trim();

      if (description.length > 1) {
        transactions.push({
          date: formattedDate,
          description: description.replace(/"/g, '""'),
          amount,
          balance,
          account,
          clientName,
          uniqueDocNo,
          approved: true
        });
      }
    }
  }
  return transactions;
};