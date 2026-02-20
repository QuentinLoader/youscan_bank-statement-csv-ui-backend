// src/parsers/nedbank_transactions.js

export function parseNedbank(text) {
  if (!text || typeof text !== "string") {
    return [];
  }

  const lines = text
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);

  const transactions = [];

  // Accept YYYY-MM-DD OR DD/MM/YYYY
  const dateRegex = /^(\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4})/;

  for (const line of lines) {
    if (!dateRegex.test(line)) continue;

    // Split on 2+ spaces or tabs
    const parts = line.split(/\s{2,}|\t/);

    if (parts.length < 2) continue;

    const date = parts[0];
    const amountRaw = parts[parts.length - 1];

    const amount = parseFloat(
      amountRaw
        .replace(/,/g, "")
        .replace(/[^\d.-]/g, "")
    );

    if (isNaN(amount)) continue;

    const description = parts.slice(1, -1).join(" ").trim();

    transactions.push({
      date,
      description,
      amount,
    });
  }

  console.log("Nedbank transactions parsed:", transactions.length);

  return transactions;
}