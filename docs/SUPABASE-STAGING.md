# Shared-auth sign-in rehearsal

This branch adds an opt-in sign-in rehearsal. Production is unchanged unless separately released and configured. `AUTH_PROVIDER=legacy` (or omitted) keeps existing behaviour. The isolated Railway staging service sets `AUTH_PROVIDER=supabase`, its shared `SUPABASE_URL` and the project's public `SUPABASE_PUBLISHABLE_KEY`. Never configure a service-role key for this integration.

Shared mode validates token issuer, audience, role and lifetime, then calls the fixed cluster `/auth/v1/user` endpoint to verify the session. Only a verified active identity whose UUID is explicitly mapped in local `users.supabase_user_id` and whose email still matches the local account can proceed. The request receives the existing local integer ID. Shared JWT metadata never grants local administration. Unknown accounts are denied; there is no automatic email linking or account provisioning.

All legacy `/auth` credential/reset/verification write routes are blocked in shared mode. `/auth/me` remains the app profile contract. Provider/database outages return 503; invalid sessions return 401; absent/mismatched mappings return 403. There is no fallback to custom JWTs in shared mode.

`scripts/migrate-auth-staging.js` adds the unique UUID mapping and allows a null legacy password for a shared-auth-only staging account. It is guarded to the specific isolated Railway project/environment. It preserves local IDs, commercial values, audit records and existing hashes. This script is not a production migration or a permission to import production identities.

Current rehearsal scope: existing verified shared account sign-in, session refresh/local logout, mapped app access, rejected old JWTs and credential writes. Registration/enrolment, recovery callbacks, verification-email delivery, MFA UI, account disabling/revocation guarantees, and actual production identity import remain release acceptance work. Shared password changes must use a separate test identity or explicit owner-directed testing because they affect other apps.

The protected Vercel frontend, Railway test database and fixtures are isolated. OpenAI execution, payments and app email delivery stay disabled in this rehearsal. No shared identity password or existing customer data is changed by configuring this mode.
