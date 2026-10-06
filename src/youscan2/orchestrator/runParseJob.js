/** YouScan V2: every parse job requires successful AI extraction. */
import { safeDiagnostic } from "../../operations/diagnostics.js";
import { createParseJob } from "./createParseJob.js";
import { runAiParseJob } from "./runAiParseJob.js";
import { finalizeParseJob } from "./finalizeParseJob.js";
import { PARSE_JOB_STATUSES } from "../schemas/common.js";
import { AI_EXTRACTION_FAILED_MESSAGE } from "../ai/validationDiagnostics.js";
import { analysisAvailability, analysisUnavailableError, isProviderUnavailable } from "../ai/availability.js";

export async function runParseJob({ file, extractedText = "", extractionMeta = null,
  aiOptions = null, onStage, availability = analysisAvailability }) {
  const job = createParseJob({ file, extractionMeta });
  const requireAi = true;
  const classification = null;
  const schema = null;
  let stage = "ai_extraction";
  try {
    return await runAiParseJob({ job, file, extractedText, extractionMeta, availability, aiOptions, onStage: async value => { stage = value; await onStage?.(value); } });
  } catch (error) {
    const diagnostic = safeDiagnostic(error);
    if (requireAi && isProviderUnavailable(error)) {
      availability.recordFailure(error);
      error = analysisUnavailableError();
    }
    const errorCode = error?.code || "V2_PARSE_FAILED";
    const errorMessage = error?.message || "Unknown V2 parse failure";

    console.error("V2 PARSE JOB FAILURE:", JSON.stringify({ stage, ...diagnostic }));

    return { diagnostic, ...finalizeParseJob({
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
    }) };
  }
}
