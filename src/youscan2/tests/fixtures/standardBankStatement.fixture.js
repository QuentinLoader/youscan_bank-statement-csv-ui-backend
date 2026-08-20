export const STANDARD_BANK_STATEMENT_FIXTURE_TEXT = `
The Standard Bank of South Africa Limited
BANK STATEMENT / TAX INVOICE
MR. JOHN DOE
Account Number 1009 547 382 1
Statement from 01 July 2026 to 31 July 2026
BALANCE BROUGHT FORWARD 1,000.00
Details
Card Purchase Coffee Shop 010726
100.00 900.00
ACB CREDIT CUSTOMER PAYMENT 020726
500.00 1,400.00
EFT PAYMENT SUPPLIER ABC
ROL030726
250.00 1,150.00
Monthly Acc Fee 040726
50.00- 1,100.00
Month-end Balance R1,100.00
`;

export const STANDARD_BANK_EXPECTED_TRANSACTIONS = [
  {
    date: "01/07/2026",
    description: "Card Purchase Coffee Shop 010726",
    amount: -100,
    balance: 900,
  },
  {
    date: "02/07/2026",
    description: "ACB CREDIT CUSTOMER PAYMENT 020726",
    amount: 500,
    balance: 1400,
  },
  {
    date: "03/07/2026",
    description: "EFT PAYMENT SUPPLIER ABC ROL030726",
    amount: -250,
    balance: 1150,
  },
  {
    date: "04/07/2026",
    description: "Monthly Acc Fee 040726",
    amount: -50,
    balance: 1100,
  },
];

export const STANDARD_BANK_EXPECTED_NORMALIZED = {
  bankName: "Standard Bank",
  accountNumber: "10095473821",
  clientName: "MR. JOHN DOE",
  statementPeriodStart: "01 July 2026",
  statementPeriodEnd: "31 July 2026",
  openingBalance: 1000,
  closingBalance: 1100,
  transactions: STANDARD_BANK_EXPECTED_TRANSACTIONS,
  sourceFileName: "standard-bank-july-2026.pdf",
};

export const STANDARD_BANK_REVERSAL_FIXTURE_TEXT = `
The Standard Bank of South Africa Limited
BANK STATEMENT / TAX INVOICE
MR. JOHN DOE
Account Number 1009 547 382 1
Statement from 01 July 2026 to 31 July 2026
BALANCE BROUGHT FORWARD 1,000.00
Debit Order Example 050726
75.00 925.00
123456
RTD-NOT PROVIDED FOR
Monthly Acc Fee 060726
25.00 975.00
Month-end Balance R975.00
`;
