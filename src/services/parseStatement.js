import pdf from 'pdf-parse';

import { parseCapitec } from '../parsers/capitec_transactions.js';
import { parseAbsa } from '../parsers/absa_transactions.js';
import { parseFnb } from '../parsers/fnb_transactions.js';
import { parseDiscovery } from '../parsers/discovery_transactions.js';
import { parseNedbank } from '../parsers/nedbank_transactions.js';

export const parseStatement = async (fileBuffer) => {
  try {
    const data = await pdf(fileBuffer);
    const text = data.text;
    const lowerText = text.toLowerCase().replace(/\s+/g, ' ');

    console.log(
      "📄 PDF Header Snippet:",
      text.substring(0, 300).replace(/\n/g, ' ')
    );

    let parserResult = null;
    let bankName = null;
    let bankLogo = null;

    // ==========================================================
    // 1️⃣ EXPLICITLY UNSUPPORTED — CHECK FIRST
    // ==========================================================

    if (
      lowerText.includes("standard bank of south africa") ||
      lowerText.includes("transact@standardbank.co.za") ||
      lowerText.includes("0860 123 000")
    ) {
      console.log("🚫 Standard Bank detected — unsupported.");
      return { errorCode: "UNSUPPORTED_BANK" };
    }

    // ==========================================================
    // 2️⃣ SUPPORTED BANKS (Allow-list strategy)
    // ==========================================================

    if (
      lowerText.includes("discovery gold transaction account") ||
      lowerText.includes("discovery bank limited")
    ) {
      console.log("🏦 Detected Bank: Discovery");
      parserResult = parseDiscovery(text);
      bankName = "Discovery";
      bankLogo = "discovery";
    }

    else if (
      lowerText.includes("nedbank ltd") ||
      lowerText.includes("see money differently")
    ) {
      console.log("🏦 Detected Bank: Nedbank");
      parserResult = parseNedbank(text);
      bankName = "Nedbank";
      bankLogo = "nedbank";
    }

    else if (
      lowerText.includes("unique document no") ||
      lowerText.includes("capitec bank limited") ||
      lowerText.includes("client care centre")
    ) {
      console.log("🏦 Detected Bank: Capitec");
      parserResult = parseCapitec(text);
      bankName = "Capitec";
      bankLogo = "capitec";
    }

    else if (
      lowerText.includes("absa") &&
      (lowerText.includes("cheque account") || lowerText.includes("absa bank"))
    ) {
      console.log("🏦 Detected Bank: ABSA");
      parserResult = parseAbsa(text);
      bankName = "ABSA";
      bankLogo = "absa";
    }

    else if (
      lowerText.includes("first national bank") ||
      lowerText.includes("fnb.co.za")
    ) {
      console.log("🏦 Detected Bank: FNB");
      parserResult = parseFnb(text);
      bankName = "FNB";
      bankLogo = "fnb";
    }

    // ==========================================================
    // 3️⃣ UNKNOWN BANK
    // ==========================================================

    else {
      console.warn("⚠️ Unknown bank signature.");
      return { errorCode: "UNKNOWN_BANK" };
    }

    // ==========================================================
    // 4️⃣ NORMALIZE OUTPUT
    // ==========================================================

    let transactions = [];
    let metadata = {};

    if (parserResult) {
      if (
        parserResult.transactions &&
        Array.isArray(parserResult.transactions)
      ) {
        transactions = parserResult.transactions;
        metadata = parserResult.metadata || {};
      }
      else if (Array.isArray(parserResult)) {
        transactions = parserResult;
      }
    }

    return {
      transactions,
      metadata,
      bankName,
      bankLogo
    };

  } catch (error) {
    console.error("❌ Critical Parsing Error:", error.message);
    return { errorCode: "PARSER_ERROR" };
  }
};