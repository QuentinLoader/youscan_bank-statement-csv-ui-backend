export const CAPITEC_STATEMENT_FIXTURE_TEXT = `
Capitec Bank Limited
Main Account Statement
MR JOHN SAMPLE
Account
1234567890
Unique Document No.: 7f3e9c4a-1111-2222-3333-abcdef123456
From Date: 01/07/2026
To Date: 31/07/2026
Opening Balance: R1,000.00
Transaction History
Date Description Amount Balance
01/07/2026 Card Purchase Coffee Shop 100.00 900.00
02/07/2026 Salary Payment 500.00 1,400.00
03/07/2026 EFT Payment Supplier ABC
Reference INV-7781
250.00 1,150.00
04/07/2026 Monthly Service Fee 50.00 1,100.00
Closing Balance: R1,100.00
* Includes VAT where applicable
`;

export const CAPITEC_EXPECTED_TRANSACTIONS = [
  {
    date: "01/07/2026",
    description: "Card Purchase Coffee Shop",
    amount: -100,
    balance: 900,
  },
  {
    date: "02/07/2026",
    description: "Salary Payment",
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

export const CAPITEC_EXPECTED_NORMALIZED = {
  bankName: "Capitec",
  accountNumber: "1234567890",
  clientName: "MR JOHN SAMPLE",
  statementPeriodStart: "01/07/2026",
  statementPeriodEnd: "31/07/2026",
  openingBalance: 1000,
  closingBalance: 1100,
  transactions: CAPITEC_EXPECTED_TRANSACTIONS,
  sourceFileName: "capitec-july-2026.pdf",
};

export const CAPITEC_NEGATIVE_BALANCE_FIXTURE_TEXT = `
Capitec Bank Limited
Main Account Statement
MR JOHN SAMPLE
Account
1234567890
From Date: 01/07/2026
To Date: 31/07/2026
Opening Balance: R50.00
Transaction History
01/07/2026 Cash Withdrawal 100.00 -50.00
Closing Balance: R-50.00
`;

export const CAPITEC_EXPLICIT_NEGATIVE_AMOUNT_FIXTURE_TEXT = `
Capitec Bank Limited
Main Account Statement
MR JOHN SAMPLE
Account
1234567890
From Date: 01/07/2026
To Date: 31/07/2026
Opening Balance: R1,000.00
Transaction History
01/07/2026 Card Purchase 100.00 900.00
02/07/2026 Reversal -100.00 1,000.00
Closing Balance: R1,000.00
`;
