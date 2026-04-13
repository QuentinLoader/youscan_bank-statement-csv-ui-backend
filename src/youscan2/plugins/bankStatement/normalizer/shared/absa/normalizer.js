export function normalizeAbsaTransactions(transactions = []) {
  const list = Array.isArray(transactions) ? transactions : [];

  return list
    .filter(Boolean)
    .map((tx) => ({
      date: tx?.date || null,
      description: String(tx?.description || "").trim(),
      amount: typeof tx?.amount === "number" ? tx.amount : null,
      balance: typeof tx?.balance === "number" ? tx.balance : null,
    }))
    .filter((tx) => tx.description);
}