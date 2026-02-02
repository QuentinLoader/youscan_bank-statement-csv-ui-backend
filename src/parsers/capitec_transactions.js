export function parseCapitec(text) {
    const transactions = [];
    // This regex looks for: Date (DD/MM/YYYY) followed by text and then a Currency Amount
    // It is designed to handle the "stacked" text seen in your logs.
    const rowRegex = /(\d{2}\/\d{2}\/\d{4})[\s\S]*?([\d\s,.-]+\.\d{2})/g;
    
    // Split text into lines to clean up weird PDF spacing
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    
    let currentDate = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // 1. Check if the line is a Date
        const dateMatch = line.match(/^(\d{2}\/\d{2}\/\d{4})$/);
        if (dateMatch) {
            currentDate = dateMatch[1];
            continue;
        }

        // 2. If we have a date, look for the description and amount
        // Capitec often puts Amount on the line immediately following the description
        if (currentDate && line.match(/[R-]?[\d\s,]+\.\d{2}/)) {
            const amount = parseCurrency(line);
            const description = lines[i - 1] || "Unknown Transaction";

            transactions.push({
                date: currentDate,
                description: description,
                amount: amount,
                // We'll set balance to 0 if it's not easily found on the same line
                balance: 0 
            });
            
            // Reset date to prevent accidental duplicates unless another date is found
            currentDate = null; 
        }
    }

    if (transactions.length === 0) {
        throw new Error("CAPITEC_NO_TRANSACTIONS");
    }

    return transactions;
}

function parseCurrency(val) {
    // Removes 'R', spaces, and commas, then converts to float
    return parseFloat(val.replace(/[R\s,]/g, '')) || 0;
}