export const parseCapitec = (text) => {
  const transactions = [];
  
  // 1. EXTRACT METADATA (Account # and Client Name)
  const accountNumberMatch = text.match(/Account No[:\s]+(\d{10,})/i);
  const clientNameMatch = text.match(/Unique Document No[\s\S]*?\n([A-Z\s]{5,})\n/);
  
  const accountNumber = accountNumberMatch ? accountNumberMatch[1] : "Unknown";
  const clientName = clientNameMatch ? clientNameMatch[1].trim() : "Client Name Not Found";

  // 2. DEFINE BOUNDARIES - Stop before the summary tables
  const startMarker = "Transaction History";
  const stopMarkers = ["Spending Summary", "Card Subscriptions", "Notes"];
  
  let validSection = text;
  if (text.includes(startMarker)) {
    validSection = text.split(startMarker)[1];
  }
  
  // Cut off everything after the first stop marker found
  for (const marker of stopMarkers) {
    if (validSection.includes(marker)) {
      validSection = validSection.split(marker)[0];
      break; 
    }
  }

  const lines = validSection.split(/\r?\n/);
  const dateRegex = /^(\d{2}\/\d{2}\/\d{4})/; 
  const amountRegex = /-?\d+[\d\s,]*\.\d{2}/g;

  let pendingTx = null;

  for (let line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.includes("Page of") || trimmed.includes("Balance")) continue;

    const dateMatch = trimmed.match(dateRegex);

    if (dateMatch) {
      if (pendingTx && pendingTx.amount !== null) transactions.push(pendingTx);

      const date = dateMatch[0];
      let content = trimmed.slice(date.length).trim();
      const amounts = content.match(amountRegex);
      
      let amount = null;
      let balance = null;
      let description = content;

      if (amounts && amounts.length > 0) {
        amount = parseFloat(amounts[0].replace(/\s|,/g, ''));
        // Balance is always the last currency match
        balance = parseFloat(amounts[amounts.length - 1].replace(/\s|,/g, ''));
        description = content.split(amounts[0])[0].trim();
      }

      pendingTx = { 
        date, 
        description, 
        amount, 
        balance, 
        accountNumber, 
        clientName, 
        approved: true 
      };

    } else if (pendingTx) {
      // Handle multiline description overflow
      const amounts = trimmed.match(amountRegex);
      if (!amounts) {
        const cleanText = trimmed.split(/\s{2,}/)[0];
        if (cleanText.length > 1) pendingTx.description += ` ${cleanText}`;
      }
    }
  }

  if (pendingTx && pendingTx.amount !== null) transactions.push(pendingTx);

  // Final Filter: Strictly 2025/2026 and exclude balance rows
  return transactions.filter(t => 
    (t.date.includes("/2025") || t.date.includes("/2026")) &&
    t.description.length > 2 &&
    !t.description.toLowerCase().includes('balance')
  );
};