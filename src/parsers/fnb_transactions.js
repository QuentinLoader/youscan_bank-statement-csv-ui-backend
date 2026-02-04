export const parseFnb = (text) => {
  const transactions = [];

  // 1. METADATA EXTRACTION
  // Client Name: Found at the top left [cite: 73]
  const clientMatch = text.match(/MR\s+[A-Z\s,]{5,30}/i);
  
  // Account Number: Explicitly labeled 
  const accountMatch = text.match(/Account:\s*(\d{11})/i) || text.match(/Rekeningnommer\s*(\d{11})/i);
  
  // Reference Number (Statement ID): [cite: 77]
  const refMatch = text.match(/Referance Number:\s*([A-Z0-9]{10,15})/i);

  // Statement Period (to determine the year): [cite: 92]
  const yearMatch = text.match(/202[4-6]/);
  const currentYear = yearMatch ? yearMatch[0] : new Date().getFullYear().toString();

  const account = accountMatch ? accountMatch[1] : "Check Header";
  const uniqueDocNo = refMatch ? refMatch[1] : "Check Header";
  const clientName = clientMatch ? clientMatch[0].trim() : "Name Not Found";

  // 2. TRANSACTION CHUNKING
  // FNB uses "DD MMM" format (e.g., 19 Des) [cite: 90]
  const chunks = text.split(/(?=\n\d{2}\s(?:Jan|Feb|Mrt|Apr|Mei|Jun|Jul|Aug|Sep|Okt|Nov|Des|Jan|Mar|May|Oct))/);
  
  const amountRegex = /-?\d+[\d\s,]*\.\d{2}/g;

  chunks.forEach(chunk => {
    const cleanChunk = chunk.replace(/\r?\n|\r/g, " ").trim();
    if (!cleanChunk) return;

    // Match the date and description
    const dateMatch = cleanChunk.match(/^(\d{2}\s(?:Jan|Feb|Mrt|Apr|Mei|Jun|Jul|Aug|Sep|Okt|Nov|Des|Jan|Mar|May|Oct))/i);
    if (!dateMatch) return;

    // Convert FNB month to numeric format and add year
    const monthMap = { "Jan": "01", "Feb": "02", "Mrt": "03", "Mar": "03", "Apr": "04", "Mei": "05", "May": "05", "Jun": "06", "Jul": "07", "Aug": "08", "Sep": "09", "Okt": "10", "Oct": "10", "Nov": "11", "Des": "12" };
    const [day, monthStr] = dateMatch[1].split(" ");
    const date = `${day}/${monthMap[monthStr]}/${currentYear}`;

    // Skip summary rows
    if (cleanChunk.toLowerCase().includes("afsluitingsaldo") || cleanChunk.toLowerCase().includes("openingsaldo")) return;

    const rawAmounts = cleanChunk.match(amountRegex) || [];

    if (rawAmounts.length >= 2) {
      // FNB amounts often have "Kt" or "Dt" suffixes [cite: 90, 101]
      const cleanAmounts = rawAmounts.map(a => parseFloat(a.replace(/[\s,]/g, '')));
      
      // On FNB, if a row has 3 amounts, the middle is often bank charges [cite: 90]
      let amount = cleanAmounts[0];
      const balance = cleanAmounts[cleanAmounts.length - 1];

      // Logic to determine if it's an outflow (Negative)
      // If it's a debit and doesn't have a 'K' suffix in the raw text, make it negative
      const isCredit = cleanChunk.includes(`${rawAmounts[0]}K`) || cleanChunk.includes(`${rawAmounts[0]}Kt`);
      if (!isCredit && amount > 0) amount = -amount;

      let description = cleanChunk.split(dateMatch[1])[1].split(rawAmounts[0])[0].trim();

      transactions.push({
        date,
        description: description.replace(/"/g, '""'),
        amount,
        balance,
        account,
        clientName,
        uniqueDocNo,
        approved: true
      });
    }
  });

  return transactions;
};