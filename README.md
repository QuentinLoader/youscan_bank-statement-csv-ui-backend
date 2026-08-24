# YouScan V2

**South African Bank Statement → Structured Data → CSV**

YouScan V2 converts supported South African bank statements into structured, validated transaction data that can be reviewed and exported to CSV.

The system combines deterministic bank-specific extraction, balance reconciliation, document classification, controlled AI assistance, human review, authentication, commercial usage controls, billing, and administration in a single production workflow.

---

# 1. Current Release Status

## YouScan V2 MVP — Frozen Baseline

Frozen production baseline:

| Component | Branch | Frozen Commit |
|---|---|---|
| Backend | `youscan-v2-revival` | `d6c7d88` |
| Frontend | `main` | `ea9580d` |

Frozen on:

**24 August 2026**

The MVP parser scope for the six supported South African banks is complete.

Do not reopen bank-specific parser tuning unless:

- a genuine production statement fails;
- a regression is reproduced;
- reconciliation produces an incorrect result;
- transaction data is materially lost or corrupted; or
- a supported bank materially changes its statement layout.

---

# 2. What YouScan Does

YouScan allows a user to:

1. Sign in.
2. Upload one or more bank-statement PDFs.
3. Automatically identify the bank and document type.
4. Extract transaction data.
5. Normalize it into a common YouScan schema.
6. Validate transaction arithmetic and running balances.
7. Reconcile opening balance, transactions, and closing balance.
8. Surface uncertain statements for review.
9. Allow the user to review, accept, correct, or discard statements.
10. Export validated or explicitly accepted statements to CSV.
11. Consume commercial usage only when a document is successfully exported for the first time.
12. Re-export the same document without another charge.

---

# 3. Supported Banks

YouScan V2 currently supports:

| Bank | MVP Status | Notes |
|---|---|---|
| ABSA | ✅ Supported | Real-statement validated and hardened |
| FNB | ✅ Supported | Real-statement validated; scanned/image-only PDF recovery supported |
| Standard Bank | ✅ MVP Supported | Best-fit MVP support; known difficult layouts may safely route to review |
| Capitec | ✅ Supported | Multiple real statements validated and reconciled |
| Nedbank | ✅ Supported | Real statement validated and reconciled |
| Discovery Bank | ✅ Supported | Real statement validated with full reconciliation |

## Discovery production acceptance example

Final production validation:

- Transactions: **35**
- Opening balance: **R12.98**
- Net transaction movement: **R58.75**
- Calculated closing balance: **R71.73**
- PDF closing balance: **R71.73**
- Validation: **100%**
- Result: **Balanced**

Statement period:

**05 Jan 2026 – 04 Feb 2026**

---

# 4. Standard Bank MVP Note

Standard Bank remains intentionally classified as **best-fit MVP support**.

A difficult real-world specimen produced:

- 38 of 40 transactions extracted;
- safe reconciliation warnings;
- `needs_review` rather than an incorrect silent success.

This behavior is accepted for the MVP.

The parser must not be loosened merely to force a `completed` result.

Safe review is preferred over incorrect financial data.

---

# 5. Core Design Principle

The primary design rule of YouScan V2 is:

> Accuracy before automation.

The system must never silently invent, repair, reinterpret, or overwrite financial data simply to make a statement reconcile.

If deterministic evidence is insufficient, the system should:

- flag the statement;
- return `needs_review`;
- expose the reason;
- preserve the extracted source data;
- allow explicit human review.

---

# 6. Processing Flow

The high-level processing pipeline is:

```text
PDF Upload
    ↓
Authentication / Access Check
    ↓
Text Extraction
    ↓
Scanned-PDF Recovery if Required
    ↓
Document Classification
    ↓
Bank Detection
    ↓
Bank-Specific Deterministic Extractor
    ↓
Canonical Normalization
    ↓
Transaction Validation
    ↓
Opening / Movement / Closing Reconciliation
    ↓
Optional AI Advisory / Shadow Analysis
    ↓
Completed OR Needs Review
    ↓
Human Review / Accept / Discard
    ↓
CSV Export Authorization
    ↓
First Successful Export Recorded
    ↓
Commercial Usage Consumed
```

