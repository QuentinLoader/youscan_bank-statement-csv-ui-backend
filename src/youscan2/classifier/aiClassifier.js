/**
 * YouScan V2
 * AI classification fallback.
 *
 * Batch 10 uses AI for document classification only. It never extracts or
 * modifies bank-statement transactions.
 */

import { AI_TASKS } from "../ai/contracts.js";
import { getAiConfig } from "../ai/config.js";
import { runAiTask } from "../ai/runAiTask.js";
import {
  AI_CLASSIFICATION_RESPONSE_SCHEMA,
  validateAiClassificationData,
} from "./aiClassificationContract.js";

const CLASSIFICATION_SYSTEM_PROMPT = `You are the YouScan V2 document classifier.
Classify the supplied document only. Do not extract transactions, balances, account numbers, names, addresses, or other financial details.
Use the document text as the primary evidence. A filename may support a conclusion but must never be the sole basis for classification.
Only return values allowed by the response schema.
For bank statements, distinguish ABSA, FNB/First National Bank, Nedbank, Capitec, Discovery Bank, and Standard Bank. If the bank cannot be determined reliably, use documentSubtype "unknown".
If the document is not reliably identifiable, return documentType "unknown" and documentSubtype "unknown".
Confidence must reflect classification certainty, not extraction quality.
Evidence and warnings must be short and generic. Do not repeat personal names, account numbers, transaction descriptions, amounts, addresses, phone numbers, email addresses, or other customer data.`;

function cleanText(text) {
  return String(text || "")
    .replace(/\u0000/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

export function buildClassificationTextSample(text, maxChars = 30_000) {
  const normalized = cleanText(text);
  if (normalized.length <= maxChars) return normalized;

  const separator = "\n\n[... middle omitted for classification ...]\n\n";
  const available = Math.max(0, maxChars - separator.length);
  const headLength = Math.ceil(available * 0.75);
  const tailLength = Math.floor(available * 0.25);

  return `${normalized.slice(0, headLength)}${separator}${normalized.slice(-tailLength)}`;
}

export async function aiClassifier({
  extractedText = "",
  fileName = "",
  config = null,
  provider = null,
  logger = null,
} = {}) {
  const resolvedConfig = config || getAiConfig();
  const maxChars = resolvedConfig.classificationMaxInputChars || 30_000;
  const textSample = buildClassificationTextSample(extractedText, maxChars);

  return runAiTask({
    task: AI_TASKS.CLASSIFY_DOCUMENT,
    input: {
      fileName: String(fileName || "").slice(0, 255),
      documentTextSample: textSample,
    },
    systemPrompt: CLASSIFICATION_SYSTEM_PROMPT,
    responseSchema: AI_CLASSIFICATION_RESPONSE_SCHEMA,
    validateData: validateAiClassificationData,
    config: resolvedConfig,
    provider,
    logger,
  });
}
