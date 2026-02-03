export const parseCapitec = (text) => {
  const transactions = [];
  
  // 1. BOUNDARY LOGIC: Only look at text between these headers
  const startMarker = "Transaction History";
  const endMarker = "Unique Document No";
  
  let targetText = text;
  if (text.includes(startMarker)) {
    targetText = text.split(startMarker)[1]; // Toss out everything before history
  }
  if (targetText.includes(endMarker)) {
    targetText = targetText.split(endMarker)[0]; // Toss out everything after history
  }

  const lines = targetText.split(/\r?\n/);
  const dateRegex = /^(\d{2}\/\d{2}\/\d{4})/; // Strict: Date MUST start the line
  const amountRegex = /(-?\d+[\d\s,]*\.\d{2})/;

  let pendingTx = null;

  for (let line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === "Date Description Category Money In Money Out Fee* Balance") continue;

    const dateMatch = trimmed.match(dateRegex);

    if (dateMatch) {
      if (pendingTx && pendingTx.amount !== null) transactions.push(pendingTx);

      const date = dateMatch[0];
      let content = trimmed.replace(date, '').trim();
      
      const amountMatch = content.match(amountRegex);
      let amount = null;
      let description = content;

      if (amountMatch) {
        amount = parseFloat(amountMatch[0].replace(/\s|,/g, ''));
        description = content.split(amountMatch[0])[0].trim();
      }

      pendingTx = { date, description, amount, approved: true };

    } else if (pendingTx) {
      // Continuation line for multiline descriptions
      const amountMatch = trimmed.match(amountRegex);
      if (amountMatch && pendingTx.amount === null) {
        pendingTx.amount = parseFloat(amountMatch[0].replace(/\s|,/g, ''));
        pendingTx.description += ` ${trimmed.split(amountMatch[0])[0].trim()}`;
      } else if (!amountMatch) {
        // Clean noise from merged columns
        const cleanPart = trimmed.split(/\s{2,}/)[0];
        if (cleanPart.length > 1) pendingTx.description += ` ${cleanPart}`;
      }
    }
  }

  if (pendingTx && pendingTx.amount !== null) transactions.push(pendingTx);

  // Final validation: Ensure we only keep real transactions
  return transactions.filter(t => 
    t.date.startsWith("2025") || t.date.includes("/2026") || t.date.includes("/2025")
  ).filter(t => !t.description.toLowerCase().includes('balance'));
};