---

# 7. Deterministic Extraction

Bank-statement extraction is primarily deterministic.

Each supported bank has bank-specific extraction rules.

The parser handles issues commonly found in PDF statements, including:

- wrapped transaction descriptions;
- merged PDF columns;
- dates glued to descriptions;
- amounts glued to text;
- page headers repeated inside transaction histories;
- footers appearing between transaction pages;
- debit/credit indicators;
- negative balances;
- running-balance inference;
- amount-only transaction timelines;
- statement summary sections;
- informational rows;
- zero-value declined transactions;
- repeated legitimate transactions;
- fused monetary fields.

The deterministic extractor remains the authoritative source unless a human explicitly reviews a proposed difference.

---

# 8. Canonical Bank Statement Model

All supported banks are normalized into one common model.

Conceptually:

```json
{
  "bankName": "Discovery Bank",
  "accountNumber": "…",
  "clientName": "…",
  "statementPeriodStart": "05/01/2026",
  "statementPeriodEnd": "04/02/2026",
  "openingBalance": 12.98,
  "closingBalance": 71.73,
  "transactions": [
    {
      "date": "08/01/2026",
      "description": "Transaction description",
      "amount": 97.50,
      "balance": 110.48
    }
  ]
}
```

Canonical transaction fields are:

- date;
- description;
- signed amount;
- running balance where available or safely derivable.

Statement-level fields include:

- bank;
- account number;
- client name;
- statement period;
- opening balance;
- closing balance.

---

# 9. Reconciliation

YouScan performs statement-level reconciliation.

The central equation is:

```text
Opening Balance
+
Sum of Transactions
=
Calculated Closing Balance
```

The calculated closing balance is compared with the closing balance printed on the PDF.

Example:

```text
Opening PDF             R12.98
+ Transaction Movement  R58.75
--------------------------------
Calculated Closing      R71.73
PDF Closing             R71.73

Balanced ✓
```

Reconciliation failures remain visible.

The parser must not rewrite source values purely to make reconciliation pass.

---

# 10. Validation

Validation checks include, where applicable:

- valid transaction dates;
- valid statement dates;
- transaction dates within statement period;
- numeric transaction amounts;
- running-balance continuity;
- opening balance;
- closing balance;
- transaction count consistency;
- duplicate AI rows;
- statement reconciliation;
- bank identity;
- classification confidence;
- structural extraction quality.

A clean statement can reach:

```text
Validation 100%
Balanced
```

A statement with material uncertainty can return:

```text
needs_review
```

rather than silently proceeding.

---

# 11. Review Workflow

A statement may require review when:

- reconciliation fails;
- transaction continuity fails;
- classification is uncertain;
- deterministic extraction and AI differ materially;
- a required value is missing;
- a source statement itself contains inconsistent financial information.

The user can:

- inspect issues;
- fix values where supported;
- accept the extracted result;
- discard the document.

An explicitly accepted review result may be exported while preserving its warning history.

Discarding a document does not consume commercial usage.

---

# 12. AI Architecture

AI is an assistive layer, not the primary financial parser.

The current production AI provider is:

**OpenAI**

Current production model used for V2 AI functions:

```text
gpt-5.6
```

AI functionality includes:

- weak/ambiguous document classification assistance;
- structured extraction comparison;
- shadow accuracy analysis;
- scanned/image-only PDF text recovery;
- controlled review proposals.

AI must not silently replace deterministic financial data.

---

# 13. AI Safety Rules

The V2 AI design deliberately fails closed.

Important rules:

- deterministic output remains authoritative;
- malformed AI output is rejected;
- low-confidence output cannot auto-correct a statement;
- bank disagreement triggers review;
- transaction amount disagreements are treated as high risk;
- transaction count disagreements are critical;
- invalid dates are rejected;
- fabricated evidence is rejected;
- AI provider failure does not corrupt deterministic output;
- unavailable AI does not turn a valid deterministic parse into a failure;
- AI review proposals cannot automatically apply themselves.

