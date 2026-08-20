export const FNB_STATEMENT_FIXTURE_TEXT = `
First National Bank
FNB Business Banking
Gold Business Account : 62123456789
*ACME TRADING PTY LTD
Tax Invoice/Statement Number : 99887766
Statement Period : 01 July 2026 to 31 July 2026
Opening Balance 1,000.00 Cr
Transactions in RAND
Date Description Amount Balance
01 Jul Card Purchase Coffee Shop 100.00 Dr 900.00 Cr
02 Jul CUSTOMER PAYMENT 500.00 Cr 1,400.00 Cr
03 Jul EFT PAYMENT SUPPLIER ABC
Reference INV-7781
250.00 Dr 1,150.00 Cr
04 Jul Monthly Acc Fee 50.00 Dr 1,100.00 Cr
Closing Balance 1,100.00 Cr
`;

export const FNB_EXPECTED_TRANSACTIONS = [
  {
    date: "01/07/2026",
    description: "Card Purchase Coffee Shop",
    amount: -100,
    balance: 900,
  },
  {
    date: "02/07/2026",
    description: "CUSTOMER PAYMENT",
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

export const FNB_EXPECTED_NORMALIZED = {
  bankName: "FNB",
  accountNumber: "62123456789",
  clientName: "ACME TRADING PTY LTD",
  statementPeriodStart: "01 July 2026",
  statementPeriodEnd: "31 July 2026",
  openingBalance: 1000,
  closingBalance: 1100,
  transactions: FNB_EXPECTED_TRANSACTIONS,
  sourceFileName: "fnb-july-2026.pdf",
};

export const FNB_NO_AMOUNT_SIGN_FIXTURE_TEXT = `
First National Bank
Gold Business Account : 62123456789
*ACME TRADING PTY LTD
Statement Period : 01 July 2026 to 31 July 2026
Opening Balance 1,000.00 Cr
Transactions in RAND
01 Jul Card Purchase Coffee Shop 100.00 900.00 Cr
02 Jul CUSTOMER PAYMENT 500.00 1,400.00 Cr
Closing Balance 1,400.00 Cr
`;

export const FNB_DEBIT_BALANCE_FIXTURE_TEXT = `
First National Bank
Gold Business Account : 62123456789
*ACME TRADING PTY LTD
Statement Period : 01 July 2026 to 31 July 2026
Opening Balance 50.00 Cr
Transactions in RAND
01 Jul Monthly Acc Fee 100.00 Dr 50.00 Dr
Closing Balance 50.00 Dr
`;
