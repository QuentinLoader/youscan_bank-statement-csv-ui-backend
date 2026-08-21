import crypto from "node:crypto";

function requirePrivateKey(privateKey) {
  const value = String(privateKey || "").trim();
  if (!value) {
    const error = new Error("OZOW_PRIVATE_KEY_REQUIRED");
    error.code = "OZOW_PRIVATE_KEY_REQUIRED";
    throw error;
  }
  return value;
}

export function normalizeOzowAmount(amount) {
  const parsed = Number.parseFloat(amount);
  if (!Number.isFinite(parsed)) {
    const error = new Error("OZOW_INVALID_AMOUNT");
    error.code = "OZOW_INVALID_AMOUNT";
    throw error;
  }
  return parsed.toFixed(2);
}

export function generateOzowRequestHash(data, privateKey) {
  const key = requirePrivateKey(privateKey);
  const parts = [
    data.SiteCode,
    data.CountryCode,
    data.CurrencyCode,
    data.Amount,
    data.TransactionReference,
    data.BankReference,
    data.Optional1,
    data.Optional2,
    data.Optional3,
    data.Optional4,
    data.Optional5,
    data.Customer,
    data.CancelURL,
    data.ErrorURL,
    data.SuccessURL,
    data.NotifyURL,
    data.IsTest,
    key,
  ];

  const raw = parts
    .map((value) => (value === undefined || value === null ? "" : String(value)))
    .join("")
    .toLowerCase();

  return crypto.createHash("sha512").update(raw, "utf8").digest("hex").toLowerCase();
}

export function generateOzowWebhookHash(data, privateKey) {
  const key = requirePrivateKey(privateKey);

  const parts = [
    data.SiteCode,
    data.TransactionId,
    data.TransactionReference,
    normalizeOzowAmount(data.Amount),
    data.Status,
    data.Optional1 ?? "",
    data.Optional2 ?? "",
    data.Optional3 ?? "",
    data.Optional4 ?? "",
    data.Optional5 ?? "",
    data.CurrencyCode,
    data.IsTest,
    data.StatusMessage ?? "",
    key,
  ];

  const raw = parts
    .map((value) =>
      value === undefined || value === null ? "" : String(value)
    )
    .join("")
    .toLowerCase();

  return crypto
    .createHash("sha512")
    .update(raw, "utf8")
    .digest("hex")
    .toLowerCase();
}

export function timingSafeHashEqual(expected, received) {
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

export function verifyOzowWebhookHash(payload, privateKey) {
  const expectedHash = generateOzowWebhookHash(payload, privateKey);
  return timingSafeHashEqual(expectedHash, payload?.Hash);
}

export function safeOzowEventSummary(payload = {}) {
  return {
    transactionReference: payload.TransactionReference || null,
    transactionId: payload.TransactionId || null,
    status: payload.Status || null,
    currencyCode: payload.CurrencyCode || null,
    isTest: String(payload.IsTest || "").toLowerCase() === "true",
  };
}