OpenAI structured requests use strict schemas.

Production Responses API requests use:

```text
store=false
```

to avoid retaining submitted document content for model training/storage through that request mechanism.

---

# 14. Scanned and Image-Only PDFs

Native PDF text extraction is always preferred.

If a PDF contains no useful native text, YouScan can invoke vision-based text recovery.

Flow:

```text
PDF
 ↓
Native Text Extraction
 ↓
Useful Text?
 ├─ Yes → deterministic parser
 └─ No  → vision recovery
              ↓
          recovered text
              ↓
        deterministic parser
```

The scanned-PDF recovery mechanism has been production-tested with FNB statements.

Operational logs include structural information such as:

- page count;
- native text length;
- recovered text length;
- model used;
- duration;
- retry count.

Raw statement text is not intentionally written to normal diagnostic logs.

---

# 15. AI Failure Handling

Temporary AI failure is handled separately from parser failure.

Examples include:

- rate limiting;
- OpenAI service errors;
- quota exhaustion;
- timeouts.

A scanned PDF that requires AI recovery may return a temporary AI-unavailable condition rather than being incorrectly classified as an unsupported bank.

Rate-limit retries are bounded.

---

# 16. Commercial Model

The core V2 commercial rule is:

> A credit is consumed on the first successful CSV export of a document.

It is **not** consumed when a document is uploaded or parsed.

## Usage rules

| Action | Charge |
|---|---:|
| Upload PDF | 0 |
| Parse PDF | 0 |
| Validation | 0 |
| Review | 0 |
| Failed document | 0 |
| Unsupported document | 0 |
| Discarded document | 0 |
| First successful CSV export | 1 allowance / credit |
| Re-export same document | 0 |
| Failed export | 0 |
| Batch export | 1 per successfully exported document |
| Unlimited plan export | Recorded, but 0 credits deducted |

The live usage action is:

```text
export_csv_v2
```

---

# 17. Export Idempotency

V2 uses an export ledger.

The first successful export for a V2 `jobId` is recorded.

Subsequent exports of the same already-recorded document do not consume another credit.

This protects users from being charged repeatedly when:

- downloading the CSV again;
- retrying a browser download;
- returning to an already-paid document.

---

# 18. Plans

Existing YouScan commercial plans are preserved.

| Plan | Allowance | Price |
|---|---|---:|
| FREE | 15 lifetime successful uses | Free |
| PAYG_10 | 10 credits | R29.50 |
| MONTHLY_25 | 25 credits | R48.50 |
| PRO_YEAR_UNLIMITED | Unlimited while active | R485 |

Plan rules remain governed by the existing commercial backend.

For V2, usage is now applied at successful first export rather than parse.

---

# 19. Billing

Billing uses the existing YouScan commercial infrastructure.

Current payment provider:

**Ozow**

Key billing properties include:

- payment creation;
- payment verification;
- callback validation;
- deterministic hashing;
- idempotent completion;
- plan activation;
- existing-plan preservation.

Invalid callbacks must not mutate plans.

Duplicate successful callbacks must not grant credits twice.

---

# 20. Authentication

YouScan endpoints require authenticated access where appropriate.

The frontend contains Supabase integration and authenticated session handling.

Backend protected routes use authentication middleware.

Sensitive routes include:

- V2 parse;
- V2 review;
- export authorization;
- admin metrics;
- registered-user administration.

The frontend API client uses the configured backend URL and authenticated requests.

---

# 21. Admin Dashboard

The production Admin dashboard includes:

## Summary

- Total users
- Signups — Last 14 Days
- Signups — Previous 14 Days
- Payments — Last 14 Days

## Users by Plan

- Free
- Pay As YouScan
- Monthly 25
- Pro Year Unlimited

## V2 Activity

- Exports — Last 14 Days
- Exports — Previous 14 Days
- Review Cases — Total
- Reviews — Open

## Review Workflow

