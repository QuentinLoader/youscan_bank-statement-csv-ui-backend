// src/parsers/nedbank_transactions.js

export function parseNedbank(text) {
  if (!text || typeof text !== "string") return [];

  const lines = text
    .split("\n")
    .map(l => l.trim())
    .filter(Boolean);

  const transactions = [];

  let openingBalance = null;
  let closingBalance = null;

  const dateRegex = /^\d{2}\/\d{2}\/\d{4}/;

  for (const line of lines) {
    if (!dateRegex.test(line)) continue;

    // Split on 2+ spaces
    const parts = line.split(/\s{2,}/);

    if (parts.length < 2) continue;

    const date = parts[0];
    const description = parts[1] || "";

    // Opening balance row
    if (description.toLowerCase().includes("opening balance")) {
      const balance = extractLastNumber(parts);
      openingBalance = balance;
      continue;
    }

    // Extract debit / credit
    const numbers = parts
      .map(p => cleanNumber(p))
      .filter(n => n !== null);

    if (numbers.length === 0) continue;

    const balance = numbers[numbers.length - 1];

    // Detect amount (second last number)
    let amount = null;
    if (numbers.length >= 2) {
      amount = numbers[numbers.length - 2];
    }

    if (amount === null) continue;

    transactions.push({
      date,
      description,
      amount,
      balance
    });
  }

  if (transactions.length > 0) {
    closingBalance = transactions[transactions.length - 1].balance;
  }

  console.log("Nedbank parsed:", transactions.length);
  console.log("Opening:", openingBalance);
  console.log("Closing:", closingBalance);

  return {
    metadata: {
      openingBalance,
      closingBalance
    },
    transactions
  };
}

function cleanNumber(value) {
  const num = parseFloat(
    value.replace(/,/g, "").replace(/[^\d.-]/g, "")
  );
  return isNaN(num) ? null : num;
}

function extractLastNumber(parts) {
  for (let i = parts.length - 1; i >= 0; i--) {
    const num = cleanNumber(parts[i]);
    if (num !== null) return num;
  }
  return null;
}