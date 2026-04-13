/**
 * YouScan 2.0
 * Main classifier entry point
 */

import { heuristicClassifier } from "./heuristicClassifier.js";

export async function classifyDocument({
  extractedText = "",
  fileName = "",
}) {
  const classification = heuristicClassifier(extractedText);

  return {
    ...classification,
    fileName,
  };
}