export const parseCapitec = (text) => {
  const transactions = [];
  const lines = text.split(/\r?\n/);

  // 1. EXTRACT METADATA
  const headerArea = text.slice(0, 5000);
  
  // Find Account Number
  const accountNumberMatch = headerArea.match(/Account (?:No|Number)[:\s.]+([0-9\s]{10,})/i);
  const accountNumber = accountNumberMatch ? accountNumberMatch[1].replace(/\s/g, '') : "Not Found";
  
  // Find Client Name
  const clientNameMatch = headerArea.match(/Unique Document No[\s\S]*?\n\s*([A-Z\s,]{5,})\n/);
  const clientName = clientNameMatch ? clientNameMatch[1].trim() : "Not Found";

  // Find Unique Document No
  const docNoMatch = headerArea.match(/Unique Document No\s*[\.:]+\s*([a-f0-9\-]{20,})/i);
  const uniqueDocNo = docNoMatch ? docNoMatch[1] : "Not Found";

  const dateRegex = /(\d{2}\/\d{2}\/\d{4})/;
  const amountRegex = /-?R?\s*\d+[\d\s,]*\.\d{2}/g;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.includes("Page of") || line.includes("09/07/2022")) continue;

    const dateMatch = line.match(dateRegex);

    if (dateMatch) {
      const date = dateMatch[0];
      if (line.includes("Date Description")) continue;

      let content = line.split(date)[1].trim();
      
      // Multi-line description recovery
      let lookAhead = i + 1;
      while (lines[lookAhead] && !lines[lookAhead].match(dateRegex) && !lines[lookAhead].match(amountRegex)) {
        content += " " + lines[lookAhead].trim();
        i = lookAhead;
        lookAhead++;
      }

      const rawAmounts = content.match(amountRegex) || [];

      if (rawAmounts.length >= 2) {
        const cleanAmounts = rawAmounts.map(a => parseFloat(a.replace(/[R\s,]/g, '')));
        let amount = cleanAmounts[0];
        const balance = cleanAmounts[cleanAmounts.length - 1];

        if (cleanAmounts.length === 3) {
          amount = amount + cleanAmounts[1]; 
        }

        let description = content.split(rawAmounts[0])[0].trim();
        description = description.replace(/(Groceries|Transfer|Fees|Digital|Internet|Holiday|Vehicle|Restaurants|Alcohol|Other Income|Cash Withdrawal|Digital Payments)$/, "").trim();

        transactions.push({
          date,
          description,
          amount,
          balance,
          account: accountNumber, // Replaced 'accountNumber' with 'account'
          clientName,
          uniqueDocNo,
          approved: true
        });
      }
    }
  }

  return transactions.filter(t => t.date.includes("/2025") || t.date.includes("/2026"));
};