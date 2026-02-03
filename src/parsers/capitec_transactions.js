export const parseCapitec = (text) => {
  const transactions = [];
  const lines = text.split(/\r?\n/);

  // 1. EXTRACT METADATA (Account & Client))
  const headerArea = text.slice(0, 3000);
  const accountNumberMatch = headerArea.match(/Account No[:\s]+(\d{10,})/i);
  const clientNameMatch = headerArea.match(/Unique Document No[\s\S]*?\n([A-Z\s]{5,})\n/);
  
  const accountNumber = accountNumberMatch ? accountNumberMatch[1] : "Not Found";
  const clientName = clientNameMatch ? clientNameMatch[1].trim() : "Not Found";

  const dateRegex = /(\d{2}\/\d{2}\/\d{4})/;
  const amountRegex = /-?\d+[\d\s,]*\.\d{2}/g;

  // Header/Footer phrases to skip
  const blacklist = ["Page of", "Balance", "Date Description", "Spending Summary", "Unique Document No"];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || blacklist.some(phrase => line.includes(phrase))) continue;

    const dateMatch = line.match(dateRegex);

    if (dateMatch) {
      const date = dateMatch[0];
      let content = line.split(date)[1].trim();
      
      // LOOK AHEAD: Check if the NEXT line is a continuation (no date, no amount)
      let nextLine = lines[i + 1] ? lines[i + 1].trim() : "";
      if (nextLine && !nextLine.match(dateRegex) && !nextLine.match(amountRegex)) {
        content = content + " " + nextLine;
        i++; // Skip the next line in the main loop since we consumed it
      }

      const amounts = content.match(amountRegex);
      if (amounts && amounts.length > 0) {
        const amount = parseFloat(amounts[0].replace(/\s|,/g, ''));
        const balance = parseFloat(amounts[amounts.length - 1].replace(/\s|,/g, ''));
        
        // Clean description by removing the amount and category junk
        let description = content.split(amounts[0])[0].trim();
        description = description.replace(/(Groceries|Transfer|Fees|Digital|Internet|Holiday|Vehicle|Restaurants|Alcohol)$/, "").trim();

        transactions.push({
          date,
          description,
          amount,
          balance,
          accountNumber,
          clientName,
          approved: true
        });
      }
    }
  }

  return transactions.filter(t => t.date.includes("/2025") || t.date.includes("/2026"));
};