- Pending Review
- Partially Reviewed
- Reviewed
- Review Cases

## Registered Users

Admin users can see a privacy-limited registered-email list.

The registered-user endpoint deliberately does not expose:

- passwords;
- tokens;
- credit balances;
- plan details;
- other unnecessary account data.

Admin access is controlled through an email allowlist.

Environment configuration:

```text
YOUSCAN_ADMIN_EMAILS
```

---

# 22. Production Admin Metric Semantics

V2 activity metrics count:

```text
action = 'export_csv_v2'
```

They no longer treat parsing as commercial usage.

This means:

```text
27 Exports — Last 14 Days
```

means 27 recorded first successful V2 export events.

It does not mean:

- 27 users;
- 27 uploads;
- 27 parse attempts.

---

# 23. Backend Technology

Primary backend technologies:

- Node.js
- Express
- PostgreSQL
- Railway
- OpenAI Responses API
- existing YouScan billing/authentication infrastructure

Primary V2 backend area:

```text
src/youscan2/
```

Important supporting areas include:

```text
src/controllers/
src/routes/
src/middleware/
src/config/
```

---

# 24. Frontend Technology

The frontend uses:

- React 18
- TypeScript
- Vite
- Tailwind CSS
- shadcn/ui
- Radix UI
- TanStack Query
- Supabase JS
- Vitest

Current package baseline includes:

```text
React             18.3.x
TypeScript        5.8.x
Vite              5.4.x
Vitest            3.2.x
Tailwind CSS      3.4.x
Supabase JS       2.x
```

Frontend repository:

```text
youscan-finance-frontend
```

Production branch:

```text
main
```

---

# 25. Backend Repository

Backend repository:

```text
youscan_bank-statement-csv-ui-backend
```

V2 development/production branch at freeze:

```text
youscan-v2-revival
```

Frozen backend commit:

```text
d6c7d88
fix: report V2 exports in admin metrics
```

Previous cleanup commit:

```text
4cbeb9c
chore: remove temporary Capitec parser diagnostics
```

---

# 26. Frontend Frozen Commit

Frontend frozen commit:

```text
ea9580d
fix: show V2 export activity in admin dashboard
```

Statement-period mapping immediately prior:

```text
60ed321
fix: preserve V2 statement period in transactions
```

---

# 27. Production Backend URL

The frontend uses `VITE_API_URL` when configured.

Known production backend:

```text
https://youscan-statement-csv-ui-backend-production.up.railway.app
```

Frontend configuration:

```text
VITE_API_URL
```

If no frontend environment override is supplied, the frontend currently has production backend fallback behavior in its API configuration.

---

# 28. AI Configuration

Confirmed V2 PDF vision model configuration:

```text
YOUSCAN_V2_PDF_VISION_MODEL=gpt-5.6
```

Production also requires the configured OpenAI provider credentials and V2 AI feature flags used by the backend.

The exact active flag and secret names are enforced by the current backend configuration and cutover-readiness code.

Do not introduce duplicate AI environment variables merely for documentation consistency.

The source of truth is the checked-in production configuration code.

---

# 29. Review Persistence

The review system supports persistent encrypted review cases.

Security properties include:

- authentication required;
- user ownership scoping;
- encrypted sensitive proposal data;
- AES-GCM encryption;
- review payload bound to ownership context;
- stale proposal detection;
- explicit review decisions;
- audit history;
- no automatic apply/merge operation.

The production review encryption configuration requires a valid secret key when persistent review is enabled.

Never commit review encryption secrets to Git.

---

# 30. Important Backend Source Areas

Typical V2 structure:

```text
src/
└── youscan2/
    ├── extractor/
    │   ├── absa/
    │   ├── fnb/
    │   ├── standardbank/
    │   ├── capitec/
    │   ├── nedbank/
    │   ├── discovery/
    │   └── shared/
    │
    ├── commercial/
    ├── review/
    ├── cutover/
    ├── tests/
    └── utils/
```

Notable file:

```text
src/youscan2/utils/extractTextFromFile.js
```

