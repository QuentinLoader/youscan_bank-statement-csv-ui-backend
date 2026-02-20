/**
 * Standard Bank Parser
 * Strategy: Money-first + balance-driven correction (FNB style)
 */

import { extractStandardBankMetadata } from "./standardbank_metadata.js";

export const parseStandardBank = (text) => {
  const metadata = extractStandardBankMetadata(text);
  const transactions = [];

  const lines = text.split("\n");

  let inTable = false;
  let runningBalance = metadata.openingBalance;
  let totalCredits = 0;
  let totalDebits = 0;
  let currentDescription = "";

  for (let rawLine of lines) {
    const line = rawLine.trim();

    if (line.includes("Details Service")) {
      inTable = true;
      continue;
    }

    if (!inTable) continue;
    if (line.includes("VAT Summary")) break;
    if (line.length < 5) continue;

    // Match: Description Debits/Credits Date Balance
    const match = line.match(
      /(.+?)\s+([\d,]+\.\d{2}-?)?\s+(\d{2})\s+(\d{2})\s+([\d,]+\.\d{2}-?)/
    );

    if (!match) {
      // Handle multi-line continuation
      currentDescription += " " + line;
      continue;
    }

    let description = (currentDescription + " " + match[1]).trim();
    currentDescription = "";

    const month = match[3];
    const day = match[4];
    const year = metadata.periodStart
      ? metadata.periodStart.slice(-4)
      : new Date().getFullYear();

    const date = `${day}/${month}/${year}`;

    const amountRaw = match[2] || "";
    const balanceRaw = match[5];

    const balance = parseFloat(balanceRaw.replace(/[, -]/g, "")) *
      (balanceRaw.includes("-") ? -1 : 1);

    let amount = 0;

    if (amountRaw) {
      amount =
        parseFloat(amountRaw.replace(/[, -]/g, "")) *
        (amountRaw.includes("-") ? -1 : 1);
    } else {
      // fallback via reconciliation
      amount = balance - runningBalance;
    }

    if (amount > 0) totalCredits += amount;
    else totalDebits += Math.abs(amount);

    runningBalance = balance;

    transactions.push({
      date,
      description: description.trim(),
      amount,
      balance,
      account: metadata.account,
      clientName: metadata.clientName,
      statementId: metadata.statementDate,
      bankName: metadata.bankName
    });
  }

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