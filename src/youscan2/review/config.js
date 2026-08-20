/**
 * YouScan V2
 * Review persistence configuration.
 *
 * Full review payloads contain financial data and must never be persisted
 * without an application-level encryption key.
 */

import { reviewError } from "./errors.js";

function envFlag(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value).trim().toLowerCase() === "true";
}

function parseBase64Key(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  let key;
  try {
    key = Buffer.from(raw, "base64");
  } catch {
    key = null;
  }

  if (!key || key.length !== 32) {
    throw reviewError(
      "V2_REVIEW_ENCRYPTION_KEY_INVALID",
      "YOUSCAN_V2_REVIEW_ENCRYPTION_KEY must be a base64-encoded 32-byte key",
      { status: 503 }
    );
  }

  return key;
}

export function loadReviewConfig(env = process.env) {
  const enabled = envFlag(env.YOUSCAN_V2_REVIEW_PERSISTENCE_ENABLED, false);
  const encryptionKey = enabled
    ? parseBase64Key(env.YOUSCAN_V2_REVIEW_ENCRYPTION_KEY)
    : null;

  if (enabled && !encryptionKey) {
    throw reviewError(
      "V2_REVIEW_ENCRYPTION_KEY_REQUIRED",
      "YOUSCAN_V2_REVIEW_ENCRYPTION_KEY is required when V2 review persistence is enabled",
      { status: 503 }
    );
  }

  return Object.freeze({
    enabled,
    encryptionKey,
  });
}
