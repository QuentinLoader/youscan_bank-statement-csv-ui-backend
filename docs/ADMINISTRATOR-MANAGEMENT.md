# Administrator management

**Prepared release, pending explicit production deployment approval.** This supplements the existing Admin operations dashboard. `main` remains the production source; the implementation is on `codex/administrator-management` until approved.

## Authority and security

Effective administrators are verified accounts whose email is in the server's `YOUSCAN_ADMIN_EMAILS` bootstrap list, or whose user ID has an `administrator_memberships` row. The existing fallback bootstrap identity remains unchanged when the setting is absent. Configure the list explicitly in production. Bootstrap entries are not imported into the revocable membership table.

Backend checks consult the user and database membership on every new protected request; JWT/browser role fields are not authority. `/auth/me` and `/billing/status` return `is_admin`, `admin_unlimited`, `admin_source` and `bootstrap_admin`, alongside the actual commercial plan. User/profile responses are not cached. A missing role store fails closed for database membership; a verified configured bootstrap account can still authorize without a membership lookup. This is not a bypass for a database outage, expired authentication or unverified email.

Admin → Users lists email, verification, stored plan and administrator access. Grant/revoke requires confirmation. Only verified users can be promoted. A stale grant on a subsequently unverified account is ineffective and may be revoked by another administrator. Bootstrap accounts cannot be granted/revoked through this interface. Operators must use the reviewed server configuration change procedure for bootstrap changes; these are outside the database-managed privilege audit.

Role changes acquire a PostgreSQL exclusive transaction advisory lock, then recheck the actor. The target user is locked before changing membership. The final registered, verified effective administrator cannot be revoked. Concurrent self-revocations cannot both succeed, and an actor already revoked before their transaction runs cannot grant another user. Configured bootstrap emails without a verified registered account do not count toward this protection. Direct database/configuration edits remain an operator responsibility and must not bypass lockout safeguards casually.

Each actual grant/revoke inserts actor ID, target ID, action and timestamp in `administrator_privilege_audit` within the same transaction. An audit failure rolls the privilege change back. Repeating the same requested state is idempotent and creates no duplicate event. Audit IDs survive deletion of the account; no credentials, free-text reasons or financial data are stored in this audit. It is separate from the 90-day processing-failure cleanup policy.

## APIs

| Endpoint | Purpose |
| --- | --- |
| `GET /api/admin/users` | Minimal management directory and server-calculated grant/revoke eligibility |
| `POST /api/admin/users/:id/administrator` | JSON `{ "action": "grant" }` or `{ "action": "revoke" }`; authenticated actor is rechecked in the transaction |
| `GET /api/admin/privilege-audit?page=1` | Private paged privilege history, 25 records per page |

Known denial codes include `USER_NOT_VERIFIED`, `BOOTSTRAP_ADMIN_PROTECTED`, `FINAL_ADMIN_PROTECTED`, `FORBIDDEN`, `USER_NOT_FOUND` and `INVALID_PRIVILEGE_CHANGE`. All existing Admin operational endpoints use the same effective-administrator authority. Any signed-in user is insufficient; changing frontend state cannot grant backend access.

## Unlimited administrator entitlement

An effective administrator receives unlimited processing and exports as a separate entitlement. Grants/revocations do **not** change `plan_code`, credits, lifetime FREE usage, payment status or renewal dates. Existing request/provider rate limits, authentication, verification and AI-only validation still apply; unlimited entitlement is not a promise of provider availability.

Admins bypass FREE exhaustion, paid-credit checks and subscription expiry. First exports consume no FREE use or paid credit. Export/usage rows retain the stored plan and explicitly record `entitlement_source=administrator`. Normal usage records `commercial`; historical rows default to commercial because past bootstrap accounts previously followed normal billing rules. The Usage dashboard separates administrator exports from paid Pro exports. Confirmed payment revenue continues to use real processed Ozow transactions; no administrator grant fabricates a Pro subscription/payment.

The scanner shows **Administrator - Unlimited** and suppresses renewal/upgrade prompts. Admin opens in a separate tab, preserving the original scanning page. Profiles refresh on focus, relevant same-origin cross-tab changes, and every 30 seconds while visible; temporary network errors do not log out an active scan. The backend immediately enforces revocation for new requests after commit, even when browser UI or a JWT is stale. An AI request already admitted is not cancelled, but its first export is reauthorized. Export transactions share the advisory lock so an overlapping export/revocation has a defined serial order. Old authorized jobs remain freely downloadable while the browser still holds their parsed results.

After revocation, the original plan and untouched credit/expiry values apply. An expired paid plan is blocked, an exhausted FREE account remains exhausted, and no new allowance is granted. Historical admin usage retains its original source classification.

## Migration and release

`src/administration/schema.sql` adds membership/audit tables and entitlement-source columns to `v2_export_ledger` and `usage_logs`. It creates indexes for membership ownership/granter and audit ordering. The existing `node scripts/migrate-operations.js` pre-deploy entry point applies both additive idempotent schemas transactionally with a five-second lock timeout, then verifies dashboard queries. Existing account/export/usage tables must already exist.

Do not execute this against production or publish frontend/main until explicit deployment approval. After approval: apply schema via backend pre-deploy, verify the backend, then publish the frontend. Do not drop audit/usage columns on code rollback; retain evidence. If migration/dashboard verification fails, stop the release and inspect schema compatibility. Restore bootstrap configuration through trusted server operations if database-managed access needs recovery.

## Acceptance and tests

Backend tests cover verified-only grants, unauthorized/stale actors, bootstrap/final-admin protection, concurrency, audit rollback, idempotency, every stored plan, separate usage, free re-export and revocation enforcement. Frontend tests cover confirmation/errors, protected controls, unlimited/no-renewal UI, profile refresh and transient outages.

CI supplies an isolated PostgreSQL 16 service and runs `administratorPostgres.test.js` against real SQL, including migration replay, concurrent lockout, unchanged credits and separate Usage totals. For a local run set `ADMIN_TEST_DATABASE_URL` to an isolated loopback test database and run `npm test`. The test creates/drops only its random fixture schema and rejects remote URLs; never use production credentials. Without that setting the engine test is explicitly skipped.

Manual acceptance after approved release: promote a verified test account; check its untouched commercial plan/credits, unlimited scanning, separate Admin navigation and export totals; revoke it from another admin and confirm the original plan limits immediately apply to new backend requests. Confirm unverified/bootstrap/final-admin denials and audit history. Use synthetic or authorized confidential statements without adding PDFs/results to Git.
