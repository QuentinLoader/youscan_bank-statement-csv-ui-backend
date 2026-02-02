import pdf from 'pdf-parse';
// Make sure this path matches your folder structure exactly!
import { parseCapitec } from '../parsers/capitec/capitec_transactions.js'; 

export const parseStatement = async (fileBuffer) => {
  try {
    const data = await pdf(fileBuffer);
    const text = data.text;

    // Log the first bit of text to Railway logs for debugging
    console.log("PDF Text Extracted (first 100 chars):", text.substring(0, 100));

    // Currently assuming all uploads are Capitec
    const transactions = parseCapitec(text);

    return {
      success: true,
      transactions: transactions
    };
  } catch (error) {
    console.error("Parser Service Error:", error);
    throw new Error("Failed to extract text from PDF: " + error.message);
  }
};