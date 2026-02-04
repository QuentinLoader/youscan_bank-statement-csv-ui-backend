import pdf from 'pdf-parse';
import { parseCapitec } from '../parsers/capitec_transactions.js'; 
import { parseAbsa } from '../parsers/absa_transactions.js'; 
import { parseFnb } from '../parsers/fnb_transactions.js'; 

export const parseStatement = async (fileBuffer) => {
  try {
    const data = await pdf(fileBuffer);
    const text = data.text;
    const lowerText = text.toLowerCase().replace(/\s+/g, ' ');

    console.log("📄 PDF Header Snippet:", text.substring(0, 300).replace(/\n/g, ' '));

    // 1. CAPITEC CHECK (Priority 1)
    if (lowerText.includes("capitec") || lowerText.includes("unique document no")) {
      console.log("🏦 Detected Bank: Capitec");
      return { transactions: parseCapitec(text), bankName: "Capitec", bankLogo: "capitec" };
    } 

    // 2. ABSA CHECK (Priority 2)
    if (lowerText.includes("absa") && (lowerText.includes("cheque account") || lowerText.includes("absa bank"))) {
      console.log("🏦 Detected Bank: ABSA");
      return { transactions: parseAbsa(text), bankName: "ABSA", bankLogo: "absa" };
    }
    
    // 3. FNB CHECK (Priority 3)
    // We look for specific FNB indicators like "bbst" (Branch Code) or "rekeningnommer"
    if (lowerText.includes("fnb") || lowerText.includes("first national bank") || lowerText.includes("bbst") || lowerText.includes("rekeningnommer")) {
      console.log("🏦 Detected Bank: FNB");
      return { transactions: parseFnb(text), bankName: "FNB", bankLogo: "fnb" };
    } 

    // 4. FALLBACK
    console.warn("⚠️ Bank signature not found. Defaulting to Capitec.");
    return { transactions: parseCapitec(text), bankName: "Capitec", bankLogo: "capitec" };

  } catch (error) {
    console.error("❌ Critical Parsing Error:", error.message);
    return { transactions: [], bankName: "Error", bankLogo: "error" };
  }
};