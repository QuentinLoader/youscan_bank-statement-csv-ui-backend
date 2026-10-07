# Operations and support

## Configuration

`.env.example` contains placeholders only. Production values remain in Railway. Never copy production keys into documentation, Git, build output or browser variables.

| Settings | Purpose |
| --- | --- |
| `DATABASE_URL`, `JWT_SECRET` | Existing PostgreSQL and customer authentication |
| `YOUSCAN_V2_AI_ENABLED=true`, `YOUSCAN_V2_AI_EXTRACTION_ENABLED=true` | Required AI extraction gates |
| `YOUSCAN_V2_AI_PROVIDER=openai`, `YOUSCAN_V2_AI_MODEL` | Supported provider and configured model |
| `YOUSCAN_V2_OPENAI_API_KEY` or `OPENAI_API_KEY` | Server-only provider credential |
| `YOUSCAN_V2_AI_TIMEOUT_MS` | Task deadline; PDF reading is capped at two minutes |
| `YOUSCAN_V2_AI_MAX_INPUT_CHARS` | Structured-extraction input limit; default 120000 |
| `YOUSCAN_V2_AI_EXTRACTION_MIN_CONFIDENCE`, `YOUSCAN_V2_AI_EXTRACTION_FIELD_MIN_CONFIDENCE` | Existing thresholds; default 0.95; do not lower just to suppress review |
| `APP_URL`, `RESEND_API_KEY` | Email verification and password reset |
| `OZOW_SITE_CODE`, `OZOW_PRIVATE_KEY`, `OZOW_ALLOW_TEST_PAYMENTS` | Existing payment/webhook settings |
| `YOUSCAN_ADMIN_EMAILS` | Existing server-side administration allowlist |
| `YOUSCAN_V2_REVIEW_PERSISTENCE_ENABLED`, `YOUSCAN_V2_REVIEW_ENCRYPTION_KEY` | Optional encrypted review persistence; key must decode to 32 bytes |
| `OPERATIONS_RETENTION_DAYS` | Operational cleanup policy, default 90; range 30-365; manual or externally scheduled cleanup |
| `FRONTEND_ALLOWED_ORIGINS` | Additional exact HTTPS frontend origins for future hosting migration |
| `PORT` | Listener, default 8080 |

The retired classifier flag does not control current AI extraction and is not required by readiness checks. Review encryption/database checks remain required by the admin cutover-readiness report. The current Admin release requires the additive operational schema migration below. No secret rotation is required by this repository cleanup.

## Release

Both repositories use `main`. Push tested commits; configure Railway backend source to `QuentinLoader/youscan_bank-statement-csv-ui-backend`, branch `main`. Frontend source is `QuentinLoader/youscan-finance-frontend`, branch `main`; production publishing is through the existing Lovable project, with custom domain `youscan.addvision.co.za`.

Railway pre-deploy runs `node scripts/migrate-operations.js` on each release. It creates the operational tables idempotently and verifies dashboard queries before new code starts. A failed migration stops the release; do not drop the tables during rollback. For local database setup, run this command before using Admin operations.

Confirm the exact commit in Railway and successful startup. Check `/health/routes`, confirm `/api/v2/parse` is listed and `/parse` is absent, then perform authenticated availability and original-statement acceptance tests. For the frontend, verify the published asset and visible status text. A push alone is not deployment verification.

Before deleting an old branch, verify that its head is an ancestor of `main` or is preserved by an archive tag. Keep historical tags. Do not force-push or discard unique work. `node_modules`, `.env`, build artifacts and confidential statements remain ignored.

## Failure investigation

