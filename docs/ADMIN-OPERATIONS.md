# YouScan Admin operations and failure support

## Architecture and confidentiality

Admin opens in a separate browser tab; the original scanner stays mounted. Keep that tab open: closing or reloading it still loses its browser queue/results. Same-origin authentication is shared through the existing login. Every operations API also verifies the configured administrator allowlist on the server.

Backend source lives in GitHub, backend runtime and Postgres stay on Railway. Structured records in Postgres are the operational source of truth; no local logfile or email subscription is added. Uploads remain in memory for processing. This feature stores no PDFs, account numbers, identity, transaction descriptions, financial values, filenames, provider responses, arbitrary error messages or stack traces.

## Failure capture and audit

`processing_attempts` records a UUID support reference, nullable parse job UUID, start/update/end timestamps, stage, terminal outcome, duration, deployment commit and bounded allowlisted diagnostics. Stages are availability, upload, PDF reading, AI extraction, validation and completed. Terminal outcomes are success, review_required, failed and rejected. Each authenticated submission begins before plan/availability/upload checks; each subsequent file receives its own attempt. Authentication/rate-limit failures before the parse handler are not extraction attempts. Waiting files removed in the browser never become attempts.

Known provider failures preserve their original reason before the public temporary-unavailable response. Examples: V2_AI_QUOTA_EXHAUSTED, V2_AI_RATE_LIMITED, V2_AI_TIMEOUT, provider HTTP 401/403, V2_AI_CONFIG_INVALID, V2_AI_INVALID_RESPONSE and V2_UNSUPPORTED_DOCUMENT. Safe failed field paths and rule codes are retained where supplied by the validator. Missing evidence is reported as unspecified; do not infer a cause from a generic code. Provider request IDs require a constrained provider prefix. Successful/review attempts also retain bounded warning types, row indices, classification/AI confidence and validation score without values or evidence snippets.

`processing_resolution_history` records administrator ID, time, prior/new support status and a controlled resolution reason. Open / investigating / resolved / reopen changes never replace failure evidence, alter extracted data, change user review state or affect billing. Duplicate updates to the same state do not add a new event. Browser-only customer corrections and their history remain in existing parsed-result/debug data; this does not create a new durable customer document store.

Writes are awaited with 750 ms connection/query/server statement limits using a two-connection telemetry pool. Store failures emit a safe structured console fallback and cannot substitute deterministic extraction or prevent a valid result. A server crash can leave an unfinished attempt; after 15 minutes without a stage update it is shown as outcome unknown, not asserted to be a timeout. Final database records survive process replacement; process-local last-write health returns to unknown on restart.

## Protected APIs

- GET /api/admin/operations: operational overview, provider cached snapshot (no live provider probe), telemetry/database health, coverage, 14-day attempt/ledger/billing metrics.
- GET /api/admin/failures: date/stage/code/support-status/reference filters, 25 rows per page, bounded page number.
- GET /api/admin/failures/:id: original safe evidence and resolution history.
- POST /api/admin/failures/:id/resolution: `{state,reason}`. Allowed states: open, investigating, resolved. Reasons: investigation_started, retry_succeeded, fix_deployed, document_issue, provider_recovered, no_action_needed, reopened.
- POST /api/admin/operations/cleanup: bounded maintenance, up to 1,000 expired operational attempts per call. Cascade removes their resolution history only. No payment/export/account tables are touched.

Existing /metrics, /users and /cutover-readiness remain available. Only confirmed, processed Complete payments count as successful payments. Registered-user emails remain available only in the existing protected account directory; they are not copied into telemetry.

## Metric definitions and limits

Coverage starts at additive migration time; no historical failures are fabricated. The initial rollout was 7 October 2026 in Africa/Johannesburg (6 October UTC). Earlier errors are not imported; they may still be available in Railway runtime logs subject to its retention. Empty filters show all captured failures. For 6 October UTC, set From to 2026-10-06 and Before to 2026-10-07, leaving other filters empty; these UTC boundaries differ from a South African calendar day. Records survive backend restarts/deployments because they live in Postgres, independently of the running app process. Processing counts describe file extraction, not HTTP availability checks or OPTIONS. Review_required means review at extraction time; a customer may subsequently resolve it in the browser. In a legacy multi-file API request, a file can be processed successfully before a later file fails the overall request: processing success does not prove delivery/export or financial correctness.

Active means a server attempt with a stage update within 15 minutes. Unfinished older attempts are unknown. Browser waiting queue length is not available. Slow means a completed attempt exceeded two minutes. Duration covers accepted-request checks and file processing; the initial file includes upload/access checks.

First export counts come from the unique v2_export_ledger. Free allowances, paid credits and unlimited authorisations are separated. Downloading two formats or re-exporting the same job never creates a second ledger entry. Repeat download counts and browser save completion are not measured. Billing expiry uses renewal_date; missing expiry is treated as expired/missing, with no free-plan reset.

Admin overview refreshes every 60 seconds only while visible, plus manual refresh/on return. Failures refresh on filters or manually. Display timestamps use Africa/Johannesburg; date filters are UTC boundaries, with the end date exclusive.

## Retention and maintenance

Operational default retention is 90 days; OPERATIONS_RETENTION_DAYS permits 30-365. A trusted admin or external scheduler must call the protected cleanup endpoint, repeating bounded calls until deleted is zero. No process-local timer or new paid scheduler is created. Until scheduled, cleanup is manual: the retention period is a cleanup policy, not an automatic TTL. Commercial history is outside this retention policy. A restricted automated caller must retain administrator authentication securely; never put its token in the frontend.

## Rollout and rollback

Railway pre-deploy runs `node scripts/migrate-operations.js`. The additive idempotent migration commits the tables and verifies dashboard queries before the new backend starts. If verification fails deployment stops, previous code continues, and additive tables remain. Deploy backend before publishing frontend. A code rollback preserves the tables and captured records; do not drop tables as rollback. No existing extraction/validation thresholds, provider tasks or commercial rules are changed.

For support: open Failures, filter the reference/time/code, inspect stage and field paths, mark investigating, test a safe fix, then mark resolved with its reason. Retryable is guidance, not a promise of provider recovery. Provider health displayed here is cached and may be absent/expired until normal analysis traffic checks it.

## Future Vercel frontend

The committed frontend vercel.json uses Vite dist and SPA index fallback. Set VITE_API_URL to the existing Railway backend and add the exact HTTPS frontend origin to FRONTEND_ALLOWED_ORIGINS (comma-separated); existing production/Lovable origins remain accepted. Set environment before building. Test /admin and /admin?failure=UUID directly, login/logout and authenticated API CORS. Auth continuity holds within the same frontend origin; a temporary new domain needs a new login. No database/API/payment credentials belong in frontend environment variables.

Only the frontend migration is prepared; hosting/domains are unchanged. Moving the backend separately would require evaluating upload limits, long-running AI tasks, native PDF tooling, pooling and shared provider state. Official SPA guidance: https://vercel.com/docs/frameworks/frontend/vite

## Administrator management

Admin Users extends beyond the email directory. Effective authority becomes verified bootstrap-email or database membership, checked by the backend. Users includes grant/revoke confirmation and privilege history; Usage separates no-credit administrator exports from paid Pro exports. The pre-deploy script also applies `src/administration/schema.sql`. Production deployment was explicitly approved on 7 October 2026; [Administrator management](ADMINISTRATOR-MANAGEMENT.md) defines security, entitlement and rollout details.
