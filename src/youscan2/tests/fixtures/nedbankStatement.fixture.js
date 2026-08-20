export const NEDBANK_STATEMENT_FIXTURE_TEXT = `
Nedbank Ltd
Current Account Statement
MR JOHN SAMPLE
Account number 1605123456
Statement date: 31/07/2026
Statement period: 01/07/2026 - 31/07/2026
Opening balance R1,000.00 Cr
Date Description Amount Balance
01/07/2026 Card Purchase Coffee Shop 100.00 900.00 Cr
02/07/2026 Salary Deposit 500.00 1,400.00 Cr
03/07/2026 EFT Payment Supplier ABC
Reference INV-7781
250.00 1,150.00 Cr
04/07/2026 Monthly Service Fee 50.00 1,100.00 Cr
Closing balance R1,100.00 Cr
Statement Summary
`;

export const NEDBANK_EXPECTED_TRANSACTIONS = [
  {
    date: "01/07/2026",
    description: "Card Purchase Coffee Shop",
    amount: -100,
    balance: 900,
  },
  {
    date: "02/07/2026",
    description: "Salary Deposit",
    amount: 500,
    balance: 1400,
  },
  {
    date: "03/07/2026",
    description: "EFT Payment Supplier ABC Reference INV-7781",
    amount: -250,
    balance: 1150,
  },
  {
    date: "04/07/2026",
    description: "Monthly Service Fee",
    amount: -50,
    balance: 1100,
  },
];

export const NEDBANK_EXPECTED_NORMALIZED = {
  bankName: "Nedbank",
  accountNumber: "1605123456",
  clientName: "MR JOHN SAMPLE",
  statementPeriodStart: "01/07/2026",
  statementPeriodEnd: "31/07/2026",
  openingBalance: 1000,
  closingBalance: 1100,
  transactions: NEDBANK_EXPECTED_TRANSACTIONS,
  sourceFileName: "nedbank-july-2026.pdf",
};

export const NEDBANK_BALANCE_ONLY_FIXTURE_TEXT = `
Nedbank Ltd
Current Account Statement
MR JOHN SAMPLE
Account number 1605123456
Statement period: 01/07/2026 - 31/07/2026
Opening balance R1,000.00 Cr
Date Description Balance
01/07/2026 Card Purchase Coffee Shop 900.00 Cr
02/07/2026 Salary Deposit 1,400.00 Cr
Closing balance R1,400.00 Cr
`;

export const NEDBANK_NEGATIVE_BALANCE_FIXTURE_TEXT = `
Nedbank Ltd
Current Account Statement
MR JOHN SAMPLE
Account number 1605123456
Statement period: 01/07/2026 - 31/07/2026
Opening balance R50.00 Cr
Date Description Amount Balance
01/07/2026 Cash Withdrawal 100.00 50.00 Dr
Closing balance R50.00 Dr
`;
