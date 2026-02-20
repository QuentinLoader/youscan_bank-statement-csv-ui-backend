// parsers/netbank.js

export function parseNetbank(text) {
  const lines = text
    .split("\n")
    .map(l => l.trim())
    .filter(Boolean);

  const transactions = [];

  // Accept both YYYY-MM-DD and DD/MM/YYYY
  const dateRegex = /^(\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4})/;

  for (const line of lines) {
    if (!dateRegex.test(line)) continue;

    const parts = line.split(/\s{2,}|\t/); // split on double space or tab

    if (parts.length < 2) continue;

    const date = parts[0];
    const description = parts.slice(1, -1).join(" ").trim();
    const amountRaw = parts[parts.length - 1];

    const amount = parseFloat(
      amountRaw.replace(/,/g, "").replace(/[^\d.-]/g, "")
    );

    if (isNaN(amount)) continue;

    transactions.push({
      date,
      description,
      amount
    });
  }

  console.log("Netbank parsed transactions:", transactions.length);

  return transactions;
}