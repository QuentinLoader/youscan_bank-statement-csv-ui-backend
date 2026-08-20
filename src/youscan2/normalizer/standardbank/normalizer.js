/**
 * YouScan V2
 * Standard Bank transaction normalizer.
 *
 * Debit/credit direction is resolved in the extractor using the statement's
 * running balances. The normalizer must not second-guess that evidence from
 * description keywords such as "credit".
 */

function isValidDateString(value) {
  if (!value) return false;

  const match = String(value).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return false;

  const dd = Number(match[1]);
  const mm = Number(match[2]);
  const yyyy = Number(match[3]);
  const date = new Date(Date.UTC(yyyy, mm - 1, dd));

  return (
    yyyy >= 2000 &&
    yyyy <= 2100 &&
    date.getUTCFullYear() === yyyy &&
    date.getUTCMonth() === mm - 1 &&
    date.getUTCDate() === dd
  );
}

function extractStatementEndYear(statementPeriodEnd) {
  const text = String(statementPeriodEnd || "").trim();

  let match = text.match(/(\d{4})$/);
  if (match) return Number(match[1]);

  match = text.match(/\b(\d{4})\b/);
  if (match) return Number(match[1]);

  return new Date().getUTCFullYear();
}

function resolveYear(yy, statementEndYear) {
  const candidate = 2000 + Number(yy);

  if (candidate < statementEndYear - 2 || candidate > statementEndYear + 1) {
    return statementEndYear - 1;
  }

  return candidate;
}

function extractDateFromDescription(description, statementEndYear) {
  const text = String(description || "").trim();

  let match = text.match(/ROL(\d{2})(\d{2})(\d{2})/i);
  if (match) {
    const dd = match[1];
    const mm = match[2];
    const yyyy = resolveYear(Number(match[3]), statementEndYear);
    return `${dd}/${mm}/${yyyy}`;
  }

  match = text.match(/(?:^|\s)(\d{6})(?:$|\s)/);
  if (match) {
    const token = match[1];
    const dd = Number(token.slice(0, 2));
    const mm = Number(token.slice(2, 4));
    const yyyy = resolveYear(Number(token.slice(4, 6)), statementEndYear);
    const candidate = `${token.slice(0, 2)}/${token.slice(2, 4)}/${yyyy}`;

    if (isValidDateString(candidate)) return candidate;
  }

  return null;
}

function shouldRemoveTransaction(description) {
  const upper = String(description || "").toUpperCase();

  return (
    upper.includes("RTD-NOT PROVIDED FOR") ||
    upper === "##" ||
    upper.includes("FEE-UNPAID ITEM") ||
    upper.includes("UNPAID FEE DEBICHECK D/O") ||
    upper.includes("VAT SUMMARY") ||
    upper.includes("ACCOUNT SUMMARY") ||
    upper.includes("DETAILS OF AGREEMENT") ||
    upper.includes("THIS DOCUMENT CONSTITUTES A CREDIT NOTE") ||
    upper.includes("TOTAL VAT")
  );
}

function normalizeStandardBankTransaction(tx, statementEndYear) {
  const description = String(tx?.description || "").trim();

  const normalized = {
    date: tx?.date || null,
    description,
    amount:
      typeof tx?.amount === "number" && Number.isFinite(tx.amount)
        ? Number(tx.amount.toFixed(2))
        : null,
    balance:
      typeof tx?.balance === "number" && Number.isFinite(tx.balance)
        ? Number(tx.balance.toFixed(2))
        : null,
  };

  if (!isValidDateString(normalized.date)) {
    normalized.date = extractDateFromDescription(
      description,
      statementEndYear
    );
  }

  return normalized;
}

export function normalizeStandardBankTransactions(
  transactions = [],
  statementPeriodEnd = null
) {
  const list = Array.isArray(transactions) ? transactions : [];
  const statementEndYear = extractStatementEndYear(statementPeriodEnd);

  const normalized = [];

  for (const tx of list) {
    if (!tx) continue;
    if (shouldRemoveTransaction(tx.description)) continue;

    normalized.push(normalizeStandardBankTransaction(tx, statementEndYear));
  }

  return normalized;
}
