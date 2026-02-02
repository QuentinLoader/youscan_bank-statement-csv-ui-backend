import pdf from "pdf-parse";
import { detectBank } from "../core/detectBank.js";
import { extractTransactionSection } from "../core/extractTransactionSection.js";
import { extractCapitecMetadata } from "../parsers/capitec.metadata.js";
import { extractFnbMetadata } from "../parsers/fnb.metadata.js";
import { parseCapitecTransactions } from "../parsers/capitec.transactions.js";
import { parseFnbTransactions } from "../parsers/fnb.transactions.js";
import { validateLedger } from "../core/validateLedger.js"; // This path is now correct!

export async function parseStatement(buffer) {
  const { text } = await pdf(buffer);
  const bank = detectBank(text);

  let metadata, transactions;

  if (bank === "capitec") {
    metadata = extractCapitecMetadata(text);
    const section = extractTransactionSection(text, bank);
    transactions = parseCapitecTransactions(section);
  }

  if (bank === "fnb") {
    metadata = extractFnbMetadata(text);
    const section = extractTransactionSection(text, bank);
    transactions = parseFnbTransactions(section);
  }

  const ledgerCheck = validateLedger(transactions, metadata);

  return {
    statement: metadata,
    transactions,
    warnings: ledgerCheck.warnings
  };
}