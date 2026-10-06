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
| `PORT` | Listener, default 8080 |

The retired classifier flag does not control current AI extraction and is not required by readiness checks. Review encryption/database checks remain required by the admin cutover-readiness report. This cleanup needs no database migration or secret rotation.

## Release

Both repositories use `main`. Push tested commits; configure Railway backend source to `QuentinLoader/youscan_bank-statement-csv-ui-backend`, branch `main`. Frontend source is `QuentinLoader/youscan-finance-frontend`, branch `main`; production publishing is through the existing Lovable project, with custom domain `youscan.addvision.co.za`.

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

## Rollback

Use a verified release tag/commit for a defect rollback while preserving AI-only behavior. Archive tags preserve old code for inspection; `archive/v1-final` is not a production rollback target. Do not reconnect `/parse` or deploy V1 to resolve an AI outage.
