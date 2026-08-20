import { DOCUMENT_SUBTYPES } from "../../registry/documentTypes.js";
import { getBankNameForSubtype } from "../../registry/bankSupport.js";

export function mapSubtypeToBankName(subtype) {
  if (!subtype) return "Unknown";

  if (Object.values(DOCUMENT_SUBTYPES).includes(subtype)) {
    return getBankNameForSubtype(subtype);
  }

  const value = String(subtype).toLowerCase();

  if (value.includes("absa")) return "ABSA";
  if (value.includes("standard_bank") || value.includes("standard bank")) {
    return "Standard Bank";
  }
  if (value.includes("fnb") || value.includes("first national bank")) return "FNB";
  if (value.includes("nedbank")) return "Nedbank";
  if (value.includes("capitec")) return "Capitec";
  if (value.includes("discovery")) return "Discovery Bank";

  return "Unknown";
}

export function isValidDateString(value) {
  if (!value) return false;
  return /^\d{2}\/\d{2}\/\d{4}$/.test(value);
}
