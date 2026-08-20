import { AI_CONTRACT_VERSION, AI_TASKS } from "../../ai/contracts.js";

function field(value, evidence, confidence = 0.99) {
  return {
    value,
    confidence,
    evidence: value === null ? [] : Array.isArray(evidence) ? evidence : [evidence],
  };
}

export function makeFnbShadowCandidate({ omitReferenceFromDescription = false } = {}) {
  const statementPeriodEvidence =
    "Statement Period : 01 July 2026 to 31 July 2026";
  const tx1 = "01 Jul Card Purchase Coffee Shop 100.00 Dr 900.00 Cr";
  const tx2 = "02 Jul CUSTOMER PAYMENT 500.00 Cr 1,400.00 Cr";
  const tx3 =
    "03 Jul EFT PAYMENT SUPPLIER ABC Reference INV-7781 250.00 Dr 1,150.00 Cr";
  const tx4 = "04 Jul Monthly Acc Fee 50.00 Dr 1,100.00 Cr";

  return {
    bankName: field("FNB", "First National Bank"),
    accountNumber: field(
      "62123456789",
      "Gold Business Account : 62123456789"
    ),
    clientName: field("ACME TRADING PTY LTD", "*ACME TRADING PTY LTD"),
    statementPeriodStart: field("01/07/2026", statementPeriodEvidence),
    statementPeriodEnd: field("31/07/2026", statementPeriodEvidence),
    openingBalance: field(1000, "Opening Balance 1,000.00 Cr"),
    closingBalance: field(1100, "Closing Balance 1,100.00 Cr"),
    transactionCount: 4,
    transactions: [
      {
        date: field("01/07/2026", tx1),
        description: field("Card Purchase Coffee Shop", tx1),
        amount: field(-100, tx1),
        balance: field(900, tx1),
      },
      {
        date: field("02/07/2026", tx2),
        description: field("CUSTOMER PAYMENT", tx2),
        amount: field(500, tx2),
        balance: field(1400, tx2),
      },
      {
        date: field("03/07/2026", tx3),
        description: field(
          omitReferenceFromDescription
            ? "EFT PAYMENT SUPPLIER ABC"
            : "EFT PAYMENT SUPPLIER ABC Reference INV-7781",
          omitReferenceFromDescription ? "EFT PAYMENT SUPPLIER ABC" : tx3
        ),
        amount: field(-250, tx3),
        balance: field(1150, tx3),
      },
      {
        date: field("04/07/2026", tx4),
        description: field("Monthly Acc Fee", tx4),
        amount: field(-50, tx4),
        balance: field(1100, tx4),
      },
    ],
  };
}

export function makeShadowAiEnvelope(candidate = makeFnbShadowCandidate(), overrides = {}) {
  return {
    contractVersion: AI_CONTRACT_VERSION,
    task: AI_TASKS.EXTRACT_BANK_STATEMENT,
    confidence: 0.99,
    data: candidate,
    warnings: [],
    evidence: ["Structured bank-statement extraction completed"],
    ...overrides,
  };
}
