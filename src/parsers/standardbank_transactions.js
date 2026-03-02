// src/parsers/standard_bank_transactions.js

export function parseStandardBank(text, sourceFile = "") {
  if (!text || typeof text !== "string") {
    return {
      metadata: { bankName: "Standard Bank" },
      transactions: []
    };
  }

  const cleanText = text.replace(/\r/g, "");
  const lowerText = cleanText.toLowerCase();

  // Basic metadata extraction
  const accountMatch = cleanText.match(/account number\s*([\d\s]+)/i);
  const accountNumber = accountMatch
    ? accountMatch[1].replace(/\s/g, "")
    : "UNKNOWN";

  const clientMatch = cleanText.match(/mr\.\s+[a-z\s]+/i);
  const clientName = clientMatch
    ? clientMatch[0].toUpperCase()
    : "UNKNOWN";

  // Very basic transaction detection
  const txMatch = cleanText.match(
    /([A-Z\s\-]+)\s+([\d,]+\.\d{2}-?)\s+(\d{2})\s+(\d{2})\s+([\d,]+\.\d{2}-?)/i
  );

  const transactions = [];

  if (txMatch) {
    const description = txMatch[1].trim();
    const amount = parseMoney(txMatch[2]);
    const month = txMatch[3];
    const day = txMatch[4];
    const balance = parseMoney(txMatch[5]);

    const yearMatch = cleanText.match(/\b20\d{2}\b/);
    const year = yearMatch ? yearMatch[0] : new Date().getFullYear();

    transactions.push({
      date: `${year}-${month}-${day}`,
      description,
      amount,
      balance,
      account: accountNumber,
      clientName,
      bankName: "Standard Bank",
      sourceFile
    });
  }

  return {
    metadata: {
      accountNumber,
      clientName,
      bankName: "Standard Bank",
      sourceFile
    },
    transactions
  };
}

function parseMoney(val) {
  if (!val) return 0;
  let clean = val.replace(/[R\s]/g, "");

  if (clean.endsWith("-")) {
    clean = "-" + clean.slice(0, -1);
  }

  clean = clean.replace(/,/g, "");

  return parseFloat(clean) || 0;
}