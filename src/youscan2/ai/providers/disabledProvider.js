/**
 * YouScan V2
 * Explicit disabled provider. Used when AI has not been enabled.
 */

import { AI_ERROR_CODES, AiError } from "../errors.js";

export function createDisabledAiProvider() {
  return Object.freeze({
    name: "disabled",
    async generateStructured() {
      throw new AiError(
        AI_ERROR_CODES.DISABLED,
        "YouScan V2 AI is disabled"
      );
    },
  });
}
