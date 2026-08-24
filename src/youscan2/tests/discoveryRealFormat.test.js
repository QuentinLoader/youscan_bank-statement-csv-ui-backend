import test from "node:test";
import assert from "node:assert/strict";

import {
  extractDiscoveryTransactions,
} from "../extractor/discovery/extractor.js";

import {
  extractDiscoveryAccountNumber,
  extractDiscoveryClientName,
  extractDiscoveryStatementPeriod,
  extractDiscoveryOpeningBalance,
  extractDiscoveryClosingBalance,
} from "../extractor/shared/metadata.js";

const REAL_DISCOVERY_SAMPLE = `
Discovery Gold Transaction Account statement
TAX INVOICE
Mr A Loader
Statement number 17
Statement date 4 February 2026
Statement period 05 Jan 2026 - 04 Feb 2026
Overdraft limit R0.00
Minimum amount due R0.00
Your account summary
Opening balance on 5 January 2026 R12.98
Closing balance on 4 February 2026 R71.73
Discovery Gold Transaction Account 19826277601
Transaction timeline
Date Card no. Type Details Amount
Opening balance R12.98
8 Jan 2026 Miles transfer to cash R97.50
8 Jan 2026 ***6508 POS Purchase HPY*Tobacco King Brakpan - R80.00
12 Jan 2026 ***8464 Declined Int Card Purch - R0.00
12 Jan 2026 ***8464 Fee Txn Declined Fee Google Apple Music - R6.00
12 Jan 2026 RPP PayShap Disco R60.00
13 Jan 2026 ***8464 Online Google Apple Music 34.99 ZAR - R34.99
13 Jan 2026 Fee Intl payment fee Google Apple Music - R0.70
16 Jan 2026 Transfer Inter account transfer from account...9528
a
R150.02
16 Jan 2026 Miles transfer to cash R22.50
16 Jan 2026 RPP PayShap Aiden - R150.00
16 Jan 2026 Fee PayShap payment fee - R5.00
16 Jan 2026 ***6508 Online Playabets MP (Pty) Ltd - R25.00
20 Jan 2026 EFT Aiden Disco R1 600.00
21 Jan 2026 ***8464 POS Purchase Yoco *Hoerskool Stof Brakpan - R55.00
21 Jan 2026 ***6508 Online Playabets MP (Pty) Ltd - R25.00
22 Jan 2026 ***6508 POS Purchase ENGEN SHERWOOD GARDENS Brakpan - R36.90
1 Discovery Place, Sandhurst, Sandton, PO Box 786722, Sandton, 2196 | 0800 07 96 97
Discovery Bank Limited. Registration number 2015/408745/06. An authorised financial services and registered credit provider.
FSP number 48657. NCR registration number NCRCP9997. VAT registration number 4590272730. Limits, terms and conditions apply.Date Card no. Type Details Amount
24 Jan 2026 EFT Aiden Disco R150.00
24 Jan 2026 ***8464 POS Purchase New Uber Eats CPT - R304.26
26 Jan 2026 EFT Aiden Disco R100.00
26 Jan 2026 ***8464 Online PP *Showmax - R99.00
27 Jan 2026 RPP PayShap A LOADER R950.00
27 Jan 2026 ***6508 POS Purchase Spar Express Dalpark Gauteng South - R43.50
27 Jan 2026 ***6508 POS Purchase iK *Vape Avenue Brakpa BRAKPAN - R320.00
27 Jan 2026 ***8464 Online VODACOM MINI APPS PMT EN - R1 591.99
29 Jan 2026 EFT Aiden Disco R200.00
29 Jan 2026 ***6508 POS Purchase Yoco *Spoorloos Boksburg - R60.00
30 Jan 2026 ***6508 POS Purchase STOETBUL PRETOR 144525
MORELETAPARK - R68.00
30 Jan 2026 ***6508 POS Purchase STOETBUL PRETOR 144525
MORELETAPARK - R85.00
30 Jan 2026 ***6508 POS Purchase STOETBUL PRETOR 144525
MORELETAPARK - R85.00
30 Jan 2026 ***6508 POS Purchase PADSTAL 109356 PRETORIA - R60.00
31 Jan 2026 RPP PayShap Lief - R100.00
31 Jan 2026 Fee PayShap payment fee - R1.00
4 Feb 2026 Interest Interest Earned at 0.10% R0.04
4 Feb 2026 Fee Monthly Account fee - R15.00
4 Feb 2026 Fee Vitality Money Premium - R20.00
4 Feb 2026 Reward Dynamic interest boost at 0.08% R0.03
Closing balance R71.73
Total VAT 5.35 = fees charged (VAT incl.)
***6508 Mr Aiden Loader
***8464 Mr Aiden Loader
`;

function round2(value) {
  return Math.round(
    value * 100
  ) / 100;
}

