/**
 * YouScan V2
 * Capitec transaction normalizer.
 */

function finiteOrNull(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? Number(value.toFixed(2))
    : null;
}

export function normalizeCapitecTransactions(transactions = []) {
  const list = Array.isArray(transactions) ? transactions : [];

  return list
    .filter(Boolean)
    .map((tx) => ({
      date: tx?.date || null,
      description: String(tx?.description || "").trim(),
      amount: finiteOrNull(tx?.amount),
      balance: finiteOrNull(tx?.balance),
    }));
}
