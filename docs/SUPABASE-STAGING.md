# Shared-auth configuration and sign-in rehearsal

The shared-auth implementation belongs to the common `main` codebase. Production authentication is unchanged unless separately configured and its identity migration accepted. `AUTH_PROVIDER=legacy` (or omitted) keeps existing behaviour. The isolated Railway staging service sets `AUTH_PROVIDER=supabase`, its shared `SUPABASE_URL` and the project's public `SUPABASE_PUBLISHABLE_KEY`. Never configure a service-role key for this integration. A source merge does not execute the operator scripts below or change customer identity mappings.

Shared mode validates token issuer, audience, role and lifetime, then calls the fixed cluster `/auth/v1/user` endpoint to verify the session. Only a verified active identity whose UUID is explicitly mapped in local `users.supabase_user_id` and whose email still matches the local account can proceed. The request receives the existing local integer ID. Shared JWT metadata never grants local administration. Unknown accounts are denied; there is no automatic email linking or account provisioning.

All legacy `/auth` credential/reset/verification write routes are blocked in shared mode. `/auth/me` remains the app profile contract. Provider/database outages return 503; invalid sessions return 401; absent/mismatched mappings return 403. There is no fallback to custom JWTs in shared mode.

The separately gated `POST /auth/enrol` supports deliberate new-user enrolment. It requires `AUTH_PROVIDER=supabase` and `SHARED_ENROLMENT_ENABLED=true`, validates the actual verified shared identity, and optionally restricts it through `SHARED_ENROLMENT_ALLOWED_EMAILS`. The staging rehearsal must use the dedicated test-address allowlist. Request bodies and shared metadata cannot select an account, plan, credit balance or administrator grant. A repeated join returns the existing ID without replenishing allowance; a legacy email match returns a conflict and needs an operator-reviewed migration. This route does not import shared identities or change passwords.

`scripts/migrate-auth-staging.js` adds the unique UUID mapping and allows a null legacy password for a shared-auth-only staging account. It is guarded to the specific isolated Railway project/environment. It preserves local IDs, commercial values, audit records and existing hashes. This script is not a production migration or a permission to import production identities.

Existing verified shared account sign-in, session refresh/local logout, mapped app access, rejected old JWTs and legacy credential writes passed the initial rehearsal. Dedicated-identity registration/confirmation, explicit enrolment and PKCE password recovery subsequently passed live browser/email acceptance, including successful new-password sign-in and old-password rejection. Optional MFA setup/challenge code has automated coverage; no live factor was enrolled. Actual production identity import and account disabling/revocation guarantees remain separate release work. Shared password changes must use a separate test identity or explicit owner-directed testing because they affect other apps.

`applyReviewedIdentityMappings` is an operator-only primitive requiring a caller-owned transaction and an independently verified mapping manifest. No HTTP route invokes it. It locks and checks all supplied local accounts before updating only their UUID mappings; callers must roll back on any error. A temporary-table rehearsal against the staging Postgres schema proved preservation and reversal for four synthetic accounts and six account/history tables. It does not prove a Supabase password-hash import or a database-backup restore.

The protected Vercel frontend, Railway test database and fixtures are isolated. OpenAI was enabled with an owner-installed staging key for synthetic and representative statement acceptance; provider/model remain the existing service. Staging payments and app email delivery remain disabled; shared-auth emails use the cluster's existing SMTP. No existing shared identity password or customer data is changed by configuring this mode. Production retains its own provider settings and three-minute AI timeout.

## Prepared hash-import rehearsal

`scripts/rehearse-supabase-import.js` defaults to preparation only. Its explicit
`--execute` mode requires the fixed cluster URL, a server-only SUPABASE_ADMIN_KEY
and an unused YOUSCAN_IMPORT_TEST_EMAIL matching the dedicated Gmail import-test
alias pattern. Never put an admin key in a frontend, source control or chat.
Prefer a one-time authorised operator process rather than persisting the shared
cluster's administrator credential on the staging web service.

The harness generates a random password in memory, creates one ordinary verified
synthetic identity through the supported Admin API using a bcrypt cost-10 hash,
verifies that password and rejects a random wrong password, signs out the test
session, then removes only the UUID returned by this invocation's create call.
It never updates an existing identity; a create conflict stops without deleting
an email match. Passwords/hashes/tokens are not logged. A failed cleanup must be
resolved before accepting the rehearsal. Local tests cover the hash exchange and
duplicate-create boundary; they are not evidence of a live provider import.

The connected tools expose SQL/management and public keys, not an Auth Admin
connection. The owner completed the private local live rehearsal on 20 October:
imported-password acceptance, wrong-password rejection and cleanup passed, and a
separate aggregate check found no remaining synthetic import identities. This is
not an actual customer migration. Keep any future administrator credential in the
private operator process. Do not hand-write shared auth.users/auth.identities tables.
