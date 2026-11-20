import crypto from "node:crypto";

function requireSecretKey(secretKey) {
  const value = String(secretKey || "").trim();
  if (!value) {
    const error = new Error("PAYSTACK_SECRET_KEY_REQUIRED");
    error.code = "PAYSTACK_SECRET_KEY_REQUIRED";
    throw error;
  }
  return value;
}

export function computePaystackSignature(rawBody, secretKey) {
  const key = requireSecretKey(secretKey);
  const bodyBuffer = Buffer.isBuffer(rawBody)
    ? rawBody
    : Buffer.from(typeof rawBody === "string" ? rawBody : JSON.stringify(rawBody ?? {}), "utf8");

  return crypto
    .createHmac("sha512", key)
    .update(bodyBuffer)
    .digest("hex")
    .toLowerCase();
}

export function timingSafeHexEqual(expected, received) {
  const expectedText = String(expected || "").trim().toLowerCase();
  const receivedText = String(received || "").trim().toLowerCase();

  if (!/^[0-9a-f]{128}$/.test(expectedText) || !/^[0-9a-f]{128}$/.test(receivedText)) {
    return false;
  }

  const expectedBuffer = Buffer.from(expectedText, "hex");
  const receivedBuffer = Buffer.from(receivedText, "hex");
  if (expectedBuffer.length !== receivedBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

export function verifyPaystackWebhookSignature(rawBody, signatureHeader, secretKey) {
  if (!signatureHeader || typeof signatureHeader !== "string") return false;
  const expected = computePaystackSignature(rawBody, secretKey);
  return timingSafeHexEqual(expected, signatureHeader);
}

export function safePaystackEventSummary(payload = {}) {
  const data = payload?.data || payload || {};
  return {
    event: payload?.event || null,
    reference: data?.reference || null,
    providerTransactionId: data?.id != null ? String(data.id) : null,
    status: data?.status || null,
    currency: data?.currency || null,
    domain: data?.domain || null,
    channel: data?.channel || null,
  };
}