test(
  "Discovery real format extracts authoritative metadata",
  () => {
    assert.equal(
      extractDiscoveryAccountNumber(
        REAL_DISCOVERY_SAMPLE
      ),
      "19826277601"
    );

    assert.equal(
      extractDiscoveryClientName(
        REAL_DISCOVERY_SAMPLE
      ),
      "Mr A Loader"
    );

    assert.deepEqual(
      extractDiscoveryStatementPeriod(
        REAL_DISCOVERY_SAMPLE
      ),
      {
        start:
          "05 Jan 2026",
        end:
          "04 Feb 2026",
      }
    );

    assert.equal(
      extractDiscoveryOpeningBalance(
        REAL_DISCOVERY_SAMPLE
      ),
      12.98
    );

    assert.equal(
      extractDiscoveryClosingBalance(
        REAL_DISCOVERY_SAMPLE
      ),
      71.73
    );
  }
);

test(
  "Discovery real format extracts 35 financial transactions",
  () => {
    const transactions =
      extractDiscoveryTransactions(
        REAL_DISCOVERY_SAMPLE,
        12.98
      );

    assert.equal(
      transactions.length,
      35
    );
  }
);

test(
  "Discovery real format excludes zero-value declined informational row",
  () => {
    const transactions =
      extractDiscoveryTransactions(
        REAL_DISCOVERY_SAMPLE,
        12.98
      );

    assert.equal(
      transactions.some(
        (tx) =>
          /Declined Int Card Purch/i.test(
            tx.description
          )
      ),
      false
    );

    assert.equal(
      transactions.some(
        (tx) =>
          tx.amount === 0
      ),
      false
    );
  }
);

test(
  "Discovery real format preserves representative signed amounts",
  () => {
    const transactions =
      extractDiscoveryTransactions(
        REAL_DISCOVERY_SAMPLE,
        12.98
      );

    assert.equal(
      transactions[0].amount,
      97.5
    );

    assert.equal(
      transactions[1].amount,
      -80
    );

    const transfer =
      transactions.find(
        (tx) =>
          tx.description.includes(
            "Inter account transfer from account...9528"
          )
      );

    assert.equal(
      transfer?.amount,
      150.02
    );

    const eft =
      transactions.find(
        (tx) =>
          tx.description ===
            "EFT Aiden Disco" &&
          tx.amount ===
            1600
      );

    assert.ok(
      eft
    );

    const vodacom =
      transactions.find(
        (tx) =>
          tx.description.includes(
            "VODACOM MINI APPS"
          )
      );

    assert.equal(
      vodacom?.amount,
      -1591.99
    );
  }
);

test(
  "Discovery real format preserves legitimate identical repeated transactions",
  () => {
    const transactions =
      extractDiscoveryTransactions(
        REAL_DISCOVERY_SAMPLE,
        12.98
      );

    const repeated =
      transactions.filter(
        (tx) =>
          tx.date ===
            "30/01/2026" &&
          tx.amount ===
            -85 &&
          tx.description.includes(
            "STOETBUL"
          )
      );

    assert.equal(
      repeated.length,
      2
    );

    assert.notEqual(
      repeated[0].balance,
      repeated[1].balance
    );
  }
);

test(
  "Discovery real format keeps footer and page headers out of descriptions",
  () => {
    const transactions =
      extractDiscoveryTransactions(
        REAL_DISCOVERY_SAMPLE,
        12.98
      );

    const descriptions =
      transactions
        .map(
          (tx) =>
            tx.description
        )
        .join("\n");

    assert.doesNotMatch(
      descriptions,
      /Discovery Place/i
    );

    assert.doesNotMatch(
      descriptions,
      /registered credit provider/i
    );

    assert.doesNotMatch(
      descriptions,
      /FSP number/i
    );

    assert.doesNotMatch(
      descriptions,
      /Date Card no\. Type Details Amount/i
    );
  }
);

test(
  "Discovery real format derives running balances and fully reconciles",
  () => {
    const transactions =
      extractDiscoveryTransactions(
        REAL_DISCOVERY_SAMPLE,
        12.98
      );

    const total =
      round2(
        transactions.reduce(
          (
            sum,
            tx
          ) =>
            sum +
            tx.amount,
          0
        )
      );

    assert.equal(
      total,
      58.75
    );

    assert.equal(
      transactions.at(-1)
        .balance,
      71.73
    );

    assert.equal(
      round2(
        12.98 +
          total
      ),
      71.73
    );
  }
);

test(
  "Discovery flattened real format still reconstructs every transaction",
  () => {
    /*
     * This reproduces the important
     * production failure mode where
     * pdf-parse places several transaction
     * dates on one physical text line.
     */
    const flattened =
      REAL_DISCOVERY_SAMPLE
        .replace(
          /\n/g,
          " "
        );

    const transactions =
      extractDiscoveryTransactions(
        flattened,
        12.98
      );

    const total =
      round2(
        transactions.reduce(
          (
            sum,
            tx
          ) =>
            sum +
            tx.amount,
          0
        )
      );

    assert.equal(
      transactions.length,
      35
    );

    assert.equal(
      total,
      58.75
    );

    assert.equal(
      transactions.at(-1)
        .balance,
      71.73
    );

    assert.doesNotMatch(
      transactions
        .map(
          (tx) =>
            tx.description
        )
        .join("\n"),
      /Discovery Place|FSP number|Date Card no\. Type Details Amount/i
    );
  }
);