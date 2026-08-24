import assert from "node:assert/strict";
import test from "node:test";

import {
  heuristicClassifier,
} from "../classifier/heuristicClassifier.js";

import {
  DOCUMENT_SUBTYPES,
} from "../registry/documentTypes.js";

test(
  "FNB document identity outranks incidental ABSA transaction text",
  () => {
    const result =
      heuristicClassifier(`
First National Bank
A division of FirstRand Bank Limited
Gold Business Account
Statement Period: 30 April 2025 to 31 May 2025
Opening Balance 8,418.95 Cr

Transactions in RAND (ZAR)
Date Description Amount Balance Accrued Bank Charges

02 May FNB App Transfer To Prosper Payment 455.00 7,963.95Cr
05 May Payment To ABSA Beneficiary 500.00 7,463.95Cr

Closing Balance 7,463.95 Cr
`);

    assert.equal(
      result.documentSubtype,
      DOCUMENT_SUBTYPES.FNB_STATEMENT
    );

    assert.equal(
      result.supported,
      true
    );
  }
);

test(
  "Capitec document identity outranks FNB and ABSA transaction descriptions",
  () => {
    const result =
      heuristicClassifier(`
Capitec Bank Limited
Main Account Statement
Opening Balance: R1000.00

Transaction History
Date Description Money In Money Out Balance

01/01/2026 Banking App External PayShap Payment: FNB Premier Acc
02/01/2026 Banking App External PayShap Payment: Aiden -absa

Closing Balance: R500.00
`);

    assert.equal(
      result.documentSubtype,
      DOCUMENT_SUBTYPES.CAPITEC_STATEMENT
    );

    assert.equal(
      result.supported,
      true
    );
  }
);

test(
  "ABSA document identity outranks incidental FNB transaction text",
  () => {
    const result =
      heuristicClassifier(`
ABSA Bank Limited
Cheque Account Statement
Opening Balance 1000.00

Date Description Debit Credit Balance
01/01/2026 Payment to FNB Premier Account 100.00 900.00

Closing Balance 900.00
`);

    assert.equal(
      result.documentSubtype,
      DOCUMENT_SUBTYPES.ABSA_STATEMENT
    );

    assert.equal(
      result.supported,
      true
    );
  }
);

test(
  "ambiguous weak bank mentions do not choose the first bank in the registry",
  () => {
    const result =
      heuristicClassifier(`
Bank Account Statement
Opening Balance 1000.00
Closing Balance 900.00

Transaction Date Description Debit Credit Balance
Payment to ABSA
Payment to FNB
`);

    assert.equal(
      result.documentSubtype,
      DOCUMENT_SUBTYPES.UNKNOWN
    );

    assert.equal(
      result.supported,
      false
    );
  }
);