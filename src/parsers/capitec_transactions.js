/**
 * Capitec Parser - Production Safe (Simplified Model + Full Metadata)
 *
 * Returns:
 * {
 *   metadata: {
 *     accountNumber,
 *     clientName,
 *     statementId,
 *     openingBalance,
 *     closingBalance,
 *     transactionCount,
 *     bankName
 *   },
 *   transactions: [
 *     { date, description, amount, balance, account, clientName, statementId, bankName }
 *   ]
 * }
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
  // 1️⃣ METADATA EXTRACTION
  // ------------------------------------------------------------------

  // Account Number (handles newline layout)
  let account = "Unknown";
  const accountMatch = text.match(/Account\s*\n\s*(\d{10,})/i);
  if (accountMatch) {
    account = accountMatch[1];
  } else {
    const fallbackAccount = text.match(/\b\d{10,11}\b/);
    if (fallbackAccount) account = fallbackAccount[0];
  }

  // Client Name (anchored to Main Account Statement block)
  let clientName = "Unknown";

  const anchoredNameMatch = text.match(
    /Main Account Statement\s*\n\s*(MR|MRS|MS|DR)\s+[A-Z\s]+/i
  );

  if (anchoredNameMatch) {
    clientName = anchoredNameMatch[0]
      .replace(/Main Account Statement/i, "")
      .trim();
  } else {
    const fallbackName = text.match(/\b(MR|MRS|MS|DR)\s+[A-Z]+\s+[A-Z]+/);
    if (fallbackName) {
      clientName = fallbackName[0].trim();
    }
  }

  // Statement ID (Unique Document No)
  let statementId = "Unknown";
  const statementMatch = text.match(/Unique Document No\.:\s*([a-f0-9\-]+)/i);
  if (statementMatch) {
    statementId = statementMatch[1];
  }

  // ------------------------------------------------------------------
  // 2️⃣ ISOLATE TRANSACTION HISTORY SECTION
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
  // 3️⃣ RECONSTRUCT MULTI-LINE ROWS
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
  // 4️⃣ PARSE ROWS (BALANCE-DRIVEN)
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

    // Clean description
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