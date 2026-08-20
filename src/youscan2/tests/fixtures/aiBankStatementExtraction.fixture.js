function field(value, confidence, evidence) {
  return {
    value,
    confidence,
    evidence: value === null ? [] : Array.isArray(evidence) ? evidence : [evidence],
  };
}

export const AI_BANK_STATEMENT_SOURCE_TEXT = `FNB BANK STATEMENT
Account Number 62123456789
Account Holder TEST CUSTOMER
Statement Period 01/07/2026 to 31/07/2026
Opening Balance 1000.00
01/07/2026 CARD PURCHASE SHOP -100.00 900.00
02/07/2026 SALARY 500.00 1400.00
03/07/2026 MONTHLY FEE -50.00 1350.00
Closing Balance 1350.00`;

export function makeValidAiBankStatementCandidate() {
  return {
    bankName: field("FNB", 0.99, "FNB BANK STATEMENT"),
    accountNumber: field("62123456789", 0.99, "Account Number 62123456789"),
    clientName: field("TEST CUSTOMER", 0.99, "Account Holder TEST CUSTOMER"),
    statementPeriodStart: field(
      "01/07/2026",
      0.99,
      "Statement Period 01/07/2026 to 31/07/2026"
    ),
    statementPeriodEnd: field(
      "31/07/2026",
      0.99,
      "Statement Period 01/07/2026 to 31/07/2026"
    ),
    openingBalance: field(1000, 0.99, "Opening Balance 1000.00"),
    closingBalance: field(1350, 0.99, "Closing Balance 1350.00"),
    transactionCount: 3,
    transactions: [
      {
        date: field(
          "01/07/2026",
          0.99,
          "01/07/2026 CARD PURCHASE SHOP -100.00 900.00"
        ),
        description: field(
          "CARD PURCHASE SHOP",
          0.99,
          "01/07/2026 CARD PURCHASE SHOP -100.00 900.00"
        ),
        amount: field(
          -100,
          0.99,
          "01/07/2026 CARD PURCHASE SHOP -100.00 900.00"
        ),
        balance: field(
          900,
          0.99,
          "01/07/2026 CARD PURCHASE SHOP -100.00 900.00"
        ),
      },
      {
        date: field("02/07/2026", 0.99, "02/07/2026 SALARY 500.00 1400.00"),
        description: field("SALARY", 0.99, "02/07/2026 SALARY 500.00 1400.00"),
        amount: field(500, 0.99, "02/07/2026 SALARY 500.00 1400.00"),
        balance: field(1400, 0.99, "02/07/2026 SALARY 500.00 1400.00"),
      },
      {
        date: field(
          "03/07/2026",
          0.99,
          "03/07/2026 MONTHLY FEE -50.00 1350.00"
        ),
        description: field(
          "MONTHLY FEE",
          0.99,
          "03/07/2026 MONTHLY FEE -50.00 1350.00"
        ),
        amount: field(-50, 0.99, "03/07/2026 MONTHLY FEE -50.00 1350.00"),
        balance: field(1350, 0.99, "03/07/2026 MONTHLY FEE -50.00 1350.00"),
      },
    ],
  };
}
