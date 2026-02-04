import pdf from 'pdf-parse';
import { parseCapitec } from '../parsers/capitec_transactions.js'; 
import { parseFnb } from '../parsers/fnb_transactions.js'; 

export const parseStatement = async (fileBuffer) => {
  try {
    const data = await pdf(fileBuffer);
    const text = data.text;

    // Log the start of the file to verify what we are seeing
    console.log("PDF Header Snippet:", text.substring(0, 300).replace(/\n/g, ' '));

    let transactions = [];
    let bankName = "Unknown";
    let bankLogo = "generic";

    // --- ROBUST DETECTION LOGIC ---
    // We flatten the text for detection to avoid newline issues
    const lowerText = text.toLowerCase().replace(/\s+/g, ' ');

    // FNB DETECTION (Prioritize FNB unique identifiers)
    // "bbst" is the branch code identifier often found in FNB headers in your logs
    // "rekeningnommer" is Afrikaans for Account Number (FNB specific in this context)
    // "fnb premier" or "first national bank"
    if (
      lowerText.includes("fnb") || 
      lowerText.includes("first national bank") || 
      lowerText.includes("bbst") || 
      lowerText.includes("rekeningnommer") ||
      lowerText.includes("referance number") 
    ) {
      console.log("🏦 Detected Bank: FNB");
      bankName = "FNB";
      bankLogo = "fnb";
      transactions = parseFnb(text);
    } 
    // CAPITEC DETECTION
    // Look for Capitec specific keywords
    else if (
      lowerText.includes("capitec") || 
      lowerText.includes("unique document no")
    ) {
      console.log("🏦 Detected Bank: Capitec");
      bankName = "Capitec";
      bankLogo = "capitec";
      transactions = parseCapitec(text);
    } 
    // FALLBACK (If we can't tell, check for "Dt" or "Kt" which suggests FNB)
    else if (lowerText.includes(" dt ") || lowerText.includes(" kt ")) {
       console.log("🏦 Detected Bank: FNB (Fallback by Dt/Kt)");
       bankName = "FNB";
       bankLogo = "fnb";
       transactions = parseFnb(text);
    }
    else {
      console.warn("⚠️ Bank not recognized. Defaulting to Capitec.");
      bankName = "Capitec (Default)";
      bankLogo = "capitec";
      transactions = parseCapitec(text);
    }

    const validatedTransactions = Array.isArray(transactions) ? transactions : [];
    
    console.log(`✅ Success: Processed ${bankName} statement with ${validatedTransactions.length} transactions.`);

    return {
      transactions: validatedTransactions,
      bankName: bankName,
      bankLogo: bankLogo
    };

  } catch (error) {
    console.error("❌ Critical Service Error:", error.message);
    return {
      transactions: [],
      bankName: "Error",
      bankLogo: "error"
    };
  }
};