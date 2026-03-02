// src/parsers/discovery_bank_transactions.js

export function parseDiscovery(text, sourceFile = "") {
  if (!text || typeof text !== "string") {
    return { metadata: {}, transactions: [] };
  }

  const cleanText = text.replace(/\r/g, "");

  // ───── METADATA ─────

  const accountNumberMatch =
    cleanText.match(/Transaction Account[^\d]*(\d{8,16})/i) ||
    cleanText.match(/Account\s+(\d{8,16})/i);

  const accountNumber = accountNumberMatch ? accountNumberMatch[1] : null;

  const clientNameMatch =
    cleanText.match(/(?:Mr|Mrs|Ms|Dr|Prof)\s+[A-Za-z\s]+/);

  const clientName = clientNameMatch ? clientNameMatch[0].trim() : null;

  const openingBalanceMatch =
    cleanText.match(/Opening balance[^\d-]+(-?\s?R[\d\s,.-]+\.\d{2})/i);

  const openingBalance = openingBalanceMatch
    ? parseMoney(openingBalanceMatch[1])
    : 0;

  const closingBalanceMatch =
    cleanText.match(/Closing balance[^\d-]+(-?\s?R[\d\s,.-]+\.\d{2})/i);

  const closingBalance = closingBalanceMatch
    ? parseMoney(closingBalanceMatch[1])
    : 0;

  const periodMatch =
    cleanText.match(/Statement period\s+(\d{1,2}\s+\w+\s+\d{4})\s*-\s*(\d{1,2}\s+\w+\s+\d{4})/i);

  const statementPeriod = periodMatch
    ? { start: periodMatch[1], end: periodMatch[2] }
    : null;

  const transactions = [];
  let runningBalance = openingBalance;

  const months = {
    Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
    Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12"
  };

  // ───── LINE NORMALIZATION FIX ─────
  // Force newline before transaction dates
  const normalized = cleanText.replace(
    /(\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+20\d{2})/g,
    "\n$1"
  );

  const lines = normalized.split("\n").map(l => l.trim()).filter(Boolean);

  const txRegex =
    /^(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(20\d{2})/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const dateMatch = line.match(txRegex);
    if (!dateMatch) continue;

    const day = dateMatch[1].padStart(2, "0");
    const monthKey = dateMatch[2].substring(0, 3);
    const month =
      months[monthKey.charAt(0).toUpperCase() + monthKey.substring(1).toLowerCase()];
    const year = dateMatch[3];

    const date = `${year}-${month}-${day}`;

    // Join wrapped lines until we hit amount
    let fullLine = line;
    let lookAhead = 1;

    while (
      i + lookAhead < lines.length &&
      !lines[i + lookAhead].match(txRegex)
    ) {
      fullLine += " " + lines[i + lookAhead];
      lookAhead++;
    }

    const amountMatch = fullLine.match(/(-?\s?R[\d\s,.]+\.\d{2})/);
    if (!amountMatch) continue;

    const amount = parseMoney(amountMatch[1]);

    let description = fullLine
      .replace(dateMatch[0], "")
      .replace(amountMatch[0], "")
      .replace(/\*\*\*\d{4}/g, "")
      .replace(/POS Purchase|RPP|Online|EFT|Fee|Interest|Reward|Declined Int Card Purch|Transfer|Details|Amount|Type/gi, "")
      .replace(/,/g, " ")
      .trim();

    description = description.replace(/\s+/g, " ").toUpperCase() || "UNKNOWN";

    runningBalance = Number((runningBalance + amount).toFixed(2));

    transactions.push({
      date,
      description,
      amount,
      balance: runningBalance,
      account: accountNumber,
      clientName,
      bankName: "Discovery",
      sourceFile
    });

    i += lookAhead - 1;
  }

  return {
    metadata: {
      accountNumber,
      clientName,
      openingBalance,
      closingBalance,
      statementPeriod,
      bankName: "Discovery",
      sourceFile
    },
    transactions
  };
}

function parseMoney(val) {
  if (!val) return 0;

  let clean = val.replace(/[R,\s]/g, "");

  const negative = clean.includes("-");
  clean = clean.replace("-", "");

  const parsed = parseFloat(clean);
  if (isNaN(parsed)) return 0;

  return negative ? -parsed : parsed;
}