| Safe code/reason | Action |
| --- | --- |
| `V2_AI_UNAVAILABLE` | Check cached health and associated internal reason; wait for the retry window |
| `insufficient_quota` / `V2_AI_QUOTA_EXHAUSTED` | Restore provider account capacity; do not repeatedly retry documents |
| HTTP 401/403 | Check server credential/configuration with the account owner |
| `V2_AI_RATE_LIMITED` | Respect cooldown; inspect provider limits and bounded retry logs |
| `V2_AI_TIMEOUT` / `V2_AI_PROVIDER_INCOMPLETE` | Inspect duration/stop reason and input size; do not substitute extracted values |
| `V2_PDF_VISION_FAILED` | Investigate complete-page transcription before structured extraction |
| `V2_AI_INVALID_RESPONSE` / `V2_AI_ANALYSIS_REJECTED` | Inspect sanitized validation field/reason codes; retry original PDF and escalate if repeated |
| `V2_UNSUPPORTED_DOCUMENT` / `unrecognized_name` | Check evidence-backed bank identity/alias handling; do not infer a bank from filename/product alone |

Correlate request IDs, timestamps and `POST /api/v2/parse` statuses. GET availability and OPTIONS requests are not successful parses. HTTP 200 establishes request success, not financial correctness. Compare the private original and export before accepting accuracy.

Keep support comparisons private, outside repositories. Save only safe issue codes/counts in audit reports. Never weaken validation, invent missing transactions or restore deterministic extraction to make a failing document appear successful.

## Subscription and payment troubleshooting

See [Commercial plans](COMMERCIAL-PLANS.md). For `SUBSCRIPTION_EXPIRED`, inspect the account's existing plan, active payment status and `renewal_date`; never reset the plan to FREE or grant new lifetime uses. A later `billing_cycle_end` cannot override expiry.

If payment return remains pending, check the owned transaction reference, verified webhook delivery, stored `Complete`/`processed_at` and resulting expiry. `/billing/payment-status` confirms only the authenticated user's matching transaction. Browser return alone cannot grant credits. A missing browser payment reference requires support verification; do not infer success from pre-existing credits. Keep hashes, secrets and payment/customer identifiers out of shared logs or documentation.

Failed, cancelled, pending or duplicate callbacks must not replenish 25 credits or extend the term. A successful early same-plan renewal preserves the remaining term; its new allowance replaces unused monthly credits. No scheduled allowance reset or automatic monthly/yearly payment runs.

## Rollback procedure

Use a verified release tag/commit for a defect rollback while preserving AI-only behavior. Archive tags preserve old code for inspection; `archive/v1-final` is not a production rollback target. Do not reconnect `/parse` or deploy V1 to resolve an AI outage.


## Admin operations

See [Admin operations and support](ADMIN-OPERATIONS.md) for safe schema, stage/reason capture, protected routes, metric limitations, retention, migration/rollback and Vercel frontend settings. Focused tests cover privacy, one terminal outcome, logging outages, filters, support audit, permissions, cached health, separate navigation and visible-only refresh. Full extraction/export regression suites remain required.


## Documentation and repository maintenance

`README.md` indexes current operating documents; `CHANGELOG.md` and `docs/history/` record prior releases rather than current configuration. Keep `main` aligned with `origin/main`. Git archive tags preserve retired implementations; they are not active release branches. Keep private statements, exports, temporary diagnostics and secrets outside versioned repositories. Do not delete commercial records, operational evidence or customer history as part of source cleanup.

## Administrator support

Use Admin Users to manage verified database grants; keep `YOUSCAN_ADMIN_EMAILS` as protected bootstrap/break-glass authority. `USER_NOT_VERIFIED` requires normal email verification. `BOOTSTRAP_ADMIN_PROTECTED` requires a reviewed server-configuration change, not a UI revoke. `FINAL_ADMIN_PROTECTED` requires another effective verified administrator before removing the last database grant. `FORBIDDEN` after revocation is expected; refresh account state. Audit/membership outages must not produce partial successful changes.

Admin unlimited access preserves original plan/credits/expiry. After revocation, an expired or exhausted original plan can legitimately block new processing/first exports. Browser role displays refresh within 30 seconds while visible/on focus; a temporary refresh outage can leave a stale label, but the server still enforces current access. Existing admitted scans are not cancelled. Privilege audits are outside operational failure retention. Review [the complete migration and recovery runbook](ADMINISTRATOR-MANAGEMENT.md) before any approved release.
