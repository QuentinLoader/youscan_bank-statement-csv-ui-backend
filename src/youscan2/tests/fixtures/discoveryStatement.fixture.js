export const DISCOVERY_STATEMENT_FIXTURE_TEXT = `
Discovery Bank Limited
Discovery Gold Transaction Account
MR JOHN SAMPLE
Transaction Account 123456789012
Statement period: 01 Jul 2026 - 31 Jul 2026
Opening balance R 1,000.00
Details Amount Type
01 Jul 2026 POS Purchase Coffee Shop -R100.00
02 Jul 2026 Salary Deposit R500.00
03 Jul 2026 EFT Payment Supplier ABC
Reference INV-7781
-R250.00
04 Jul 2026 Monthly Account Fee -R50.00
Closing balance R 1,100.00
Statement Summary
`;

export const DISCOVERY_EXPECTED_TRANSACTIONS = [
  {
    date: "01/07/2026",
    description: "POS Purchase Coffee Shop",
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
    description: "Monthly Account Fee",
    amount: -50,
    balance: 1100,
  },
];

export const DISCOVERY_EXPECTED_NORMALIZED = {
  bankName: "Discovery Bank",
  accountNumber: "123456789012",
  clientName: "MR JOHN SAMPLE",
  statementPeriodStart: "01 Jul 2026",
  statementPeriodEnd: "31 Jul 2026",
  openingBalance: 1000,
  closingBalance: 1100,
  transactions: DISCOVERY_EXPECTED_TRANSACTIONS,
  sourceFileName: "discovery-july-2026.pdf",
};

export const DISCOVERY_QUOTED_MULTILINE_FIXTURE_TEXT = `
Discovery Bank Limited
Discovery Gold Transaction Account
MR JOHN SAMPLE
Transaction Account 123456789012
Statement period: 01 Jul 2026 - 31 Jul 2026
Opening balance R 1,000.00
"Details","Amount","Type"
"01 Jul 2026\n02 Jul 2026","POS Purchase Coffee Shop\nSalary Deposit","-R100.00\nR500.00","Card\nEFT"
Closing balance R 1,400.00
`;

export const DISCOVERY_OBSERVED_BALANCE_FIXTURE_TEXT = `
Discovery Bank Limited
Discovery Gold Transaction Account
MR JOHN SAMPLE
Transaction Account 123456789012
Statement period: 01 Jul 2026 - 31 Jul 2026
Opening balance R 1,000.00
Details Amount Balance
01 Jul 2026 POS Purchase Coffee Shop -R100.00 R900.00
02 Jul 2026 Salary Deposit R500.00 R1,400.00
Closing balance R 1,400.00
`;

export const DISCOVERY_INVERTED_DATE_FIXTURE_TEXT = `
Discovery Bank Limited
Discovery Gold Transaction Account
MR JOHN SAMPLE
Transaction Account 123456789012
Statement period: 01 Jul 2026 - 31 Jul 2026
Opening balance R 1,000.00
Jul 2026 27 Online Transfer -R100.00
Closing balance R 900.00
`;
