// src/parsers/discovery_bank_transactions.js

export function parseDiscovery(text, sourceFile = "") {
  if (!text || typeof text !== "string") {
    return { metadata: {}, transactions: [] };
  }

  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);

  // ─────────────────────────────────────────────
  // 1️⃣ METADATA EXTRACTION (HEADER ONLY)
  // ─────────────────────────────────────────────

  // Account number
  const accountMatch = text.match(/Transaction Account\s+(\d{8,16})/i);
  const accountNumber = accountMatch ? accountMatch[1] : null;

  // Client name (simple capture)
  const clientNameMatch = text.match(/(?:Mr|Mrs|Ms|Dr|Prof)\s+[A-Z][A-Za-z\s]+/);
  const clientName = clientNameMatch ? clientNameMatch[0].trim() : null;

  // Opening balance (strict match)
  const openMatch = text.match(
    /Opening balance on\s+\d{1,2}\s+\w+\s+\d{4}\s+R([\d\s,.]+\.\d{2})/i
  );

  const openingBalance = openMatch
    ? parseDiscoveryMoney(openMatch[1])
    : 0;

  // Closing balance (strict match)
  const closeMatch = text.match(
    /Closing balance on\s+\d{1,2}\s+\w+\s+\d{4}\s+R([\d\s,.]+\.\d{2})/i
  );

  const closingBalance = closeMatch
    ? parseDiscoveryMoney(closeMatch[1])
    : 0;

  let runningBalance = openingBalance;
  const transactions = [];

  const months = {
    Jan: "01",
    Feb: "02",
    Mar: "03",
    Apr: "04",
    May: "05",
    Jun: "06",
    Jul: "07",
    Aug: "08",
    Sep: "09",
    Oct: "10",
    Nov: "11",
    Dec: "12"
  };

  // ─────────────────────────────────────────────
  // 2️⃣ TRANSACTION ENGINE
  // Must start with: 8 Jan 2026 ...
  // ─────────────────────────────────────────────

  const txRegex =
    /^(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(20\d{2})\s+(.+?)\s+(-?\s?R[\d\s,.]+\.\d{2})$/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(txRegex);

    if (!match) continue;

    const day = match[1].padStart(2, "0");
    const month = months[match[2]];
    const year = match[3];

    // ISO format (production safe)
    const date = `${year}-${month}-${day}`;

    let description = match[4].trim();
    const amount = parseDiscoveryMoney(match[5]);

    // Handle multi-line descriptions
    const nextLine = lines[i + 1];
    if (
      nextLine &&
      !nextLine.match(/^\d{1,2}\s+\w+/) &&
      !nextLine.match(/R\s?\d/)
    ) {
      description += " " + nextLine.trim();
      i++;
    }

    // Running balance reconstruction
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

/**
 * Money parser
 * Handles:
 * - R prefix
 * - spaces in thousands
 * - negative sign before or after
 */
function parseDiscoveryMoney(val) {
  if (!val) return 0;

  let clean = val.replace(/[R,\s]/g, "");

  const isNegative = clean.includes("-");
  clean = clean.replace("-", "");

  const parsed = parseFloat(clean);

  if (isNaN(parsed)) return 0;

  return isNegative ? -parsed : parsed;
}