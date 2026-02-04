import pdf from 'pdf-parse';
import { parseCapitec } from '../parsers/capitec_transactions.js'; 
import { parseFnb } from '../parsers/fnb_transactions.js'; 

export const parseStatement = async (fileBuffer) => {
  try {
    const data = await pdf(fileBuffer);
    const text = data.text;

    // Flatten text for easier keyword detection
    const lowerText = text.toLowerCase().replace(/\s+/g, ' ');
    
    // DEBUG: Log the first 200 chars to see what the detector sees
    console.log("🔍 Header Check:", lowerText.substring(0, 200));

    let transactions = [];
    let bankName = "Unknown";
    let bankLogo = "generic";

    // --- STRICT DETECTION LOGIC ---

    // 1. CAPITEC (Check first - distinctive keywords)
    if (
      lowerText.includes("capitec") || 
      lowerText.includes("unique document no") ||
      lowerText.includes("remote banking")
    ) {
      console.log("🏦 Detected Bank: Capitec");
      bankName = "Capitec";
      bankLogo = "capitec";
      transactions = parseCapitec(text);
    } 
    // 2. FNB (Check second)
    else if (
      lowerText.includes("fnb") || 
      lowerText.includes("first national bank") || 
      lowerText.includes("bbst") || 
      lowerText.includes("rekeningnommer")
    ) {
      console.log("🏦 Detected Bank: FNB");
      bankName = "FNB";
      bankLogo = "fnb";
      transactions = parseFnb(text);
    } 
    // 3. FALLBACK (Default to Capitec if unsure, but warn)
    else {
      console.warn("⚠️ Bank signature not found. Defaulting to Capitec.");
      bankName = "Capitec";
      bankLogo = "capitec";
      transactions = parseCapitec(text);
    }

    const validatedTransactions = Array.isArray(transactions) ? transactions : [];
    
    console.log(`✅ Result: ${bankName} - ${validatedTransactions.length} transactions found.`);

    return {
      transactions: validatedTransactions,
      bankName: bankName,
      bankLogo: bankLogo
    };

  } catch (error) {
    console.error("❌ Critical Parsing Error:", error.message);
    return { transactions: [], bankName: "Error", bankLogo: "error" };
  }
};