import { buildBankStatementNormalization } from "../../normalizer/index.js";

export async function normalizeBankStatement(raw) {
  return buildBankStatementNormalization(raw);
}