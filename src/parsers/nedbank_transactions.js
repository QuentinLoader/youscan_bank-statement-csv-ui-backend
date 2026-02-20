import { extractNedbankMetadata } from "./nedbank_metadata.js";

export const parseNedbank = (text) => {
  const metadata = extractNedbankMetadata(text);
  const transactions = [];

  const lines = text.split("\n");

  let inTable = false;
  let runningBalance = metadata.openingBalance;
  let totalCredits = 0;
  let totalDebits = 0;

  for (let rawLine of lines) {
    const line = rawLine.trim();

    // Detect start of transaction table
    if (line.includes("Tran list no") && line.includes("Balance")) {
      inTable = true;
      continue;
    }

    if (!inTable) continue;
    if (line.toLowerCase().includes("closing balance")) break;
    if (line.length < 5) continue;

    // Match: Date Description Fees Debits Credits Balance
    const match = line.match(
      /(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+([\d,]*\.?\d{0,2})?\s*([\d,]*\.?\d{0,2})?\s*([\d,]*\.?\d{0,2})?\s+([\d,]+\.\d{2})/
    );

    if (!match) continue;

    const date = match[1];
    const description = match[2].trim();

    const fees = match[3] ? parseFloat(match[3].replace(/,/g, "")) : 0;
    const debit = match[4] ? parseFloat(match[4].replace(/,/g, "")) : 0;
    const credit = match[5] ? parseFloat(match[5].replace(/,/g, "")) : 0;
    const balance = parseFloat(match[6].replace(/,/g, ""));

    let amount = 0;

    if (credit > 0) {
      amount = credit;
      totalCredits += credit;
    } else if (debit > 0) {
      amount = -debit;
      totalDebits += debit;
    } else if (fees > 0) {
      amount = -fees;
      totalDebits += fees;
    } else {
      // fallback reconciliation
      amount = balance - runningBalance;
      if (amount > 0) totalCredits += amount;
      else totalDebits += Math.abs(amount);
    }

    runningBalance = balance;

    transactions.push({
      date,
      description,
      amount,
      balance,
      account: metadata.account,
      clientName: metadata.clientName,
      statementId: metadata.statementDate,
      bankName: metadata.bankName
    });
  }

  // Reconciliation
  const calculatedClosing =
    metadata.openingBalance + totalCredits - totalDebits;

  const reconciliationOk =
    Math.abs(calculatedClosing - metadata.closingBalance) < 0.02;

  return {
    metadata: {
      ...metadata,
      totalCredits,
      totalDebits,
      reconciliationOk,
      transactionCount: transactions.length
    },
    transactions
  };
};