This contains native PDF extraction and scanned-PDF recovery handling.

Admin metrics:

```text
src/routes/admin.js
```

Export charging / usage recording:

```text
src/controllers/usage.controller.js
```

---

# 31. Important Frontend Source Areas

Important V2 frontend files include:

```text
src/components/StatementProcessor.tsx
src/components/DocumentSection.tsx
src/components/BankSummaryCard.tsx
src/components/BankSummaryCards.tsx
src/hooks/useTransactionValidation.ts
src/lib/v2.ts
src/pages/Admin.tsx
src/lib/api.ts
```

Responsibilities include:

### `StatementProcessor.tsx`

- upload workflow;
- V2 API submission;
- batch processing;
- response handling.

### `DocumentSection.tsx`

- document-level review UI;
- validation state;
- transaction count;
- review/accept presentation.

### `BankSummaryCards.tsx`

- bank summary aggregation;
- credits/debits;
- statement period;
- opening/closing balance.

Statement period uses authoritative V2:

```text
statementPeriodStart
statementPeriodEnd
```

rather than simply first/last transaction date.

### `useTransactionValidation.ts`

Frontend presentation-level validation.

Duplicate detection does not flag legitimate same-date/same-amount payments merely because their values match.

A potential duplicated extraction also requires matching description and running balance.

### `src/lib/v2.ts`

Maps the canonical backend response into frontend transaction/document structures.

It preserves:

```text
statementPeriodStart
statementPeriodEnd
```

on the mapped transaction data.

---

# 32. V2 Parse API

Primary frontend V2 processing endpoint:

```text
POST /api/v2/parse
```

The endpoint:

- requires authentication;
- processes supported statements;
- returns canonical data;
- does not charge for parsing;
- can return completed or needs-review states.

Commercial charging is deferred until export.

---

# 33. Admin APIs

Important admin endpoints include:

```text
GET /api/admin/metrics
GET /api/admin/users
```

Both are protected.

Admin access uses the configured server-side administrator allowlist.

---

# 34. Review API Security

Review APIs require authentication.

Review cases are scoped to the authenticated user.

The normal parsing response deliberately avoids exposing sensitive AI proposal values.

Sensitive values are retrieved only through authorized review-case detail paths.

There is deliberately no general endpoint that automatically applies an AI proposal.

---

# 35. Logging

Production logging should remain privacy-conscious.

Allowed useful operational data includes:

- parser stage;
- error code;
- document structure counts;
- page count;
- timing;
- retry count;
- AI availability;
- selected model.

Avoid logging:

- full bank statement text;
- complete transaction descriptions;
- passwords;
- API keys;
- access tokens;
- payment secrets;
- bank credentials.

Stage-aware parser diagnostics sanitize unsafe content.

Temporary bank-specific structural debugging must be removed once the related parser defect is solved.

The temporary Capitec structure logging was removed before the MVP freeze.

---

# 36. Testing

## Backend

Run the complete V2 test suite:

```bash
node --test ./src/youscan2/tests/*.test.js
```

Last explicitly confirmed full V2 regression baseline before the final admin metric rename:

```text
Tests:   332
Passed:  328
Failed:  0
Skipped: 4
```

After the export-based Admin metric update, its targeted regression suite passed:

```text
Tests:  6
Pass:   6
Fail:   0
```

Bank/parser and commercial changes should always run the full V2 suite before release.

---

# 37. Frontend Testing

Run:

```bash
npm test
```

Current confirmed frontend baseline:

```text
Test Files: 3 passed
Tests:      10 passed
```

Production build:

```bash
npm run build
```

Targeted lint:

```bash
npx eslint <changed-files>
```

Before committing:

```bash
git diff --check
git status --short
```

---

# 38. Known Frontend Lint Debt

The production frontend builds and its active V2 tests pass.

A repo-wide ESLint run currently contains pre-existing technical debt in unrelated files.

At the final V2 cleanup, the full repo lint showed:

```text
24 errors
12 warnings
```

