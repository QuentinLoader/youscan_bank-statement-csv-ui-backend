import pdf from 'pdf-parse';
import { parseCapitec } from '../parsers/capitec_transactions.js'; 
import { parseFnb } from '../parsers/fnb_transactions.js'; 

export const parseStatement = async (fileBuffer) => {
  try {
    const data = await pdf(fileBuffer);
    const text = data.text;

    // Log a small snippet for debugging purposes
    console.log("PDF Header Snippet:", text.substring(0, 300));

    let transactions = [];
    let bankName = "Unknown";
    let bankLogo = "generic";

    // --- Robust Bank Detection Logic ---
    const lowerText = text.toLowerCase();

    // 1. Detection for Capitec
    if (lowerText.includes("capitec") || lowerText.includes("unique document no")) {
      console.log("🏦 Detected Bank: Capitec");
      bankName = "Capitec";
      bankLogo = "capitec"; // Lovable can use this to show the logo
      transactions = parseCapitec(text);
    } 
    // 2. Detection for FNB (Includes Afrikaans keywords and FNB-specific typos)
    else if (
      lowerText.includes("fnb") || 
      lowerText.includes("first national bank") || 
      lowerText.includes("referance number") || // Matching FNB's document typo
      lowerText.includes("beskrywing")
    ) {
      console.log("🏦 Detected Bank: FNB");
      bankName = "FNB";
      bankLogo = "fnb";
      transactions = parseFnb(text); // Passing full text instead of just lines for better regex matching
    } 
    // 3. Fallback Logic
    else {
      console.warn("⚠️ Bank not recognized. Falling back to Capitec.");
      bankName = "Capitec (Estimated)";
      bankLogo = "capitec";
      transactions = parseCapitec(text);
    }

    // --- Final Validation & Formatting ---
    const validatedTransactions = Array.isArray(transactions) ? transactions : [];
    
    console.log(`✅ Success: Processed ${bankName} statement with ${validatedTransactions.length} transactions.`);

    // Returning an object to satisfy the new server.js "allTransactions" logic
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