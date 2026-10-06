/**
 * YouScan V2
 * Projects AI payment/fee fields into canonical account movements, retaining
 * the separate source values when a fee is attached. Balances stay untouched.
 */

function valueOf(field) {
  return field?.value ?? null;
}

export function projectAiBankStatementCandidate(candidate, { sourceFileName = null } = {}) {
  return {
    bankName: valueOf(candidate?.bankName),
    accountNumber: valueOf(candidate?.accountNumber),
    clientName: valueOf(candidate?.clientName),
    statementPeriodStart: valueOf(candidate?.statementPeriodStart),
    statementPeriodEnd: valueOf(candidate?.statementPeriodEnd),
    openingBalance: valueOf(candidate?.openingBalance),
    closingBalance: valueOf(candidate?.closingBalance),
    sourceFileName,
    transactions: Array.isArray(candidate?.transactions)
      ? candidate.transactions.map((transaction) => ({
          date: valueOf(transaction?.date),
          description: valueOf(transaction?.description) ?? "",
          // Arithmetic uses only independently extracted AI fields, never balances.
          amount: valueOf(transaction?.fee) && typeof valueOf(transaction?.amount) === "number"
            ? Math.round((valueOf(transaction.amount) + valueOf(transaction.fee)) * 100) / 100
            : valueOf(transaction?.amount),
          ...(valueOf(transaction?.fee) ? {
            paymentAmount: valueOf(transaction.amount),
            fee: valueOf(transaction.fee),
          } : {}),
          balance: valueOf(transaction?.balance),
        }))
      : [],
  };
}
