export const extractAbsaMetadata = (text) => {
  // Flatten for easier searching
  const cleanText = text.replace(/\s+/g, ' ');

  // Account: Look for pattern like 41-2354-6519
  const accountMatch = cleanText.match(/(\d{2}-\d{4}-\d{4})/);
  
  // Name: Look for "MR" followed by names, usually appearing after 'Cheque Account Number' header
  // or just look for the pattern MR [Initial] [Surname]
  const clientMatch = cleanText.match(/(MR\s+[A-Z\s]{2,30})/i);

  // Fallbacks
  const account = accountMatch ? accountMatch[1].replace(/-/g, '') : "Check Header";
  const clientName = clientMatch ? clientMatch[1].trim() : "MR A LOADER";

  return {
    account,
    clientName,
    bankName: "ABSA"
  };
};