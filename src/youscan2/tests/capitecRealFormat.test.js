import test from "node:test";
import assert from "node:assert/strict";

import {
  extractCapitecTransactions,
} from "../extractor/capitec/extractor.js";

const REAL_FORMAT_SAMPLE = `
Main Account Statement

Statement Information
From Date: 01/03/2025
Opening Balance: R1 525.85
To Date: 24/03/2025
Closing Balance: R533.87

Transaction History

Date Description Category Money In Money Out Fee* Balance
* Includes 15% VAT

24hr Client Care Centre 0860 10 20 43
Capitec Bank is an authorised financial services
Unique Document No.: synthetic-document / 204 / V5.0
Page 1 of 2

Date Description Category Money In Money Out Fee* Balance

01/03/2025 Live Better Interest Sweep
Transfer -0.62 1 525.23

01/03/2025 Online Purchase: Example Merchant (Card 7827)
Cellphone -1 475.99 49.24

02/03/2025 Live Better Round-up Transfer
Transfer -4.01 45.23

13/03/2025 Transfer from Live Better Savings Account
Transfer 4.64 49.87

13/03/2025 PayShap Payment Received: Example
Other Income 20.00 69.87

13/03/2025 Immediate Capitec Pay Payment: Example
Digital Payments -35.00 -1.00 33.87

20/03/2025 PayShap Payment Received: Example
Other Income 500.00 533.87

* Includes 15% VAT
`;

test(
  "Capitec real format continues after page-one footer content",
  () => {
    const transactions =
      extractCapitecTransactions(
        REAL_FORMAT_SAMPLE,
        1525.85
      );

    assert.equal(
      transactions.length,
      7
    );

    assert.equal(
      transactions[0].date,
      "01/03/2025"
    );

    assert.equal(
      transactions.at(-1).date,
      "20/03/2025"
    );

    assert.equal(
      transactions.at(-1).balance,
      533.87
    );
  }
);

test(
  "Capitec real format preserves wrapped transaction descriptions",
  () => {
    const transactions =
      extractCapitecTransactions(
        REAL_FORMAT_SAMPLE,
        1525.85
      );

    const transaction =
      transactions.find(
        (entry) =>
          entry.description.includes(
            "Online Purchase"
          )
      );

    assert.ok(transaction);

    assert.match(
      transaction.description,
      /Example Merchant/
    );

    assert.match(
      transaction.description,
      /Cellphone/
    );
  }
);

test(
  "Capitec real format includes separate fee in account movement",
  () => {
    const transactions =
      extractCapitecTransactions(
        REAL_FORMAT_SAMPLE,
        1525.85
      );

    const payment =
      transactions.find(
        (transaction) =>
          transaction.description.includes(
            "Immediate Capitec Pay Payment"
          )
      );

    assert.ok(payment);

    assert.equal(
      payment.amount,
      -36
    );

    assert.equal(
      payment.balance,
      33.87
    );
  }
);

test(
  "Capitec real format reconciles opening to closing balance",
  () => {
    const transactions =
      extractCapitecTransactions(
        REAL_FORMAT_SAMPLE,
        1525.85
      );

    const total =
      transactions.reduce(
        (
          sum,
          transaction
        ) =>
          sum +
          transaction.amount,
        0
      );

    const calculatedClosing =
      Math.round(
        (
          1525.85 +
          total
        ) *
          100
      ) /
      100;

    assert.equal(
      calculatedClosing,
      533.87
    );
  }
);

test(
  "Capitec amount parser accepts printed asterisk marker",
  () => {
    const sample = `
Transaction History

Date Description Category Money In Money Out Fee* Balance

23/01/2026 Banking App Prepaid Purchase: Electricity
Electricity -150.00* -1.00 843.11

* Includes VAT at 15%
`;

    const transactions =
      extractCapitecTransactions(
        sample,
        994.11
      );

    assert.equal(
      transactions.length,
      1
    );

    assert.equal(
      transactions[0].amount,
      -151
    );

    assert.equal(
      transactions[0].balance,
      843.11
    );
  }
);

test(
  "Capitec repeated page headers are not added to transaction descriptions",
  () => {
    const sample = `
Transaction History

Date Description Category Money In Money Out Fee* Balance

01/03/2025 Example Purchase
Groceries -25.00 75.00

* Includes 15% VAT
24hr Client Care Centre 0860 10 20 43
Capitec Bank is an authorised financial services
Unique Document No.: synthetic-document
Page 1 of 2

Date Description Category Money In Money Out Fee* Balance

02/03/2025 Example Payment Received
Other Income 50.00 125.00

* Includes 15% VAT
`;

    const transactions =
      extractCapitecTransactions(
        sample,
        100
      );

    assert.equal(
      transactions.length,
      2
    );

    assert.doesNotMatch(
      transactions[0].description,
      /Client Care/i
    );

    assert.doesNotMatch(
      transactions[0].description,
      /Unique Document/i
    );

    assert.equal(
      transactions[1].balance,
      125
    );
  }
);

test(
  "Capitec real PDF format accepts pipe-separated monetary columns",
  () => {
    const sample = `
Transaction History

Date Description Category Money In Money Out Fee* Balance

01/03/2025|Live Better Interest Sweep|Transfer||-0.62||1 525.23
01/03/2025|Online Purchase Example Merchant|Cellphone||-1 475.99||49.24
13/03/2025|Immediate Capitec Pay Payment|Digital Payments||-35.00|-1.00|13.24
`;

    const transactions =
      extractCapitecTransactions(
        sample,
        1525.85
      );

    assert.equal(
      transactions.length,
      3
    );

    assert.equal(
      transactions[0].amount,
      -0.62
    );

    assert.equal(
      transactions[0].balance,
      1525.23
    );

    assert.equal(
      transactions[1].amount,
      -1475.99
    );

    assert.equal(
      transactions[1].balance,
      49.24
    );

    assert.equal(
      transactions[2].amount,
      -36
    );

    assert.equal(
      transactions[2].balance,
      13.24
    );
  }
);

test(
  "Capitec real PDF format separates fused monetary columns",
  () => {
    const singleRow = (
      row,
      openingBalance
    ) => {
      const sample = `
Transaction History

Date Description Category Money In Money Out Fee* Balance

${row}
`;

      return extractCapitecTransactions(
        sample,
        openingBalance
      );
    };

    const feeRow =
      singleRow(
        "12/12/2025 Banking App External PayShap Payment Digital Payments-200.00-6.002 372.24",
        2578.24
      );

    assert.equal(
      feeRow.length,
      1
    );

    assert.equal(
      feeRow[0].amount,
      -206
    );

    assert.equal(
      feeRow[0].balance,
      2372.24
    );

    const fusedBalanceRow =
      singleRow(
        "16/12/2025 ATM Cash Withdrawal Cash Withdrawal-83.0082.24",
        165.24
      );

    assert.equal(
      fusedBalanceRow.length,
      1
    );

    assert.equal(
      fusedBalanceRow[0].amount,
      -83
    );

    assert.equal(
      fusedBalanceRow[0].balance,
      82.24
    );

    const thousandsBalanceRow =
      singleRow(
        "01/03/2025 Live Better Interest Sweep Transfer-0.621 525.23",
        1525.85
      );

    assert.equal(
      thousandsBalanceRow.length,
      1
    );

    assert.equal(
      thousandsBalanceRow[0].amount,
      -0.62
    );

    assert.equal(
      thousandsBalanceRow[0].balance,
      1525.23
    );
  }
);