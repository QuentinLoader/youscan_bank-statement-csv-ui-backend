/**
 * Nedbank Metadata Extractor
 * Focused ONLY on header/account summary extraction.
 * Deterministic and layout-based.
 */

export const extractNedbankMetadata = (text) => {
  const cleanText = text.replace(/\s+/g, " ");

  // Account Number
  const accountMatch = cleanText.match(/Account number\s*(\d{8,12})/i);
  const account = accountMatch ? accountMatch[1] : "Unknown";

  // Client Name (Appears near top, starts with Mr/MRS/MS)
  const clientMatch = cleanText.match(/\b(Mr|MR|Mrs|Ms)\s+[A-Z\s]+/);
  const clientName = clientMatch ? clientMatch[0].trim() : "Unknown";

  // Statement Date
  const statementDateMatch = cleanText.match(/Statement date:\s*([\d\/\-]+)/i);
  const statementDate = statementDateMatch ? statementDateMatch[1] : null;

  // Statement Period
  const periodMatch = cleanText.match(
    /Statement period:\s*([\d\/\-]+)\s*[–-]\s*([\d\/\-]+)/i
  );

  const periodStart = periodMatch ? periodMatch[1] : null;
  const periodEnd = periodMatch ? periodMatch[2] : null;

  // Opening Balance
  const openMatch = cleanText.match(/Opening balance\s*R?([\d,]+\.\d{2})/i);
  const openingBalance = openMatch
    ? parseFloat(openMatch[1].replace(/,/g, ""))
    : 0;

  // Closing Balance
  const closeMatch = cleanText.match(/Closing balance\s*R?([\d,]+\.\d{2})/i);
  const closingBalance = closeMatch
    ? parseFloat(closeMatch[1].replace(/,/g, ""))
    : 0;

  return {
    account,
    clientName,
    bankName: "Nedbank",
    statementDate,
    periodStart,
    periodEnd,
    openingBalance,
    closingBalance
  };
};