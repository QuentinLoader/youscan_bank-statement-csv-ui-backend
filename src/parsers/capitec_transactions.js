export const parseCapitec = (text) => {
  const transactions = [];

  // 1. ROBUST METADATA SEARCH (Enhanced for Account Number)
  // Capitec often labels it as "Account No" or just after the account type (e.g., Global One 1234567890)
  const accountMatch = text.match(/(?:Account\s*No|Number|Account)[:\s]+(\d{10,13})/i);
  
  // Looking specifically for the UUID at the end of the "Unique Document No" string
  const docNoMatch = text.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i) || 
                     text.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4})/i); // Fallback for shorter snippets

  const account = accountMatch ? accountMatch[1] : "Check Header Area";
  const uniqueDocNo = docNoMatch ? docNoMatch[0] : "Check PDF Footer";

  // 2. CHUNKING BY DATE
  const chunks = text.split(/(?=\d{2}\/\d{2}\/\d{4})/);
  const amountRegex = /-?R?\s*\d+[\d\s,]*\.\d{2}/g;

  chunks.forEach(chunk => {
    const lines = chunk.split('\n').map(l => l.trim()).filter(l => l);
    if (lines.length === 0) return;

    const dateMatch = lines[0].match(/(\d{2}\/\d{2}\/\d{4})/);
    if (!dateMatch) return;

    const date = dateMatch[0];
    let fullContent = lines.join(' ');
    
    // GHOST FILTER: Ignore chunks that belong to summary sections
    const ghostWords = ["summary", "total", "brought forward", "opening balance", "closing balance", "notes"];
    if (ghostWords.some(word => fullContent.toLowerCase().includes(word))) return;

    const rawAmounts = fullContent.match(amountRegex) || [];

    // Transactions must have an amount AND a running balance
    if (rawAmounts.length >= 2) {
      const cleanAmounts = rawAmounts.map(a => parseFloat(a.replace(/[R\s,]/g, '')));
      
      let amount = cleanAmounts[0];
      const balance = cleanAmounts[cleanAmounts.length - 1];

      // Handle the 3rd column (Fees)
      if (cleanAmounts.length === 3) {
        amount = amount + cleanAmounts[1];
      }

      let description = fullContent.split(date)[1].split(rawAmounts[0])[0].trim();
      
      // Remove noise // Remove 
      const noise = ["Groceries", "Transfer", "Fees", "Digital", "Internet", "Holiday", "Vehicle", "Restaurants", "Alcohol", "Other Income", "Cash Withdrawal", "Digital Payments"];
      noise.forEach(word => {
        if (description.endsWith(word)) description = description.slice(0, -word.length).trim();
      });

      if (description.length > 2) {
        transactions.push({
          date,
          description,
          amount,
          balance,
          account,
          uniqueDocNo,
          approved: true
        });
      }
    }
  });

  return transactions.filter(t => t.date.includes("/2025") || t.date.includes("/2026"));
};