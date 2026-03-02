// src/parsers/discovery_bank_transactions.js

export function parseDiscovery(text, sourceFile = "") {
  if (!text || typeof text !== "string") {
    return { metadata: {}, transactions: [] };
  }

  // Normalize: Remove quotes and handle line breaks
  const cleanText = text.replace(/"/g, "").replace(/\r/g, "\n");
  const lines = cleanText.split("\n").map(l => l.trim()).filter(Boolean);

  // --- Metadata Extraction ---
  const accountNumber = (cleanText.match(/Transaction Account\s+(\d{10,13})/i) || [])[1] || null; [cite: 10]
  const clientName = (cleanText.match(/(?:Mr|Mrs|Ms|Dr)\s+([A-Z][a-z]+\s[A-Z][a-z]+)/) || [])[0] || null; [cite: 3, 22]
  
  // Find Opening/Closing balances specifically from the summary table
  const openingBalance = parseMoney((cleanText.match(/Opening balance on\s+\d+\s+\w+\s+\d{4}\s+R?([\d\s,.-]+\.\d{2})/i) || [])[1]); [cite: 10, 14]
  const closingBalance = parseMoney((cleanText.match(/Closing balance on\s+\d+\s+\w+\s+\d{4}\s+R?([\d\s,.-]+\.\d{2})/i) || [])[1]); [cite: 10, 19]

  const transactions = [];
  let runningBalance = openingBalance;

  const months = { 
    Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", 
    Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" 
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Look for lines starting with "D MMM YYYY" or "DD MMM YYYY"
    const dateMatch = line.match(/^(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(20\d{2})/); [cite: 14, 19]
    
    if (dateMatch) {
      const day = dateMatch[1].padStart(2, "0");
      const month = months[dateMatch[2]];
      const year = dateMatch[3];
      const date = `${year}-${month}-${day}`;

      // Extract amount: Usually the last "R XX.XX" or "- R XX.XX" on the line
      const amountMatch = line.match(/(-?\s?R[\d\s,.]+\.\d{2})\s*$/); [cite: 14, 19]
      
      if (amountMatch) {
        const amountStr = amountMatch[1];
        const amount = parseMoney(amountStr);
        
        // Description is everything between the date and the amount
        let description = line
          .replace(dateMatch[0], "")
          .replace(amountStr, "")
          .replace(/,/g, " ")
          .trim();

        // Handle multi-line descriptions (peek at next line)
        if (i + 1 < lines.length) {
          const nextLine = lines[i + 1];
          // If next line doesn't start with a date, amount, or "Closing balance", it's a sub-description
          if (!nextLine.match(/^\d{1,2}\s+\w+/) && !nextLine.match(/R\d/) && !nextLine.includes("balance")) {
            description += " " + nextLine;
            i++; 
          }
        }

        runningBalance = Number((runningBalance + amount).toFixed(2));

        transactions.push({
          date,
          description: description.toUpperCase().replace(/\s+/g, " "),
          amount,
          balance: runningBalance,
          account: accountNumber,
          clientName,
          bankName: "Discovery",
          sourceFile
        });
      }
    }
  }

  return {
    metadata: { accountNumber, clientName, openingBalance, closingBalance, bankName: "Discovery", sourceFile },
    transactions
  };
}

function parseMoney(val) {
  if (!val) return 0;
  // Remove currency, commas, and spaces; handle negative sign correctly
  const clean = val.replace(/[R,\s]/g, "");
  return parseFloat(clean) || 0;
}