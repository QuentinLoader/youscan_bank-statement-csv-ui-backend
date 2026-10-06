export function normalizeWhitespace(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}