The relevant files modified during the final V2 cleanup passed targeted ESLint.

This lint backlog should be handled as a separate maintenance batch.

Do not combine broad lint refactoring with bank-parser or commercial release fixes.

---

# 39. Build Warnings

The frontend build currently warns that the main JavaScript bundle exceeds Vite's default 500 kB warning threshold.

This is a performance-maintenance issue rather than a functional release blocker.

Future improvement may include:

- route-level dynamic imports;
- manual chunking;
- lazy loading;
- separating large optional views.

The project also reports stale Browserslist/caniuse-lite data.

This can be updated independently from functional V2 releases.

---

# 40. Production Deployment

## Backend

Hosted on:

**Railway**

The current V2 branch is:

```text
youscan-v2-revival
```

Railway deploys the configured branch.

Before relying on a newly pushed fix:

1. confirm the Git commit exists on origin;
2. confirm Railway deployed that commit;
3. wait for deployment status to become active;
4. perform the production acceptance test.

## Frontend

Production branch:

```text
main
```

Changes should be:

1. built locally;
2. tested;
3. committed;
4. pushed;
5. allowed to deploy;
6. verified through the production UI.

---

# 41. Safe Git Workflow

Before editing:

```bash
git status -sb
git log -3 --oneline --decorate
```

Before commit:

```bash
git diff --check
git status --short
```

Commit only intended files.

After push:

```bash
git status -sb
git log -2 --oneline --decorate
```

Expected final state:

```text
HEAD == origin/<branch>
working tree clean
```

Avoid amending frozen production checkpoints unless the underlying files genuinely need to change.

---

# 42. OneDrive / Git Note

The backend repository has previously experienced Git automatic-GC object-lock issues while located inside OneDrive.

Repository-local automatic GC was disabled to avoid disruptive file-lock cleanup during active development.

Do not manually delete `.git/objects`.

Any future repository maintenance should be performed carefully with backups and a clean working tree.

---

# 43. Production Acceptance Rules

A supported statement should be considered successfully parsed when:

- bank classification is appropriate;
- transactions are complete enough for the supported parser contract;
- opening balance is correct;
- closing balance is correct;
- transactions have correct signs;
- reconciliation succeeds; or
- any genuine discrepancy is safely routed to review.

The system must not treat `needs_review` as a parser failure when review is the correct safe outcome.

---

# 44. Unsupported Documents

Documents that cannot confidently be identified as one of the supported bank-statement formats must not be silently routed to another bank parser.

Unsupported documents:

- return an unsupported/review-safe result;
- do not consume commercial usage;
- do not silently guess a bank;
- do not generate a paid export unless successfully resolved.

---

# 45. Batch Processing

YouScan supports multi-document processing.

Batch behavior:

- each document is parsed independently;
- a problem document does not unnecessarily invalidate clean documents;
- review-required documents remain individually reviewable;
- export charging is per successfully exported document;
- already-exported documents are not charged twice.

---

# 46. CSV Export Principle

The CSV export should represent the reviewed canonical transaction data.

A successful export is the commercial consumption boundary.

This distinction is fundamental:

```text
Parse != Charge

Successful first export = Charge
```

Do not move billing back to parse/upload without an explicit commercial decision and coordinated backend/frontend migration.

---

# 47. Security Principles

The MVP follows these rules:

- authenticated access to protected APIs;
- server-side admin authorization;
- no secret values in normal API responses;
- no AI proposal auto-apply;
- encrypted review persistence;
- strict AI output schemas;
- rate-limit handling;
- payment callback verification;
- usage/export idempotency;
- privacy-safe operational logging.

Secrets must remain environment variables and never be committed.

---

# 48. Known MVP Limitations / Technical Debt

The following are known and intentionally not mixed into the frozen MVP parser release.

## Standard Bank edge cases

Some real layouts may not extract every transaction perfectly.

Safe review behavior is preferred.

## Frontend repo-wide lint

Pre-existing lint errors remain outside the final V2 files.

## Frontend bundle size

The application currently produces a bundle-size warning.

## Export ownership hardening

