import test from "node:test";
import assert from "node:assert/strict";

import {
  extractNedbankTransactions,
} from "../extractor/nedbank/extractor.js";

import {
  extractNedbankStatementPeriod,
  extractNedbankOpeningBalance,
  extractNedbankClosingBalance,
} from "../extractor/shared/metadata.js";

const REAL_NEDBANK_SAMPLE = `
Account summary
Account type Account number
Current account 1605175781
Statement date: 19/07/2025 Envelope: 1 of 1
Statement period: 20/06/2025 – 19/07/2025 Total pages: 2

Opening balance R343.27
Funds received/Credits R12,419.18
Funds used/Debits R12,171.16
Closing balance R591.29

Bank charges for the period 20 June 2025 to 19 July 2025
Narrative Description Item cost (R) VAT (R) Total (R)
Electronic banking fees 17.39 2.61 20.00
Transaction service fees 43.48 6.52 50.00
Other charges 217.39 32.61 250.00
Total Charges 320.00

Tran list no Date Description Fees (R) Debits (R) Credits (R) Balance (R)
26/06/2025 Opening balance 343.27
000643 26/06/2025 VAT 28/05-25/06 = R41.73 0.00 343.27
26/06/2025 INTEREST 28/05 - 25/06 0.19 343.08
26/06/2025 MAINTENANCE FEE 250.00 * 93.08
27/06/2025 JHH FNB ACC. 400.00 493.08
27/06/2025 WOOLWORTHS 541282XXXXXX7325 210.97 282.11
27/06/2025 Tanya 240.00 42.11
07/07/2025 ABSA BANK Payback ssprops 250.00 292.11
07/07/2025 BDS STANDA 0707 1345 INS FUNDS 10.00 * 282.11
07/07/2025 BDS STANDA 0707 1345 INS FUNDS 10.00 * 272.11
08/07/2025 A SARS 0331191155 221003 11,369.18 11,641.29
08/07/2025 JHH FNB Acc 10,000.00 1,641.29
08/07/2025 Woord & Lewe Tiende 1,400.00 241.29
08/07/2025 Instant payment fee 50.00 * 191.29
19/07/2025 2370461953|Bank Charges 100.00 291.29
19/07/2025 2370500023|Bank Charges 100.00 391.29
19/07/2025 2370500303|Bank Charges 100.00 491.29
19/07/2025 2370500306|Bank Charges 100.00 591.29
Closing balance 591.29
`;

test(
  "Nedbank real format extracts statement metadata",
  () => {
    assert.deepEqual(
      extractNedbankStatementPeriod(
        REAL_NEDBANK_SAMPLE
      ),
      {
        start: "20/06/2025",
        end: "19/07/2025",
      }
    );

    assert.equal(
      extractNedbankOpeningBalance(
        REAL_NEDBANK_SAMPLE
      ),
      343.27
    );

    assert.equal(
      extractNedbankClosingBalance(
        REAL_NEDBANK_SAMPLE
      ),
      591.29
    );
  }
);

test(
  "Nedbank real format ignores summary totals and extracts transaction table only",
  () => {
    const transactions =
      extractNedbankTransactions(
        REAL_NEDBANK_SAMPLE,
        343.27
      );

    assert.equal(
      transactions.length,
      16
    );

    assert.equal(
      transactions.some(
        (tx) =>
          tx.amount === 320
      ),
      false
    );
  }
);

test(
  "Nedbank real format excludes zero-movement VAT row",
  () => {
    const transactions =
      extractNedbankTransactions(
        REAL_NEDBANK_SAMPLE,
        343.27
      );

    assert.equal(
      transactions.some(
        (tx) =>
          /\bVAT\b/i.test(
            tx.description
          )
      ),
      false
    );
  }
);

test(
  "Nedbank real format derives debit and credit signs from running balance",
  () => {
    const transactions =
      extractNedbankTransactions(
        REAL_NEDBANK_SAMPLE,
        343.27
      );

    assert.equal(
      transactions[0].amount,
      -0.19
    );

    assert.equal(
      transactions[1].amount,
      -250
    );

    assert.equal(
      transactions[2].amount,
      400
    );
  }
);

test(
  "Nedbank real format ends on printed closing balance",
  () => {
    const transactions =
      extractNedbankTransactions(
        REAL_NEDBANK_SAMPLE,
        343.27
      );

    assert.equal(
      transactions.at(-1).balance,
      591.29
    );
  }
);

test(
  "Nedbank real format fully reconciles",
  () => {
    const transactions =
      extractNedbankTransactions(
        REAL_NEDBANK_SAMPLE,
        343.27
      );

    const total =
      transactions.reduce(
        (sum, tx) =>
          sum + tx.amount,
        0
      );

    const calculatedClosing =
      Math.round(
        (
          343.27 +
          total
        ) *
          100
      ) /
      100;

    assert.equal(
      calculatedClosing,
      591.29
    );
  }
);