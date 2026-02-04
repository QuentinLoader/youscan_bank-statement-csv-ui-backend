import { extractAbsaMetadata } from './absa_metadata.js';

export const parseAbsa = (text) => {
  const transactions = [];
  
  // 1. Get Metadata
  const { account, clientName } = extractAbsaMetadata(text);

  // 2. Chunking Strategy
  // Split text by Date Pattern: DD / MM / YYYY (handling spaces in between)
  // ABSA PDFs often have spaces like "15 / 12 / 2025"
  const chunks = text.split(/(?=\d{1,2}\s?[\/-]\s?\d{2}\s?[\/-]\s?\d{4})/);

  chunks.forEach(chunk => {
    // Clean up the chunk (remove messy newlines)
    const flatChunk = chunk.replace(/\s+/g, " ").trim();
    
    // Ensure it starts with a valid date
    const dateMatch = flatChunk.match(/^(\d{1,2})\s?[\/-]\s?(\d{2})\s?[\/-]\s?(\d{4})/);
    if (!dateMatch) return;

    // Normalize Date to DD/MM/YYYY
    const date = `${dateMatch[1].padStart(2, '0')}/${dateMatch[2]}/${dateMatch[3]}`;

    // Skip summary lines
    if (flatChunk.toLowerCase().includes("balance brought forward") ||
        flatChunk.toLowerCase().includes("statement no")) {
      return;
    }

    // Extract Amounts: Look for numbers with optional trailing minus (50.00 or 60.00-)
    // We strictly take the FIRST two numbers found after the date. 
    // The first is the Transaction Amount, the second is the Balance.
    const amountRegex = /([\d\s]+[.,]\d{2}-?)/g;
    const allNumbers = flatChunk.match(amountRegex);

    if (allNumbers && allNumbers.length >= 2) {
      // Helper to clean ABSA numbers (trailing minus moves to front)
      const parseAbsaNum = (val) => {
        let clean = val.replace(/\s/g, ''); // Remove spaces
        let isNegative = clean.endsWith('-');
        if (isNegative) clean = clean.slice(0, -1); // Remove trailing -
        clean = clean.replace(/,/g, ''); // Remove commas
        return isNegative ? -parseFloat(clean) : parseFloat(clean);
      };

      let amount = parseAbsaNum(allNumbers[0]);
      const balance = parseAbsaNum(allNumbers[1]);

      // Description is text between Date and First Amount
      let description = flatChunk.split(allNumbers[0])[0].replace(dateMatch[0], "").trim();

      // Sign Detection / Correction
      // If no trailing minus, check keywords to flip sign for Debits
      const lowerDesc = description.toLowerCase();
      const debitKeywords = ["purchase", "fee", "debit", "withdrawal", "payment", "charge", "settlement"];
      const creditKeywords = ["credit", "deposit", "transfer from"];

      if (amount > 0 && debitKeywords.some(key => lowerDesc.includes(key)) && !creditKeywords.some(key => lowerDesc.includes(key))) {
        amount = -amount;
      }

      transactions.push({
        date,
        description: description.replace(/"/g, '""'), // Escape CSV quotes
        amount,
        balance,
        account,
        clientName,
        uniqueDocNo: "Check Header",
        bankName: "ABSA"
      });
    }
  });

  return transactions;
};