function normalizeAbsaDate(value) {
  if (!value) return null;

  const raw = String(value).trim();
  const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);

  if (!match) {
    return raw;
  }

  const [, day, month, year] = match;

  return `${day.padStart(2, "0")}/${month.padStart(2, "0")}/${year}`;
}

export function normalizeAbsaTransactions(transactions = []) {
  const list = Array.isArray(transactions) ? transactions : [];

  return list
    .filter(Boolean)
    .map((tx) => ({
      date: normalizeAbsaDate(tx?.date),
      description: String(tx?.description || "").trim(),
      amount: typeof tx?.amount === "number" ? tx.amount : null,
      balance: typeof tx?.balance === "number" ? tx.balance : null,
    }));
}
