/**
 * YouScan V2
 * AI bank-statement extraction runner.
 *
 * Produces a strict structured AI candidate. Production uses its values
 * directly after assessment; offline shadow tools may still compare it.
 */

import { getAiConfig } from "../config.js";
import { AI_TASKS } from "../contracts.js";
import { AI_ERROR_CODES, AiError } from "../errors.js";
import { runAiTask } from "../runAiTask.js";
import {
  AI_BANK_STATEMENT_EXTRACTION_RESPONSE_SCHEMA,
  validateAiBankStatementExtractionData,
} from "./bankStatementContract.js";

const EXTRACTION_SYSTEM_PROMPT = `You are the YouScan V2 bank-statement extraction engine.
Extract only facts explicitly supported by the supplied statement text.
Return every transaction in source order; do not summarize, combine, omit or invent rows.
Keep dated zero-amount transaction-table rows, including rows whose printed balance is unchanged. Do not include headings, closing-balance lines or turnover summaries as transaction rows.
For transaction descriptions, preserve the source description/reference tokens in source order with whitespace normalization only. Do not silently drop embedded date codes or bank reference tokens such as ROL030726 merely because the transaction date is also returned separately.
For transaction amounts, use negative values for debits/outflows and positive values for credits/inflows only when the source supports the direction.
The amount field is the signed payment/receipt printed in the Money In/Money Out or transaction amount column, excluding any separately printed fee. The fee field is the signed separately printed fee that affects this same row's balance: charges are negative and refunds positive. Extract both columns independently with evidence; never omit the Fee/Charge column or derive a fee from balance differences.
For a fee-only row with no payment/receipt, return amount=0 and put the printed charge in fee. If no separate fee is printed, return fee.value=null and evidence=[]; do not count a fee twice if it is already included in a printed transaction amount. Preserve one transaction per source row. If a fee is unreadable or uncertain, use low fee confidence so the statement requires review rather than guessing.
An Accrued Bank Charges column records charges accrued for later posting; it is not a fee deducted from that row's balance. Do not put accrued charges in fee or add them to amount. Preserve the printed transaction amount, including zero, and return fee.value=null unless a separate charge is explicitly deducted on that row. Later posted service-fee transactions remain their own rows. If a column's meaning is uncertain, use low fee confidence; never resolve it by calculating balance differences.
For running balances, preserve the printed statement value and sign. If a running balance is not printed for a transaction, return null rather than deriving one.
For metadata or transaction fields that are not explicitly supported, return null where the schema allows it. Never guess an account number, client name, date, amount or balance.
Dates must be DD/MM/YYYY when they can be determined reliably.
For every populated field, provide one to three short evidence snippets copied from the supplied statement text. Evidence must support the field and must not be fabricated.
Each evidence snippet must be non-empty and at most 500 characters. For every null-valued field, return evidence=[]; do not attach explanations or evidence to a missing value.
Every field must include value, confidence (a number from 0 to 1), and evidence. Numeric values must be JSON numbers, never formatted strings with currency symbols or separators.
The transactionCount must exactly equal the number of transaction objects returned across all pages, including zero-amount rows. Count the returned table rows; never copy the statement's turnover-summary debit/credit counts, which may exclude zero-amount rows. For example, three table rows including one zero-amount row require transactionCount=3 even if the turnover summary counts only two transactions. Do not omit or invent rows to make the table agree with a summary count.
Overall confidence and field confidence must represent factual extraction certainty. Do not inflate confidence to satisfy thresholds.
Do not add commentary outside the strict response schema.`;

function normalizeSourceText(value) {
  return String(value || "")
    .replace(/\u0000/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

export async function aiBankStatementExtractor({
  extractedText = "",
  config = null,
  provider = null,
  logger = null,
} = {}) {
  const resolvedConfig = config || getAiConfig();

  if (!resolvedConfig.enabled || !resolvedConfig.extractionEnabled) {
    throw new AiError(
      AI_ERROR_CODES.DISABLED,
      "YouScan V2 AI bank-statement extraction is disabled"
    );
  }

  const documentText = normalizeSourceText(extractedText);
  if (!documentText) {
    throw new AiError(
      AI_ERROR_CODES.CONFIG_INVALID,
      "AI bank-statement extraction requires document text"
    );
  }

  return runAiTask({
    task: AI_TASKS.EXTRACT_BANK_STATEMENT,
    input: { documentText },
    systemPrompt: EXTRACTION_SYSTEM_PROMPT,
    responseSchema: AI_BANK_STATEMENT_EXTRACTION_RESPONSE_SCHEMA,
    validateData: validateAiBankStatementExtractionData,
    config: resolvedConfig,
    provider,
    logger,
  });
}

export { EXTRACTION_SYSTEM_PROMPT as AI_BANK_STATEMENT_EXTRACTION_SYSTEM_PROMPT };
