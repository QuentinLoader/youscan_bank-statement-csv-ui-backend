export function parseCapitec(text) {
    const transactions = [];
    // Split into lines and remove empty ones
    const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    
    // Pattern for Date: DD/MM/YYYY
    const dateRegex = /^(\d{2}\/\d{2}\/\d{4})$/;
    // Pattern for Currency: handles -R100.00, 100.00, or -100.00
    const amountRegex = /[R-]?[\d\s,]+\.\d{2}/;

    let tempTransaction = { date: null, description: null };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // 1. If line is a Date, start a new transaction "block"
        if (dateRegex.test(line)) {
            tempTransaction = { date: line, description: null };
            continue;
        }

        // 2. If we have a date but no description yet, this line is the description
        if (tempTransaction.date && !tempTransaction.description) {
            tempTransaction.description = line;
            continue;
        }

        // 3. Look for the amount associated with the current date/description
        if (tempTransaction.date && tempTransaction.description && amountRegex.test(line)) {
            const amount = parseCurrency(line);
            
            // Capitec PDF rows often list Fee and Balance after the amount.
            // We verify if this looks like a valid amount line.
            transactions.push({
                date: tempTransaction.date,
                description: tempTransaction.description,
                amount: amount,
                balance: 0 // Defaulting to 0 if balance isn't easily tied to the row
            });

            // Reset for next potential match
            tempTransaction = { date: null, description: null };
        }
    }

    if (transactions.length === 0) {
        throw new Error("No transactions found. Please ensure this is a Capitec Transaction History page.");
    }

    return transactions;
}

function parseCurrency(val) {
    // Strips R, spaces, and commas, then converts to a negative/positive float
    const cleanValue = val.replace(/[R\s,]/g, '');
    return parseFloat(cleanValue) || 0;
}