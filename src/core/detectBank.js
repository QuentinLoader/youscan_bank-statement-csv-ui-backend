// src/core/detectBank.js

/**
 * Identifies the bank based on text content
 * @param {string} text - The raw text from the PDF
 * @returns {string} - "Capitec" or "FNB"
 */
export const detectBank = (text) => {
  if (text.includes("CAPITEC")) return "Capitec";
  if (text.includes("First National Bank") || text.includes("FNB")) return "FNB";
  
  // If no bank is detected, return null or throw an error
  return null; 
};