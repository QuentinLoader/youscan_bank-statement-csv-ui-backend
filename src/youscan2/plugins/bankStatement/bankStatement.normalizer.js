/**
 * YouScan 2.0
 * Bank statement normalizer
 */

export async function normalizeBankStatement(raw) {
  return {
    bankName: "unknown",
    accountNumber: null,
    clientName: null,
    statementPeriodStart: null,
    statementPeriodEnd: null,
    openingBalance: null,
    closingBalance: null,
    transactions: raw?.transactions || [],
    sourceFileName: raw?.sourceFileName || null,
  };
}