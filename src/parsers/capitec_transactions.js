export const parseCapitec = (text) => {
  const transactions = [];

  // 1. IMPROVED METADATA EXTRACTION
  // Account: Look for 'Account' then skip any spaces/tabs to find the 10-digit number 
  // before 'VAT Registration'
  const accountMatch = text.match(/Account\s+(\d{10})/i);
  
  // Client Name: Usually the first line of uppercase text after the Document No block
  // or right above the "Statement Information" label.
  const clientMatch = text.match(/(?:Unique Document No[\s\S]*?\n\s*)([A-Z\s,]{5,})(?:\n|Statement Information)/i);

  // Unique Document No: Extract the UUID pattern
  const docNoMatch = text.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);

  const account = accountMatch ? accountMatch[1] : "Check PDF Header";
  const uniqueDocNo = docNoMatch ? docNoMatch[0] : "Check PDF Footer";
  const clientName = clientMatch ? clientMatch[1].trim() : "Name Not Found";

  // 2. TRANSACTION CHUNKING
  const chunks = text.split(/(?=\d{2}\/\d{2}\/\d{4})/);
  const amountRegex = /-?R?\s*\d+[\d\s,]*\.\d{2}/g;

  chunks.forEach(chunk => {
    const lines = chunk.split('\n').map(l => l.trim()).filter(l => l);
    if (lines.length === 0) return;

    const dateMatch = lines[0].match(/(\d{2}\/\d{2}\/\d{4})/);
    if (!dateMatch) return;

    const date = dateMatch[0];
    let fullContent = lines.join(' ');
    
    // GHOST FILTER: Specifically block the "Fee Summary" line
    const ghostWords = ["fee summary", "spending summary", "brought forward", "closing balance", "page of"];
    if (ghostWords.some(word => fullContent.toLowerCase().includes(word))) return;

    const rawAmounts = fullContent.match(amountRegex) || [];

    // Valid transactions have at least an Amount and a Balance
    if (rawAmounts.length >= 2) {
      const cleanAmounts = rawAmounts.map(a => parseFloat(a.replace(/[R\s,]/g, '')));
      
      let amount = cleanAmounts[0];
      const balance = cleanAmounts[cleanAmounts.length - 1];

      // Handle the Fee column if it exists
      if (cleanAmounts.length === 3) {
        amount = amount + cleanAmounts[1];
      }

      let description = fullContent.split(date)[1].split(rawAmounts[0])[0].trim();
      
      // Remove trailing category labels that jumble the CSV
      const categories = ["Fees", "Transfer", "Other Income", "Internet", "Groceries", "Digital Payments", "Digital Subscriptions", "Online Store"];
      categories.forEach(cat => {
        if (description.endsWith(cat)) description = description.slice(0, -cat.length).trim();
      });

      if (description.length > 1) {
        transactions.push({
          date,
          description,
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

  return transactions.filter(t => t.date.includes("/2025") || t.date.includes("/2026"));
};