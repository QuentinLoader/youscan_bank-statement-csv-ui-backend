import pdf from 'pdf-parse';
// FIXED: Removed the extra '/capitec' folder from the path
import { parseCapitec } from '../parsers/capitec_transactions.js'; 

export const parseStatement = async (fileBuffer) => {
  try {
    const data = await pdf(fileBuffer);
    const text = data.text;

    // This logs what the PDF actually looks like to your Railway console
    console.log("PDF Text Extracted:", text.substring(0, 500));

    const transactions = parseCapitec(text);

    // If the path was wrong, 'transactions' would have been undefined or empty
    if (!transactions || transactions.length === 0) {
      console.error("Parser returned no transactions. Check Regex in capitec_transactions.js");
      throw new Error("LEDGER_EMPTY");
    }

    return { success: true, transactions };
  } catch (error) {
    console.error("Service Error:", error);
    throw error;
  }
};