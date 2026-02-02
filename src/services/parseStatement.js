import pdf from 'pdf-parse';
import { parseCapitec } from '../parsers/capitec_transactions.js'; 
import { parseFnb } from '../parsers/fnb_transactions.js'; 

export const parseStatement = async (fileBuffer) => {
  try {
    const data = await pdf(fileBuffer);
    const text = data.text;

    console.log("PDF Header Snippet:", text.substring(0, 300));

    let transactions = [];

    // --- Bank Detection Logic ---
    const lowerText = text.toLowerCase();

    if (lowerText.includes("capitec")) {
      console.log("Detected Bank: Capitec");
      // Removed 'await' here to prevent crashes if parseCapitec isn't async
      transactions = parseCapitec(text);
    } 
    else if (lowerText.includes("fnb") || text.includes("First National Bank") || text.includes("Beskrywing")) {
      console.log("Detected Bank: FNB");
      const lines = text.split('\n');
      transactions = parseFnb(lines);
    } 
    else {
      console.warn("Bank not recognized. Falling back to Capitec.");
      transactions = parseCapitec(text);
    }

    // --- Final Validation ---
    // Ensure we return an array. If it's undefined or null, return empty array.
    const result = Array.isArray(transactions) ? transactions : [];
    
    console.log(`✅ Result: Found ${result.length} transactions.`);
    return result;

  } catch (error) {
    console.error("Critical Service Error:", error.message);
    return []; // Return empty array so frontend doesn't crash
  }
};