export const parseCapitec = (text) => {
  const transactions = [];
  const lines = text.split('\n');

  // Regex to detect a Date (DD/MM/YYYY)
  const dateRegex = /^(\d{2}\/\d{2}\/\d{4})/;
  // Regex to detect an Amount (e.g., -150.00 or 2500.00)
  const amountRegex = /-?\d+[\d\s,]*\.\d{2}/;

  let currentTx = null;

  lines.forEach(line => {
    const trimmed = line.trim();
    if (!trimmed) return;

    const dateMatch = trimmed.match(dateRegex);

    if (dateMatch) {
      // If we were already building a transaction, save it before starting a new one
      if (currentTx) transactions.push(currentTx);

      const date = dateMatch[0];
      let remainingText = trimmed.replace(date, '').trim();

      // Look for the FIRST amount in the line (Money Out or Money In)
      const amounts = remainingText.match(amountRegex);
      let amount = 0;
      let description = remainingText;

      if (amounts) {
        // Clean the amount string and convert to float
        amount = parseFloat(amounts[0].replace(/\s|,/g, ''));
        // Description is everything between the date and the first amount
        description = remainingText.split(amounts[0])[0].trim();
      }

      currentTx = {
        date,
        description,
        amount,
        approved: true
      };
    } else if (currentTx && !trimmed.match(dateRegex)) {
      // LINE CONTINUATION: This line doesn't have a date, so it belongs 
      // to the description of the previous transaction.
      
      // We check if this line contains an amount (sometimes Capitec puts the amount on line 2)
      const extraAmountMatch = trimmed.match(amountRegex);
      
      if (extraAmountMatch && currentTx.amount === 0) {
        currentTx.amount = parseFloat(extraAmountMatch[0].replace(/\s|,/g, ''));
        // Clean the description by removing the amount found
        const extraDesc = trimmed.split(extraAmountMatch[0])[0].trim();
        if (extraDesc) currentTx.description += ` ${extraDesc}`;
      } else {
        // Just text? Append it to the description
        // Avoid appending the "Balance" or "Category" columns if they are separate
        const cleanExtra = trimmed.split(/\s{2,}/)[0]; 
        currentTx.description += ` ${cleanExtra}`;
      }
    }
  });

  // Push the very last transaction
  if (currentTx) transactions.push(currentTx);

  // Clean up: Remove summary lines like "Opening Balance" or "Fee Summary"
  return transactions.filter(t => 
    !t.description.toLowerCase().includes('balance') && 
    !t.description.toLowerCase().includes('summary')
  );
};