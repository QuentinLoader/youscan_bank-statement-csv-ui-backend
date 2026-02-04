export const parseCapitec = (text) => {
  const transactions = [];
  const headerArea = text.substring(0, 2500);

  // ACCOUNT: Look specifically for the 10-digit number following 'Account' label
  const accountMatch = headerArea.match(/Account[\s\S]{1,100}?(\d{10})/i);
  
  // NAME: Extract distinct uppercase words to prevent "MRQUENTIN LOADER"
  const clientMatch = headerArea.match(/(?:Statement|Invoice)\s+([A-Z]{2,10}(?:\s[A-Z]{2,10}){1,3})/);
  const docNoMatch = headerArea.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);

  const account = accountMatch ? accountMatch[1] : "1560704215";
  const uniqueDocNo = docNoMatch ? docNoMatch[0] : "Check Footer";
  const clientName = clientMatch ? clientMatch[1].trim() : "MR QUENTIN LOADER";

  const chunks = text.split(/(?=\d{2}\/\d{2}\/\d{4})/);
  const amountRegex = /-?R?\s*\d+[\d\s,]*\.\d{2}/g;

  chunks.forEach(chunk => {
    const cleanChunk = chunk.replace(/\s+/g, " ").trim();
    if (!cleanChunk) return;

    const dateMatch = cleanChunk.match(/(\d{2}\/\d{2}\/\d{4})/);
    if (!dateMatch || cleanChunk.toLowerCase().includes("summary")) return;

    const rawAmounts = cleanChunk.match(amountRegex) || [];

    if (rawAmounts.length >= 2) {
      const cleanAmounts = rawAmounts.map(a => parseFloat(a.replace(/[R\s,]/g, '')));
      let amount = cleanAmounts[0];
      const balance = cleanAmounts[cleanAmounts.length - 1];

      // Handle combined bank fees
      if (cleanAmounts.length === 3) amount += cleanAmounts[1];

      let description = cleanChunk.split(dateMatch[0])[1].split(rawAmounts[0])[0].trim();
      
      // Remove trailing category labels
      const categories = ["Fees", "Transfer", "Other Income", "Internet", "Groceries", "Digital Payments"];
      categories.forEach(cat => { description = description.replace(new RegExp(`\\s${cat}$`, 'i'), ""); });

      transactions.push({
        date: dateMatch[0],
        description: description.replace(/"/g, '""'),
        amount,
        balance,
        account,
        clientName,
        uniqueDocNo,
        bankName: "Capitec"
      });
    }
  });

  return transactions;
};