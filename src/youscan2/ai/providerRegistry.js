/**
 * YouScan V2
 * AI provider registry.
 */

import { AI_ERROR_CODES, AiError } from "./errors.js";
import { createDisabledAiProvider } from "./providers/disabledProvider.js";
import { createOpenAiProvider } from "./providers/openaiProvider.js";

const factories = new Map([
  ["disabled", createDisabledAiProvider],
  ["openai", createOpenAiProvider],
]);

export function registerAiProvider(name, factory) {
  const normalizedName = String(name || "").trim().toLowerCase();

  if (!normalizedName || typeof factory !== "function") {
    throw new AiError(
      AI_ERROR_CODES.PROVIDER_INVALID,
      "AI provider registration requires a name and factory"
    );
  }

  factories.set(normalizedName, factory);
}

export function createAiProvider(config) {
  const providerName = String(config?.provider || "disabled")
    .trim()
    .toLowerCase();
  const factory = factories.get(providerName);

  if (!factory) {
    throw new AiError(
      AI_ERROR_CODES.PROVIDER_INVALID,
      `No YouScan V2 AI provider is registered for: ${providerName}`
    );
  }

  const provider = factory(config);

  if (
    !provider ||
    typeof provider.name !== "string" ||
    typeof provider.generateStructured !== "function"
  ) {
    throw new AiError(
      AI_ERROR_CODES.PROVIDER_INVALID,
      `AI provider factory returned an invalid provider: ${providerName}`
    );
  }

  return provider;
}
