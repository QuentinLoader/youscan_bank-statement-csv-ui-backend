import test from "node:test";
import assert from "node:assert/strict";

import {
  extractCapitecOpeningBalance,
  extractCapitecClosingBalance,
  extractCapitecStatementPeriod,
} from "../extractor/shared/metadata.js";

test(
  "Capitec metadata preserves labelled opening and closing balance format",
  () => {
    const text = `
Main Account Statement

Statement Information
From Date: 01/07/2026
Opening Balance: R1,000.00
To Date: 31/07/2026
Closing Balance: R1,100.00
`;

    assert.equal(
      extractCapitecOpeningBalance(text),
      1000
    );

    assert.equal(
      extractCapitecClosingBalance(text),
      1100
    );
  }
);

test(
  "Capitec real PDF metadata extracts detached opening and closing balances",
  () => {
    const text = `
Money In Summary
R524.64
-R1.00
R503.87
R533.87
R1 525.85
1862555255
Main Account Statement
MR SAMPLE CLIENT

Account
Statement Information
From Date: 01/03/2025 Opening Balance:
To Date: 24/03/2025 Closing Balance:
Print Date: 24/03/2025 08:39 Available Balance:
`;

    assert.deepEqual(
      extractCapitecStatementPeriod(text),
      {
        start: "01/03/2025",
        end: "24/03/2025",
      }
    );

    assert.equal(
      extractCapitecOpeningBalance(text),
      1525.85
    );

    assert.equal(
      extractCapitecClosingBalance(text),
      533.87
    );
  }
);

test(
  "Capitec large real PDF metadata selects balances nearest the account number",
  () => {
    const text = `
Money In Summary
Other Income R32 019.37
Payment Received R2 500.00
Interest R19.56
R34 538.93
-R228.50
R19.56
R109.11
R139.11
R67.26
1560704215
Main Account Statement
MR SAMPLE CLIENT

Account
Statement Information
From Date: 01/12/2025 Opening Balance:
To Date: 31/01/2026 Closing Balance:
Print Date: 31/01/2026 20:50 Available Balance:
`;

    assert.deepEqual(
      extractCapitecStatementPeriod(text),
      {
        start: "01/12/2025",
        end: "31/01/2026",
      }
    );

    assert.equal(
      extractCapitecOpeningBalance(text),
      67.26
    );

    assert.equal(
      extractCapitecClosingBalance(text),
      139.11
    );
  }
);