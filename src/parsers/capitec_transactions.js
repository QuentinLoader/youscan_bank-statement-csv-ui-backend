export const parseCapitec = (text) => {
  const transactions = [];
  const lines = text.split('\n');

  // Matches DD/MM/YYYY
  const dateRegex = /^(\d{2}\/\d{2}\/\d{4})/;
  // Matches currency amounts with decimals (e.g., -150.00 or 2500.00)
  const amountRegex = /-?\d+[\d\s,]*\.\d{2}/;

  lines.forEach(line => {
    const trimmed = line.trim();
    const dateMatch = trimmed.match(dateRegex);

    if (dateMatch) {
      const date = dateMatch[0];
      // Get everything after the date
      let content = trimmed.replace(date, '').trim();

      // Find all numbers that look like amounts
      const amounts = content.match(amountRegex);

      if (amounts && amounts.length > 0) {
        // In Capitec, the first amount found is the transaction value
        const rawAmount = amounts[0];
        const amount = parseFloat(rawAmount.replace(/\s|,/g, ''));

        // Clean Description: Take everything before the amount and 
        // stop if we hit common "Column Headers" that got merged
        let description = content.split(rawAmount)[0].trim();
        
        // Fix for merged columns like "Transfer-1.00" or "Groceries-50.00"
        description = description
          .replace(/Transfer$/, '')
          .replace(/Groceries$/, '')
          .replace(/Fees$/, '')
          .replace(/Other Income$/, '')
          .replace(/Internet$/, '')
          .trim();

        // Safety check: ensure we don't include balance-only lines
        if (!description.toLowerCase().includes('balance') && description.length > 1) {
          transactions.push({
            date,
            description: description || "Bank Transaction",
            amount,
            approved: true
          });
        }
      }
    }
  });

  return transactions;
};