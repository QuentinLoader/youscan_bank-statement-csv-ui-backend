import { extractNedbankMetadata } from "./nedbank.metadata.js";

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
    if (/Tran\s+list\s+no/i.test(line)) {
      inTable = true;
      continue;
    }

    if (!inTable) continue;

    // Stop at closing balance
    if (/^Closing balance/i.test(line)) break;

    if (line.length < 5) continue;

    // Skip Opening balance row
    if (/Opening balance/i.test(line)) {
      continue;
    }

    /**
     * Match structure examples from your file:
     *
     * 26/06/2025 MAINTENANCE FEE 250.00 * 93.08
     * 27/06/2025 JHH FNB ACC. 400.00 493.08
     * 08/07/2025 A SARS 0331191155 221003 11,369.18 11,641.29
     * 000643 26/06/2025 VAT 28/05-25/06 = R41.73 0.00 343.27
     */

    const match = line.match(
      /(?:(\d{6})\s+)?(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+([\d,]+\.\d{2})\s*\*?\s+([\d,]+\.\d{2})$/
    );

    if (!match) continue;

    const date = match[2];
    const description = match[3].trim();

    const amountRaw = match[4];
    const balanceRaw = match[5];

    const balance = parseFloat(balanceRaw.replace(/,/g, ""));

    // Balance-driven calculation
    let amount = balance - runningBalance;

    if (amount > 0) {
      totalCredits += amount;
    } else {
      totalDebits += Math.abs(amount);
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

  // Final reconciliation
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