// src/parsers/discovery_bank_transactions.js

export function parseDiscovery(text, sourceFile = "") {
  if (!text || typeof text !== "string") {
    return { metadata: {}, transactions: [] };
  }

  // ───── NORMALIZE TEXT (CRITICAL FIX) ─────
  let normalized = text.replace(/\r/g, "\n");

  // Insert newline before every transaction date
  normalized = normalized.replace(
    /(\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+20\d{2})/g,
    "\n$1"
  );

  const lines = normalized
    .split("\n")
    .map(l => l.trim())
    .filter(Boolean);

  // ───── METADATA ─────

  const accountMatch = normalized.match(/Transaction Account\s+(\d{8,16})/i);
  const accountNumber = accountMatch ? accountMatch[1] : null;

  const clientNameMatch = normalized.match(/(?:Mr|Mrs|Ms|Dr|Prof)\s+[A-Z][A-Za-z\s]+/);
  const clientName = clientNameMatch ? clientNameMatch[0].trim() : null;

  const openMatch = normalized.match(
    /Opening balance on\s+\d{1,2}\s+\w+\s+\d{4}\s+R([\d\s,.]+\.\d{2})/i
  );

  const openingBalance = openMatch
    ? parseMoney(openMatch[1])
    : 0;

  const closeMatch = normalized.match(
    /Closing balance on\s+\d{1,2}\s+\w+\s+\d{4}\s+R([\d\s,.]+\.\d{2})/i
  );

  const closingBalance = closeMatch
    ? parseMoney(closeMatch[1])
    : 0;

  let runningBalance = openingBalance;
  const transactions = [];

  const months = {
    Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
    Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12"
  };

  const txRegex =
    /^(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(20\d{2})\s+(.+?)\s+(-?\s?R[\d\s,.]+\.\d{2})/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(txRegex);

    if (!match) continue;

    const day = match[1].padStart(2, "0");
    const month = months[match[2]];
    const year = match[3];
    const date = `${year}-${month}-${day}`;

    let description = match[4].trim();
    const amount = parseMoney(match[5]);

    // Handle wrapped description lines
    const nextLine = lines[i + 1];
    if (
      nextLine &&
      !nextLine.match(/^\d{1,2}\s+\w+/) &&
      !nextLine.match(/R\s?\d/)
    ) {
      description += " " + nextLine.trim();
      i++;
    }

    runningBalance = parseFloat((runningBalance + amount).toFixed(2));

    transactions.push({
      date,
      description: description.toUpperCase(),
      amount,
      balance: runningBalance,
      account: accountNumber,
      clientName,
      bankName: "Discovery",
      sourceFile
    });
  }

  return {
    metadata: {
      accountNumber,
      clientName,
      openingBalance,
      closingBalance,
      bankName: "Discovery",
      sourceFile
    },
    transactions
  };
}

function parseMoney(val) {
  if (!val) return 0;

  let clean = val.replace(/[R,\s]/g, "");
  const isNegative = clean.includes("-");
  clean = clean.replace("-", "");

  const parsed = parseFloat(clean);
  if (isNaN(parsed)) return 0;

  return isNegative ? -parsed : parsed;
}