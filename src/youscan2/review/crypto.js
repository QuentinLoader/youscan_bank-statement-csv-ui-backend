/**
 * YouScan V2
 * AES-256-GCM protection for sensitive persisted review payloads.
 */

import crypto from "node:crypto";
import { reviewError } from "./errors.js";

const ALGORITHM = "aes-256-gcm";
const PAYLOAD_VERSION = 1;

function requireKey(key) {
  const normalized = Buffer.isBuffer(key) ? key : Buffer.from(key || []);
  if (normalized.length !== 32) {
    throw reviewError(
      "V2_REVIEW_ENCRYPTION_KEY_INVALID",
      "Review encryption requires a 32-byte key",
      { status: 503 }
    );
  }
  return normalized;
}

function aadBuffer(aad) {
  return Buffer.from(String(aad || ""), "utf8");
}

export function createReviewCrypto({ key }) {
  const encryptionKey = requireKey(key);

  return Object.freeze({
    encryptJson(value, { aad = "" } = {}) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv(ALGORITHM, encryptionKey, iv);
      cipher.setAAD(aadBuffer(aad));

      const plaintext = Buffer.from(JSON.stringify(value), "utf8");
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const tag = cipher.getAuthTag();

      return JSON.stringify({
        v: PAYLOAD_VERSION,
        iv: iv.toString("base64"),
        tag: tag.toString("base64"),
        ciphertext: ciphertext.toString("base64"),
      });
    },

    decryptJson(serialized, { aad = "" } = {}) {
      let envelope;
      try {
        envelope = JSON.parse(String(serialized || ""));
      } catch (error) {
        throw reviewError(
          "V2_REVIEW_PAYLOAD_INVALID",
          "Encrypted review payload is invalid",
          { status: 500, cause: error }
        );
      }

      if (
        envelope?.v !== PAYLOAD_VERSION ||
        !envelope?.iv ||
        !envelope?.tag ||
        !envelope?.ciphertext
      ) {
        throw reviewError(
          "V2_REVIEW_PAYLOAD_INVALID",
          "Encrypted review payload is incomplete",
          { status: 500 }
        );
      }

      try {
        const decipher = crypto.createDecipheriv(
          ALGORITHM,
          encryptionKey,
          Buffer.from(envelope.iv, "base64")
        );
        decipher.setAAD(aadBuffer(aad));
        decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
        const plaintext = Buffer.concat([
          decipher.update(Buffer.from(envelope.ciphertext, "base64")),
          decipher.final(),
        ]);
        return JSON.parse(plaintext.toString("utf8"));
      } catch (error) {
        throw reviewError(
          "V2_REVIEW_PAYLOAD_DECRYPT_FAILED",
          "Encrypted review payload could not be authenticated",
          { status: 500, cause: error }
        );
      }
    },
  });
}

export function reviewPayloadAad({ caseId, userId }) {
  return `youscan-v2-review:${String(caseId)}:${String(userId)}`;
}
