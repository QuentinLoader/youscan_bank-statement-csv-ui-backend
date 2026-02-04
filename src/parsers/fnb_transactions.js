export const parseFnb = (text) => {
  const transactions = [];

  // 1. ANCHORED METADATA (Top of Page 1)
  const headerArea = text.substring(0, 3000);
  
  // Account Number: 11 digits
  const accountMatch = headerArea.match(/(?:Account:|Rekeningnommer)\s*(\d{11})/i);
  // Client Name: Grabs the line after the BBST code
  const clientMatch = headerArea.match(/(?:\d{6}\n)([A-Z\s]{5,30})/i);
  // Reference Number: Uses FNB's specific "Referance" typo
  const refMatch = headerArea.match(/Referance Number:\s*([A-Z0-9]+)/i);
  // Statement Date: To determine if a transaction belongs to 2025 or 2026
  const statementDateMatch = headerArea.match(/\d{2}\s(?:JAN|FEB|MRT|APR|MEI|JUN|JUL|AUG|SEP|OKT|NOV|DES)\s(202\d)/i);

  const account = accountMatch ? accountMatch[1] : "Check Header";
  const uniqueDocNo = refMatch ? refMatch[1] : "Check Header";
  const clientName = clientMatch ? clientMatch[1].trim() : "MR QUENTIN LOADER";
  const statementYear = statementDateMatch ? parseInt(statementDateMatch[1]) : 2026;

  // 2. TRANSACTION CHUNKING
  // Regex for "DD MMM" (handles English and Afrikaans)
  const dateRegex = /\n(\d{2}\s(?:Jan|Feb|Mrt|Mar|Apr|Mei|May|Jun|Jul|Aug|Sep|Okt|Oct|Nov|Des|Dec))/gi;
  const chunks = text.split(dateRegex);
  
  const amountRegex = /-?\d{1,3}(?:\s?\d{3})*,\d{2}/g; // Matches "1 234,56" or "234,56"

  // Process chunks (Every 2nd element is the date, following is the content)
  for (let i = 1; i < chunks.length; i += 2) {
    const rawDate = chunks[i];
    const content = chunks[i + 1].replace(/\n/g, " ").trim();
    
    // YEAR LOGIC: If statement is Jan 2026 and transaction is Dec, it must be 2025
    let year = statementYear;
    if (statementDateMatch && statementDateMatch[0].includes("JAN") && rawDate.toLowerCase().includes("des")) {
      year = statementYear - 1;
    }

    // Convert Date to DD/MM/YYYY
    const monthMap = { jan: "01", feb: "02", mrt: "03", mar: "03", apr: "04", mei: "05", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", okt: "10", oct: "10", nov: "11", des: "12", dec: "12" };
    const [day, monthStr] = rawDate.split(" ");
    const formattedDate = `${day}/${monthMap[monthStr.toLowerCase()]}/${year}`;

    // Skip balance summary rows
    if (content.toLowerCase().includes("afsluitingsaldo") || content.toLowerCase().includes("openingsaldo")) continue;

    const rawAmounts = content.match(amountRegex) || [];

    if (rawAmounts.length >= 2) {
      // Clean amounts: replace space with nothing, comma with dot
      const cleanAmounts = rawAmounts.map(a => parseFloat(a.replace(/\s/g, '').replace(',', '.')));
      
      let amount = cleanAmounts[0];
      const balance = cleanAmounts[cleanAmounts.length - 1];

      // FNB Direction Logic: If "Dt" exists next to amount, it's negative
      const isDebit = content.includes(`${rawAmounts[0]} Dt`) || content.includes(`${rawAmounts[0]}Dt`);
      if (isDebit && amount > 0) amount = -amount;

      // Extract description (everything between date and first amount)
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