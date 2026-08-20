/**
 * YouScan V2
 * Lazy production composition for the persistent review workflow.
 */

import { createReviewCrypto } from "./crypto.js";
import { loadReviewConfig } from "./config.js";
import { reviewError } from "./errors.js";
import { createPostgresReviewRepository } from "./postgresRepository.js";
import { createReviewService } from "./reviewService.js";

let cachedService = null;

export function getDefaultReviewService() {
  if (cachedService) return cachedService;

  const config = loadReviewConfig();
  if (!config.enabled) {
    throw reviewError(
      "V2_REVIEW_PERSISTENCE_DISABLED",
      "YouScan V2 review persistence is not enabled",
      { status: 503 }
    );
  }

  cachedService = createReviewService({
    repository: createPostgresReviewRepository(),
    reviewCrypto: createReviewCrypto({ key: config.encryptionKey }),
  });
  return cachedService;
}

export function _resetDefaultReviewServiceForTests() {
  cachedService = null;
}
