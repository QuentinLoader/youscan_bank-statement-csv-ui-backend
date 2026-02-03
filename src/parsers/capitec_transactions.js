export const parseCapitec = (text) => {
  const transactions = [];

  // 1. ROBUST METADATA SEARCH (Scans entire document, not just a slice)
  // Look for 10-13 digits following "Account"
  const accountMatch = text.match(/Account\s*(?:No|Number)?[\s\.:]+(\d{10,13})/i);
  // Look for a UUID pattern (8-4-4-4-12 hex chars) anywhere in the text
  const docNoMatch = text.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
  // Look for the Client Name (usually uppercase after the Document No block)
  const clientMatch = text.match(/Unique Document No[\s\S]*?\n\s*([A-Z\s,]{5,})\n/);

  const account = accountMatch ? accountMatch[1] : "Check PDF Header";
  const uniqueDocNo = docNoMatch ? docNoMatch[0] : "Check PDF Footer";
  const clientName = clientMatch ? clientMatch[1].trim() : "Client Name Not Found";

  // 2. TRANSACTION CHUNKING (The solution to line wrapping)
  // We split the text by dates (DD/MM/YYYY). Everything between two dates is ONE transaction.
  const chunks = text.split(/(?=\d{2}\/\d{2}\/\d{4})/);
  const amountRegex = /-?R?\s*\d+[\d\s,]*\.\d{2}/g;

  chunks.forEach(chunk => {
    const lines = chunk.split('\n').map(l => l.trim()).filter(l => l);
    if (lines.length === 0) return;

    // The first line of a chunk MUST have the date
    const dateMatch = lines[0].match(/(\d{2}\/\d{2}\/\d{4})/);
    if (!dateMatch) return;

    const date = dateMatch[0];
    
    // Join all text in this chunk (this captures the wrapped descriptions)
    let fullContent = lines.join(' ');
    
    // Find all currency values in this chunk
    const rawAmounts = fullContent.match(amountRegex) || [];

    if (rawAmounts.length >= 2) {
      const cleanAmounts = rawAmounts.map(a => parseFloat(a.replace(/[R\s,]/g, '')));
      
      let amount = cleanAmounts[0];
      const balance = cleanAmounts[cleanAmounts.length - 1];

      // If 3 amounts exist, middle is the Fee. We add it to the outflow.
      if (cleanAmounts.length === 3) {
        amount = amount + cleanAmounts[1];
      }

      // Description is everything between the date and the first amount
      let description = fullContent.split(date)[1].split(rawAmounts[0])[0].trim();
      
      // Clean up common "Junk" words at the end of merged descriptions
      const noise = ["Groceries", "Transfer", "Fees", "Digital", "Internet", "Holiday", "Vehicle", "Restaurants", "Alcohol", "Other Income", "Cash Withdrawal", "Digital Payments"];
      noise.forEach(word => {
        if (description.endsWith(word)) description = description.slice(0, -word.length).trim();
      });

      // Avoid summary rows
      if (!description.toLowerCase().includes('balance') && !description.toLowerCase().includes('brought forward')) {
        transactions.push({
          date,
          description: description || "Transaction",
          amount,
          balance,
          account,
          clientName,
          uniqueDocNo,
          approved: true
        });
      }
    }
  });

  // Filter for the specific financial years
  return transactions.filter(t => t.date.includes("/2025") || t.date.includes("/2026"));
};