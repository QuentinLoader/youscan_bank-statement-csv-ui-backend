# QA and release acceptance

## Automated checks

```sh
npm ci
npm test
```

The backend suite covers availability caching/cooldowns, provider failures, structured extraction/evidence, bank aliases, AI-only jobs, parse/export APIs, review ownership/encryption, commercial accounting and payment security. The production import-graph test prevents legacy endpoint/parser reintroduction. Bank-specific deterministic regression tests are preserved in the pre-cleanup archive tag and are not current V2 acceptance tests.

Frontend checks in the companion repository:

```sh
npm ci
npm test
npx tsc --noEmit -p tsconfig.app.json
npm run build
```

Focused status tests cover success/resolved, unresolved field navigation and unreliable extraction. Availability and progress tests cover upload blocking, retries and waiting feedback. CI runs these checks on pushes and pull requests.

## Private real-document acceptance

For each supported bank/layout, compare the original PDF with the extracted result and CSV: row count, descriptions, dates, signs, payment/fee treatment, opening/closing balances and page completeness. Inspect repeated/zero rows and summaries separately. Arithmetic agreement alone does not prove row accuracy.

Priority specimens: FNB 4 brand/legal footer recognition; Gold Business Account 43 source-table row count and accrued charges; Capitec attached fees; ABSA identity; Standard Bank descriptions/signs. Nedbank was recognised by AI and its latest request returned successfully on 7 October 2026; this is processing verification, not private original-to-CSV accuracy acceptance. Nedbank and Discovery still require that financial accuracy check.

Test one statement first, then a batch of two or three. Verify a document failure preserves the other results and a provider outage stops the batch. A smaller batch does not solve one slow document; assess per-file duration separately.

Confirm:

- AI unavailable blocks processing with the generic system message.
- No failed AI result becomes usable or exportable.
- Clean/resolved data shows `Processed successfully` without internal warning clutter.
- Genuine unresolved fields show `Review fields` and direct navigation.
- Unsafe extraction shows a clear retry/support action.
- Export consumes allowance once; re-export is free; failure/review/discard does not charge.
- Authentication, password reset, billing and admin remain operational.
- Logs and committed files contain no confidential statement contents.

Live financial correctness remains a separate acceptance gate from mocked tests and health checks. Do not mark a specimen verified until it has been compared privately with the original.

## Renewal acceptance

Check monthly and annual warnings at seven days, three days and exact expiry. Expired subscriptions retain their plan/history and receive no fresh FREE allowance. Confirm that the current-plan renewal button creates the normal Ozow form, an unsuccessful/pending payment changes no entitlement, and only the signed successful webhook extends the term. Replay must not extend it again. PAYG remains once-off. Payment return must stay pending until the matching owned transaction is confirmed. Use synthetic automated coverage; any real payment requires deliberate customer acceptance.

## Other known limits

AI may still omit or misread fields. Unsupported/malformed documents fail safely. Health is process-local. The browser is not a durable job queue. The frontend retains pre-existing repo-wide lint debt, a bundle-size warning and stale Browserslist data; focused changed-file lint, typecheck, tests and build are the current release checks. Dependency upgrades need their own compatibility review.


## Admin operations

See [Admin operations and support](ADMIN-OPERATIONS.md) for safe schema, stage/reason capture, protected routes, metric limitations, retention, migration/rollback and Vercel frontend settings. Focused tests cover privacy, one terminal outcome, logging outages, filters, support audit, permissions, cached health, separate navigation and visible-only refresh. Full extraction/export regression suites remain required.

## Administrator management

Run `npm test`; CI supplies isolated PostgreSQL 16 through `ADMIN_TEST_DATABASE_URL` for migration replay, concurrent final-admin protection and export separation. Local runs without this setting explicitly skip the engine test. Focused security tests cover unverified/unauthorized/stale-role requests, bootstrap/final-admin rejection, atomic audit rollback, unchanged stored plans/credits, expiry bypass and restoration after revocation. Frontend acceptance checks confirmation/errors, separate-tab Admin, no upgrade/renewal prompts and transient profile-refresh outages. See [acceptance steps](ADMINISTRATOR-MANAGEMENT.md). Production acceptance follows the approved backend/schema and frontend release.
