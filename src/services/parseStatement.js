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

    let parserResult = null;
    let bankName = "Unknown";
    let bankLogo = "unknown";

    // =========================================================================
    // 1. BANK DETECTION STRATEGY
    // =========================================================================

    // CAPITEC CHECK
    if (lowerText.includes("unique document no") || 
        lowerText.includes("capitec bank limited") || 
        lowerText.includes("client care centre")) {
      console.log("🏦 Detected Bank: Capitec");
      parserResult = parseCapitec(text);
      bankName = "Capitec";
      bankLogo = "capitec";
    } 
    // ABSA CHECK
    else if (lowerText.includes("absa") && (lowerText.includes("cheque account") || lowerText.includes("absa bank"))) {
      console.log("🏦 Detected Bank: ABSA");
      parserResult = parseAbsa(text); // Now returns { metadata, transactions }
      bankName = "ABSA";
      bankLogo = "absa";
    }
    // FNB CHECK
    else if (lowerText.includes("fnb") || lowerText.includes("first national bank") || lowerText.includes("bbst") || lowerText.includes("rekeningnommer")) {
      console.log("🏦 Detected Bank: FNB");
      parserResult = parseFnb(text); // Now returns { metadata, transactions }
      bankName = "FNB";
      bankLogo = "fnb";
    } 
    // FALLBACK
    else {
      console.warn("⚠️ Bank signature not found. Defaulting to Capitec.");
      parserResult = parseCapitec(text);
      bankName = "Capitec";
      bankLogo = "capitec";
    }

    // =========================================================================
    // 2. NORMALIZE OUTPUT (The Fix)
    // =========================================================================
    // This ensures consistency whether the parser returns [Array] or { Object }
    
    let transactions = [];
    let metadata = {};

    if (parserResult) {
      // Case A: New Format { metadata, transactions }
      if (parserResult.transactions && Array.isArray(parserResult.transactions)) {
        transactions = parserResult.transactions;
        metadata = parserResult.metadata || {};
      } 
      // Case B: Legacy Format [Array]
      else if (Array.isArray(parserResult)) {
        transactions = parserResult;
      }
    }

    // Return a flat, standardized object to server.js
    return { 
      transactions: transactions, 
      metadata: metadata,
      bankName: bankName, 
      bankLogo: bankLogo 
    };

  } catch (error) {
    console.error("❌ Critical Parsing Error:", error.message);
    return { 
      transactions: [], 
      metadata: {}, 
      bankName: "Error", 
      bankLogo: "error" 
    };
  }
};