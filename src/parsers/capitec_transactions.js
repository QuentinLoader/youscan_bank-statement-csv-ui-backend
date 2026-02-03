export const parseCapitec = (text) => {
  const transactions = [];

  // 1. ANCHORED METADATA (Header Specific)
  // Look for the name immediately after the document title
  const clientMatch = text.match(/(?:Main Account Statement|Tax Invoice)\s+([A-Z\s,]{5,25})\s+/i);
  
  // Account: Grabs the 10-digit number immediately following "Account"
  const accountMatch = text.match(/Account\s+(\d{10})/i);

  // Statement ID: UUID pattern
  const docNoMatch = text.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);

  const account = accountMatch ? accountMatch[1] : "Check Account Bar";
  const uniqueDocNo = docNoMatch ? docNoMatch[0] : "Check Footer";
  const clientName = clientMatch ? clientMatch[1].trim() : "Name Not Found";

  // 2. TRANSACTION CHUNKING
  const chunks = text.split(/(?=\d{2}\/\d{2}\/\d{4})/);
  const amountRegex = /-?R?\s*\d+[\d\s,]*\.\d{2}/g;

  chunks.forEach(chunk => {
    // Clean up all newlines within the chunk to fix CSV formatting
    const cleanChunk = chunk.replace(/\r?\n|\r/g, " ").trim();
    if (!cleanChunk) return;

    const dateMatch = cleanChunk.match(/(\d{2}\/\d{2}\/\d{4})/);
    if (!dateMatch) return;

    const date = dateMatch[0];
    
    // GHOST FILTER: Block summary and header artifacts
    const summaryLabels = ["summary", "total", "brought forward", "closing balance", "tax invoice", "page of"];
    if (summaryLabels.some(label => cleanChunk.toLowerCase().includes(label))) return;

    const rawAmounts = cleanChunk.match(amountRegex) || [];

    if (rawAmounts.length >= 2) {
      const cleanAmounts = rawAmounts.map(a => parseFloat(a.replace(/[R\s,]/g, '')));
      
      let amount = cleanAmounts[0];
      const balance = cleanAmounts[cleanAmounts.length - 1];

      // Handle the Fee column
      if (cleanAmounts.length === 3) {
        amount = amount + cleanAmounts[1];
      }

      // 3. CLEAN DESCRIPTION
      let description = cleanChunk.split(date)[1].split(rawAmounts[0])[0].trim();
      
      // Strip trailing category garbage
      const categories = ["Fees", "Transfer", "Other Income", "Internet", "Groceries", "Digital Payments", "Digital Subscriptions", "Online Store"];
      categories.forEach(cat => {
        if (description.endsWith(cat)) description = description.slice(0, -cat.length).trim();
      });

      if (description.length > 1) {
        transactions.push({
          date,
          description: description.replace(/"/g, '""'), // Escape quotes for CSV safety
          amount,
          balance,
          account,
          clientName: clientName.replace(/"/g, '""'),
          uniqueDocNo,
          approved: true
        });
      }
    }
  });

  return transactions.filter(t => t.date.includes("/2025") || t.date.includes("/2026"));
};