The MVP export ledger identifies successful exports by V2 job/document identifiers.

Stronger persisted document ownership verification should be considered as a future security-hardening item.

## Parser maintenance

Banks can change PDF layouts without notice.

Real-world fixtures and regression tests should be added whenever a new layout is encountered.

---

# 49. Do Not Regress These Rules

Future development must preserve the following invariants:

1. Parsing does not consume a credit.
2. Failed documents do not consume a credit.
3. Unsupported documents do not consume a credit.
4. Review does not consume a credit.
5. Discard does not consume a credit.
6. First successful CSV export consumes one allowance where applicable.
7. Re-exporting the same document does not consume another credit.
8. Unlimited plans deduct zero credits.
9. AI may advise but must not silently rewrite authoritative deterministic values.
10. Ambiguous bank identity must not be guessed.
11. Genuine reconciliation failures remain visible.
12. Production logs must not expose statement content or secrets.

---

# 50. Release Checklist

Before any future production release:

### Backend

- [ ] Working tree clean before changes
- [ ] Correct branch confirmed
- [ ] Targeted tests pass
- [ ] Full V2 regression passes
- [ ] `git diff --check` passes
- [ ] No temporary parser diagnostics
- [ ] No sensitive logging added
- [ ] Commit pushed
- [ ] Railway deploy active

### Frontend

- [ ] Correct `main` branch
- [ ] `npm run build` passes
- [ ] `npm test` passes
- [ ] Changed files pass targeted ESLint
- [ ] `git diff --check` passes
- [ ] Production deployment active

### Production

- [ ] Login works
- [ ] Upload works
- [ ] Supported statement parses
- [ ] Review workflow works
- [ ] CSV exports
- [ ] First export records usage
- [ ] Re-export is free
- [ ] Unsupported statement is not charged
- [ ] Admin dashboard loads
- [ ] Export metrics increment correctly
- [ ] No sensitive information appears in logs

---

# 51. Frozen YouScan V2 MVP Checkpoint

As of **24 August 2026**, the accepted frozen production checkpoint is:

## Backend

```text
Repository:
youscan_bank-statement-csv-ui-backend

Branch:
youscan-v2-revival

Commit:
d6c7d88
fix: report V2 exports in admin metrics
```

## Frontend

```text
Repository:
youscan-finance-frontend

Branch:
main

Commit:
ea9580d
fix: show V2 export activity in admin dashboard
```

Production validation has confirmed:

- ABSA support
- FNB support
- Standard Bank MVP support
- Capitec support
- Nedbank support
- Discovery Bank support
- reconciliation
- human review behavior
- export-based charging
- export idempotency
- authoritative statement-period presentation
- corrected duplicate-warning behavior
- export-based admin metrics

This checkpoint should be treated as the stable V2 MVP baseline.

---

# 52. Development Policy After Freeze

The V2 MVP is now frozen.

New work should fall into one of three categories:

### Production defect

A reproducible defect affecting current functionality.

These may justify a patch to the frozen baseline.

### Hardening / maintenance

Examples:

- lint cleanup;
- bundle optimization;
- security hardening;
- logging improvements;
- test coverage;
- performance.

These should be isolated from parser changes.

### New product capability

Examples:

- additional banks;
- additional export formats;
- reporting;
- accounting integrations;
- enhanced admin analytics.

These should be developed as explicit post-MVP features rather than silently modifying the frozen V2 behavior.

---

# 53. Final Product Definition

YouScan V2 is a production bank-statement processing system for supported South African banks that:

- identifies statements;
- extracts transactions;
- validates financial consistency;
- reconciles balances;
- handles difficult PDF layouts;
- recovers scanned PDFs where configured;
- uses AI conservatively;
- supports human review;
- protects users from incorrect automatic corrections;
- exports canonical transaction data;
- charges only on successful first export;
- prevents duplicate export charges;
- supports existing YouScan plans and Ozow billing;
- provides operational administration and export metrics.

The frozen MVP prioritizes financial accuracy and safe review over forced automation.