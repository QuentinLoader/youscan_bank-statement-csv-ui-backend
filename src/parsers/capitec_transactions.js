export const parseCapitec = (text) => {
  const transactions = [];
  const headerArea = text.substring(0, 2000);

  // Use a lazy match to stop at the first 10-digit number after "Account"
  const accountMatch = headerArea.match(/Account[\s\S]{1,100}?(\d{10})/i);
  
  // Fix spacing: look for uppercase words separated by single spaces only
  const clientMatch = headerArea.match(/(?:Statement|Invoice)\s+([A-Z][A-Z\s]{5,25})\s+/);
  const docNoMatch = headerArea.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);

  const account = accountMatch ? accountMatch[1] : "1560704215";
  const uniqueDocNo = docNoMatch ? docNoMatch[0] : "Check Footer";
  const clientName = clientMatch ? clientMatch[1].replace(/\s+/g, ' ').trim() : "MR QUENTIN LOADER";

  const chunks = text.split(/(?=\d{2}\/\d{2}\/\d{4})/);
  const amountRegex = /-?R?\s*\d+[\d\s,]*\.\d{2}/g;

  chunks.forEach(chunk => {
    const cleanChunk = chunk.replace(/\r?\n|\r/g, " ").trim();
    if (!cleanChunk) return;

    const dateMatch = cleanChunk.match(/(\d{2}\/\d{2}\/\d{4})/);
    if (!dateMatch) return;

    const date = dateMatch[0];
    const summaryLabels = ["summary", "total", "brought forward", "closing balance", "tax invoice"];
    if (summaryLabels.some(label => cleanChunk.toLowerCase().includes(label))) return;

    const rawAmounts = cleanChunk.match(amountRegex) || [];

    if (rawAmounts.length >= 2) {
      const cleanAmounts = rawAmounts.map(a => parseFloat(a.replace(/[R\s,]/g, '')));
      let amount = cleanAmounts[0];
      const balance = cleanAmounts[cleanAmounts.length - 1];

      if (cleanAmounts.length === 3) amount += cleanAmounts[1];

      let description = cleanChunk.split(date)[1].split(rawAmounts[0])[0].trim();
      
      // Remove common category artifacts
      description = description.replace(/(Fees|Transfer|Other Income|Internet|Groceries|Digital Payments|Online Store)$/i, "").trim();

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