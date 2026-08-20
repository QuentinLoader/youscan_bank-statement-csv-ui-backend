/**
 * YouScan V2
 * AI bank-statement extraction runner.
 *
 * Batch 12 is shadow-only. This module can ask an AI provider for a strict
 * structured extraction candidate, but it does not merge, replace or mutate
 * deterministic parser output.
 */

import { getAiConfig } from "../config.js";
import { AI_TASKS } from "../contracts.js";
import { AI_ERROR_CODES, AiError } from "../errors.js";
import { runAiTask } from "../runAiTask.js";
import {
  AI_BANK_STATEMENT_EXTRACTION_RESPONSE_SCHEMA,
  validateAiBankStatementExtractionData,
} from "./bankStatementContract.js";

const EXTRACTION_SYSTEM_PROMPT = `You are the YouScan V2 bank-statement extraction engine operating in shadow mode.
Extract only facts explicitly supported by the supplied statement text.
Return every transaction in source order; do not summarize, combine, omit or invent rows.
For transaction descriptions, preserve the source description/reference tokens in source order with whitespace normalization only. Do not silently drop embedded date codes or bank reference tokens such as ROL030726 merely because the transaction date is also returned separately.
For transaction amounts, use negative values for debits/outflows and positive values for credits/inflows only when the source supports the direction.
For running balances, preserve the printed statement value and sign. If a running balance is not printed for a transaction, return null rather than deriving one.
For metadata or transaction fields that are not explicitly supported, return null where the schema allows it. Never guess an account number, client name, date, amount or balance.
Dates must be DD/MM/YYYY when they can be determined reliably.
For every populated field, provide one to three short evidence snippets copied from the supplied statement text. Evidence must support the field and must not be fabricated.
The transactionCount must exactly equal the number of transaction objects returned.
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
