import assert from "node:assert/strict";
import test from "node:test";

import { extractFnbTransactions } from "../extractor/fnb/extractor.js";

const period = {
  start: "30 April 2025",
  end: "31 May 2025",
};

test("FNB Business OCR parses pipe-separated Amount/Balance/Charges", () => {
  const text = `
Transactions in RAND (ZAR)

Date Description Amount Balance Accrued Bank Charges

02 May | FNB App Transfer To Prosper Payment 4 | 455.00 | 7,963.95Cr | 28.40
02 May | FNB App Transfer From Loan Jjp - Ssp | 1,000.00Cr | 8,963.95Cr |
31 May | Send Money Dr Send 27738358354 | 900.00 | 8,063.95Cr | 23.60

Closing Balance
`;

  const rows = extractFnbTransactions(text, period, 8418.95);

  assert.equal(rows.length, 3);

  assert.deepEqual(
    rows.map(({ amount, balance }) => ({ amount, balance })),
    [
      { amount: -455, balance: 7963.95 },
      { amount: 1000, balance: 8963.95 },
      { amount: -900, balance: 8063.95 },
    ]
  );
});

test("existing FNB whitespace format remains supported", () => {
  const text = `
Transactions in RAND (ZAR)
02 May FNB App Transfer To Prosper Payment 4 455.00 7,963.95Cr
02 May FNB App Transfer From Loan Jjp - Ssp 1,000.00Cr 8,963.95Cr
Closing Balance
`;

  const rows = extractFnbTransactions(text, period, 8418.95);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].amount, -455);
  assert.equal(rows[1].amount, 1000);
});