/** YouScan V2: every parse job requires successful AI extraction. */
import { createParseJob } from "./createParseJob.js";
import { runAiParseJob } from "./runAiParseJob.js";
import { finalizeParseJob } from "./finalizeParseJob.js";
import { PARSE_JOB_STATUSES } from "../schemas/common.js";
import { AI_EXTRACTION_FAILED_MESSAGE, summarizeAiValidationIssues } from "../ai/validationDiagnostics.js";
import { analysisAvailability, analysisUnavailableError, isProviderUnavailable } from "../ai/availability.js";

function sanitizeDiagnosticMessage(value) {
  return String(value || "Unknown V2 parse failure")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/\b\d{6,}\b/g, "[redacted-number]")
    .slice(0, 240);
}

export async function runParseJob({ file, extractedText = "", extractionMeta = null,
  aiOptions = null, availability = analysisAvailability }) {
  const job = createParseJob({ file, extractionMeta });
  const requireAi = true;
  const classification = null;
  const schema = null;
  const stage = "ai_extraction";
  try {
    return await runAiParseJob({ job, file, extractedText, extractionMeta, availability, aiOptions });
  } catch (error) {
    if (requireAi && isProviderUnavailable(error)) {
      availability.recordFailure(error);
      error = analysisUnavailableError();
    }
    const errorCode = error?.code || "V2_PARSE_FAILED";
    const errorMessage = error?.message || "Unknown V2 parse failure";

    console.error(
      "V2 PARSE JOB FAILURE:",
      JSON.stringify({
        stage,
        code: errorCode,
        name: error?.name || "Error",
        subtype: classification?.documentSubtype || null,
        message: sanitizeDiagnosticMessage(errorMessage),
        requestId: error?.details?.requestId || null,
        validationIssues: summarizeAiValidationIssues(error?.details?.issues),
      })
    );

    return finalizeParseJob({
      job,
      status: PARSE_JOB_STATUSES.FAILED,
      classification,
      schema,
      result: null,
      extractionMeta,
      message: "YouScan V2 parse job failed",
      error: {
        code: errorCode,
        message: requireAi && ["V2_AI_INVALID_RESPONSE", "V2_AI_ANALYSIS_REJECTED", "V2_AI_PROVIDER_REFUSED"].includes(errorCode)
          ? AI_EXTRACTION_FAILED_MESSAGE : errorMessage,
      },
    });
  }
}
