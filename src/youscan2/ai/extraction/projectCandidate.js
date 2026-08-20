/**
 * YouScan V2
 * Converts a strict AI extraction candidate to the canonical bank-statement
 * data shape for validation/comparison only.
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
          amount: valueOf(transaction?.amount),
          balance: valueOf(transaction?.balance),
        }))
      : [],
  };
}
