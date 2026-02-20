/**
 * Capitec Parser - Production Safe (Simplified Model + Metadata)
 * Adds:
 * - clientName
 * - statementId (Unique Document No)
 * - dynamic opening balance
 */

export const parseCapitec = (text) => {
  const transactions = [];

  const parseNum = (val) => {
    if (!val) return 0;
    let clean = val.replace(/[\s,]/g, '');
    let isNeg = clean.startsWith('-');
    clean = clean.replace(/[^0-9.]/g, '');
    const num = parseFloat(clean) || 0;
    return isNeg ? -Math.abs(num) : Math.abs(num);
  };

  // ------------------------------------------------------------------
  // 1️⃣ Metadata Extraction
  // ------------------------------------------------------------------

  // Account
  let account = "Unknown";
  const accountBlockMatch = text.match(/Account\s*\n\s*(\d{10,})/i);
  if (accountBlockMatch) {
    account = accountBlockMatch[1];
  } else {
    const fallbackMatch = text.match(/\b\d{10,11}\b/);
    if (fallbackMatch) account = fallbackMatch[0];
  }

  // Client Name (usually MR/MRS/MS etc in caps)
  let clientName = "Unknown";
  const nameMatch = text.match(/\b(MR|MRS|MS|DR)\s+[A-Z\s]+/);
  if (nameMatch) {
    clientName = nameMatch[0].trim();
  }

  // Statement ID (Unique Document No)
  let statementId = "Unknown";
  const statementMatch = text.match(/Unique Document No\.:\s*([a-f0-9\-]+)/i);
  if (statementMatch) {
    statementId = statementMatch[1];
  }

  // ------------------------------------------------------------------
  // 2️⃣ Isolate Transaction History
  // ------------------------------------------------------------------

  const startIndex = text.indexOf("Transaction History");
  if (startIndex === -1) {
    return {
      metadata: {
        accountNumber: account,
        clientName,
        statementId,
        bankName: "Capitec"
      },
      transactions: []
    };
  }

  let txSection = text.substring(startIndex);

  const footerIndex = txSection.indexOf("* Includes VAT");
  if (footerIndex !== -1) {
    txSection = txSection.substring(0, footerIndex);
  }

  const lines = txSection
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);

  // ------------------------------------------------------------------
  // 3️⃣ Reconstruct Multi-line Rows
  // ------------------------------------------------------------------

  const reconstructed = [];
  let currentRow = "";
  const dateRegex = /^\d{2}\/\d{2}\/\d{4}/;

  lines.forEach(line => {
    if (dateRegex.test(line)) {
      if (currentRow) reconstructed.push(currentRow.trim());
      currentRow = line;
    } else {
      currentRow += " " + line;
    }
  });

  if (currentRow) reconstructed.push(currentRow.trim());

  const filteredRows = reconstructed.filter(row =>
    !row.startsWith("Date Description")
  );

  // ------------------------------------------------------------------
  // 4️⃣ Parse Rows
  // ------------------------------------------------------------------

  let runningBalance = null;
  let openingBalance = null;

  filteredRows.forEach(row => {
    const dateMatch = row.match(/^(\d{2}\/\d{2}\/\d{4})/);
    if (!dateMatch) return;

    const date = dateMatch[1];
    let body = row.substring(date.length).trim();

    const numbers = body.match(/-?\d[\d\s,.]*/g);
    if (!numbers || numbers.length === 0) return;

    const balance = parseNum(numbers[numbers.length - 1]);

    let amount = 0;

    if (runningBalance === null) {
      const possibleAmount =
        numbers.length >= 2
          ? parseNum(numbers[numbers.length - 2])
          : 0;

      amount = possibleAmount;
      openingBalance = balance - amount;
      runningBalance = balance;
    } else {
      amount = balance - runningBalance;
      runningBalance = balance;
    }

    numbers.forEach(n => {
      body = body.replace(n, '');
    });

    const description = body.replace(/\s+/g, ' ').trim() || "Transaction";

    transactions.push({
      date,
      description,
      amount,
      balance,
      account,
      clientName,
      statementId,
      bankName: "Capitec"
    });
  });

  const closingBalance =
    transactions.length > 0
      ? transactions[transactions.length - 1].balance
      : null;

  return {
    metadata: {
      accountNumber: account,
      clientName,
      statementId,
      openingBalance,
      closingBalance,
      transactionCount: transactions.length,
      bankName: "Capitec"
    },
    transactions
  };
};