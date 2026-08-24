/**
 * YouScan V2
 * Deterministic document signal extraction.
 *
 * Bank identification is evidence-ranked.
 *
 * Important:
 * A bank name appearing inside a transaction description must not override
 * stronger document-level branding for the bank that issued the statement.
 */

import { DOCUMENT_SUBTYPES } from "../registry/documentTypes.js";

const HEADER_SAMPLE_LENGTH = 1800;

const BANK_BRANDS = Object.freeze([
  {
    subtype: DOCUMENT_SUBTYPES.ABSA_STATEMENT,
    label: "ABSA",

    strongSignals: [
      "absa bank limited",
      "absa bank ltd",
      "absa bank",
      "absa.co.za",
    ],

    weakSignals: [
      "absa",
    ],
  },

  {
    subtype: DOCUMENT_SUBTYPES.FNB_STATEMENT,
    label: "FNB",

    strongSignals: [
      "first national bank",
      "firstrand bank limited",
      "a division of firstrand bank",
      "fnb.co.za",
    ],

    weakSignals: [
      "fnb",
      "firstrand",
    ],
  },

  {
    subtype: DOCUMENT_SUBTYPES.NEDBANK_STATEMENT,
    label: "Nedbank",

    strongSignals: [
      "nedbank limited",
      "nedbank.co.za",
    ],

    weakSignals: [
      "nedbank",
    ],
  },

  {
    subtype: DOCUMENT_SUBTYPES.CAPITEC_STATEMENT,
    label: "Capitec",

    strongSignals: [
      "capitec bank limited",
      "capitec bank",
      "capitecbank.co.za",
    ],

    weakSignals: [
      "capitec",
    ],
  },

  {
    subtype: DOCUMENT_SUBTYPES.DISCOVERY_STATEMENT,
    label: "Discovery Bank",

    strongSignals: [
      "discovery bank",
      "discovery gold transaction account",
    ],

    weakSignals: [
      "discovery",
    ],
  },

  {
    subtype: DOCUMENT_SUBTYPES.STANDARD_BANK_STATEMENT,
    label: "Standard Bank",

    strongSignals: [
      "the standard bank of south africa",
      "standard bank",
      "standardbank.co.za",
      "stanbic",
    ],

    weakSignals: [
      "blue wallet",
      "mymo",
    ],
  },
]);

function containsAny(text, values = []) {
  return values.some((value) => text.includes(value));
}

function scoreBankBrand(lower, header, brand) {
  const strongAnywhere = containsAny(
    lower,
    brand.strongSignals
  );

  const strongInHeader = containsAny(
    header,
    brand.strongSignals
  );

  const weakAnywhere = containsAny(
    lower,
    brand.weakSignals
  );

  const weakInHeader = containsAny(
    header,
    brand.weakSignals
  );

  /*
   * Weighting deliberately makes formal/document-level identity
   * substantially stronger than incidental bank-name mentions.
   *
   * Example:
   *
   *   First National Bank ... Payment to ABSA
   *
   * FNB:
   *   strongAnywhere = +10
   *   strongInHeader = +10
   *   weakAnywhere   = +1
   *   weakInHeader   = +2
   *
   * ABSA transaction mention:
   *   weakAnywhere   = +1
   *
   * FNB therefore wins decisively.
   */
  let score = 0;

  if (strongAnywhere) {
    score += 10;
  }

  if (strongInHeader) {
    score += 10;
  }

  if (weakAnywhere) {
    score += 1;
  }

  if (weakInHeader) {
    score += 2;
  }

  return score;
}

function detectBank(lower) {
  const header =
    lower.slice(
      0,
      HEADER_SAMPLE_LENGTH
    );

  const candidates =
    BANK_BRANDS
      .map((brand) => ({
        subtype:
          brand.subtype,

        label:
          brand.label,

        score:
          scoreBankBrand(
            lower,
            header,
            brand
          ),
      }))
      .filter(
        (candidate) =>
          candidate.score > 0
      )
      .sort(
        (a, b) =>
          b.score - a.score
      );

  if (
    candidates.length === 0
  ) {
    return null;
  }

  /*
   * Never choose arbitrarily when the evidence is tied.
   *
   * A tie is safer as "unknown" and allows the existing
   * classification-review / AI fallback policy to handle it.
   */
  if (
    candidates.length > 1 &&
    candidates[0].score ===
      candidates[1].score
  ) {
    return null;
  }

  return {
    subtype:
      candidates[0].subtype,

    label:
      candidates[0].label,
  };
}

export function extractDocumentSignals(
  text = ""
) {
  const lower =
    String(text)
      .toLowerCase();

  const detectedBank =
    detectBank(lower);

  const statementSignals = {
    openingBalance:
      lower.includes(
        "opening balance"
      ) ||
      lower.includes(
        "balance brought forward"
      ) ||
      lower.includes(
        "bal brought forward"
      ),

    closingBalance:
      lower.includes(
        "closing balance"
      ) ||
      lower.includes(
        "final balance"
      ) ||
      lower.includes(
        "current balance"
      ),

    transactionDate:
      lower.includes(
        "transaction date"
      ) ||
      lower.includes(
        "date description"
      ) ||
      lower.includes(
        "date details"
      ),

    debit:
      lower.includes("debit") ||
      lower.includes("debits"),

    credit:
      lower.includes("credit") ||
      lower.includes("credits"),

    balance:
      lower.includes("balance"),
  };

  const bankStatementSignalCount =
    Object.values(
      statementSignals
    ).filter(Boolean).length;

  return {
    lower,
    detectedBank,
    statementSignals,
    bankStatementSignalCount,

    invoiceSignal:
      lower.includes("invoice") ||
      lower.includes(
        "tax invoice"
      ) ||
      lower.includes("vat"),

    deliveryNoteSignal:
      lower.includes(
        "delivery note"
      ) ||
      lower.includes(
        "proof of delivery"
      ) ||
      lower.includes(
        "waybill"
      ),
  };
}