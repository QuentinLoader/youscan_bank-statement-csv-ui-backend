export const ABSA_STATEMENT_FIXTURE_TEXT = `
ABSA Bank Limited
Cheque account statement ACME TRADING PTY LTD 40-1234-5678
Statement period: 01/07/2026 to 31/07/2026
Opening balance: 1,000.00
Date Transaction Description Debit Credit Balance
01/07/2026 Card Purchase Coffee Shop 100.00 900.00
02/07/2026 ACB CREDIT CUSTOMER PAYMENT 500.00 1,400.00
03/07/2026 EFT PAYMENT SUPPLIER ABC
Reference INV-7781 250.00 1,150.00
04/07/2026 Monthly Acc Fee 50.00 1,100.00
Closing balance: 1,100.00
SERVICE FEE:
Cheque account statement
Our Privacy Notice
`;

export const ABSA_EXPECTED_TRANSACTIONS = [
  {
    date: "01/07/2026",
    description: "Card Purchase Coffee Shop",
    amount: -100,
    balance: 900,
  },
  {
    date: "02/07/2026",
    description: "ACB CREDIT CUSTOMER PAYMENT",
    amount: 500,
    balance: 1400,
  },
  {
    date: "03/07/2026",
    description: "EFT PAYMENT SUPPLIER ABC Reference INV-7781",
    amount: -250,
    balance: 1150,
  },
  {
    date: "04/07/2026",
    description: "Monthly Acc Fee",
    amount: -50,
    balance: 1100,
  },
];

export const ABSA_EXPECTED_NORMALIZED = {
  bankName: "ABSA",
  accountNumber: "4012345678",
  clientName: "ACME TRADING PTY LTD",
  statementPeriodStart: "01/07/2026",
  statementPeriodEnd: "31/07/2026",
  openingBalance: 1000,
  closingBalance: 1100,
  transactions: ABSA_EXPECTED_TRANSACTIONS,
  sourceFileName: "absa-july-2026.pdf",
};
