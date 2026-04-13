/**
 * YouScan 2.0
 * Bank statement extractor
 */

export async function extractBankStatement(context) {
  const { file, classification, textPreview = "" } = context;

  return {
    sourceFileName: file?.originalname || "unknown.pdf",
    detectedSubtype: classification.documentSubtype,
    rawTextPreview: textPreview,
    transactions: [],
    metadata: {},
  };
}