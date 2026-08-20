import { toSafeAiCorrectionProposalSummary } from "../ai/extraction/correctionProposal.js";

function publicClassification(classification) {
  if (!classification) return null;
  return {
    documentType: classification.documentType || null,
    documentSubtype: classification.documentSubtype || null,
    supported: Boolean(classification.supported),
    confidence: classification.confidence ?? null,
    source: classification.source || null,
    needsReview: Boolean(classification.needsReview),
  };
}

export function toPublicV2FileResult({ fileName, parseResult, reviewCase = null } = {}) {
  const safeProposal = toSafeAiCorrectionProposalSummary(parseResult?.aiCorrectionProposal);
  return {
    fileName: fileName || null,
    jobId: parseResult?.jobId || null,
    status: parseResult?.status || "failed",
    classification: publicClassification(parseResult?.classification),
    result: parseResult?.result || null,
    extractionMeta: parseResult?.extractionMeta || null,
    message: parseResult?.message || null,
    error: parseResult?.error || null,
    ai: parseResult?.shadowAi || null,
    aiDecision: parseResult?.aiDecision || null,
    review: safeProposal
      ? {
          ...safeProposal,
          caseId: reviewCase?.caseId || null,
          persisted: Boolean(reviewCase?.caseId),
        }
      : null,
  };
}

export function aggregateV2Transactions(fileResults = []) {
  return fileResults.flatMap((entry) => {
    const transactions = entry?.result?.data?.transactions;
    if (!Array.isArray(transactions)) return [];
    return transactions.map((transaction) => ({
      ...transaction,
      sourceFile: entry.fileName,
    }));
  });
}
