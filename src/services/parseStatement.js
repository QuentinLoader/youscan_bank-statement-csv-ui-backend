import pdf from 'pdf-parse';
import { parseCapitec } from '../parsers/capitec_transactions.js'; 
import { parseFnb } from '../parsers/fnb_transactions.js'; 
import { parseAbsa } from '../parsers/absa_transactions.js'; 

export const parseStatement = async (fileBuffer) => {
  try {
    const data = await pdf(fileBuffer);
    const text = data.text;
    const lowerText = text.toLowerCase();

    // 🔍 DEBUG: Log the header to verify file content in logs
    console.log("📄 PDF Header Snippet:", text.substring(0, 300).replace(/\n/g, ' '));

    // 1. CAPITEC CHECK (Priority 1)
    // Distinct signature: "unique document no" or explicit "capitec" mentions
    if (lowerText.includes("capitec") || lowerText.includes("unique document no")) {
      console.log("🏦 Detected Bank: Capitec");
      const transactions = parseCapitec(text);
      console.log(`📊 Extracted ${transactions.length} items from Capitec`);
      return {
        transactions,
        bankName: "Capitec",
        bankLogo: "capitec"
      };
    } 

    // 2. ABSA CHECK (Priority 2 - New)
    // Distinct signature: "absa" logo text or "cheque account number" in specific layout
    if (lowerText.includes("absa") && (lowerText.includes("cheque account") || lowerText.includes("absa bank"))) {
      console.log("🏦 Detected Bank: ABSA");
      const transactions = parseAbsa(text);
      console.log(`📊 Extracted ${transactions.length} items from ABSA`);
      return {
        transactions,
        bankName: "ABSA",
        bankLogo: "absa" // Ensure Lovable has a purple badge logic for this string
      };
    }
    
    // 3. FNB CHECK (Priority 3)
    // Distinct signature: "bbst" (Branch code), "fnb", or "rekeningnommer"
    if (lowerText.includes("fnb") || lowerText.includes("first national bank") || lowerText.includes("bbst")) {
      console.log("🏦 Detected Bank: FNB");
      const transactions = parseFnb(text);
      console.log(`📊 Extracted ${transactions.length} items from FNB`);
      return {
        transactions,
        bankName: "FNB",
        bankLogo: "fnb"
      };
    } 

    // 4. FALLBACK
    // If no specific signature is found, warn the user. 
    // We default to Capitec here as it's your most common use case, but log a warning.
    console.warn("⚠️ Bank signature not found. Defaulting to Capitec.");
    return {
      transactions: parseCapitec(text),
      bankName: "Capitec",
      bankLogo: "capitec"
    };

  } catch (error) {
    console.error("❌ Critical Parsing Error:", error.message);
    return { transactions: [], bankName: "Error", bankLogo: "error" };
  }
};