import pdf from 'pdf-parse';
import { parseCapitec } from '../parsers/capitec_transactions.js'; 
import { parseFnb } from '../parsers/fnb_transactions.js'; 

export const parseStatement = async (fileBuffer) => {
  try {
    const data = await pdf(fileBuffer);
    const text = data.text;
    const lowerText = text.toLowerCase();

    // 1. CAPITEC CHECK (Priority 1)
    // If it says "capitec", it IS Capitec. Stop checking anything else.
    if (lowerText.includes("capitec") || lowerText.includes("unique document no")) {
      console.log("🏦 Detected Bank: Capitec");
      return {
        transactions: parseCapitec(text),
        bankName: "Capitec",
        bankLogo: "capitec"
      };
    } 
    
    // 2. FNB CHECK (Priority 2)
    // Only checks this if it is NOT Capitec
    if (lowerText.includes("fnb") || lowerText.includes("first national bank")) {
      console.log("🏦 Detected Bank: FNB");
      return {
        transactions: parseFnb(text), // We leave this here but won't focus on it now
        bankName: "FNB",
        bankLogo: "fnb"
      };
    } 

    // 3. FALLBACK
    // If we really can't tell, default to Capitec (safest bet for you)
    console.warn("⚠️ Bank not recognized. Defaulting to Capitec.");
    return {
      transactions: parseCapitec(text),
      bankName: "Capitec",
      bankLogo: "capitec"
    };

  } catch (error) {
    console.error("❌ Parsing Error:", error.message);
    return { transactions: [], bankName: "Error", bankLogo: "error" };
  }
};