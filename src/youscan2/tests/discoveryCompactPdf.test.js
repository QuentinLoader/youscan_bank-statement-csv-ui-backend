import test from "node:test";
import assert from "node:assert/strict";

import {
  extractDiscoveryTransactions,
} from "../extractor/discovery/extractor.js";

const COMPACT_DISCOVERY_TEXT = `
Discovery Gold Transaction Account statement
Transaction timeline
Date Card no. Type Details Amount
Opening balance R12.98
8 Jan 2026Miles transfer to cash R97.508 Jan 2026***6508 POS Purchase HPY*Tobacco King Brakpan - R80.0012 Jan 2026***8464 Declined Int Card Purch - R0.0012 Jan 2026***8464 Fee Txn Declined Fee Google Apple Music - R6.0012 Jan 2026RPP PayShap Disco R60.0013 Jan 2026***8464 Online Google Apple Music 34.99 ZAR - R34.9913 Jan 2026Fee Intl payment fee Google Apple Music - R0.70
Closing balance R48.79
`;

test(
  "Discovery production compact PDF separates dates glued to amounts and descriptions",
  () => {
    const transactions =
      extractDiscoveryTransactions(
        COMPACT_DISCOVERY_TEXT,
        12.98
      );

    assert.equal(
      transactions.length,
      6
    );

    assert.deepEqual(
      transactions.map(
        (tx) => tx.amount
      ),
      [
        97.5,
        -80,
        -6,
        60,
        -34.99,
        -0.7,
      ]
    );

    assert.equal(
      transactions[0].description,
      "Miles transfer to cash"
    );

    assert.equal(
      transactions[1].description,
      "POS Purchase HPY*Tobacco King Brakpan"
    );

    assert.equal(
      transactions[3].description,
      "RPP PayShap Disco"
    );

    assert.equal(
      transactions.at(-1).balance,
      48.79
    );
  }
);