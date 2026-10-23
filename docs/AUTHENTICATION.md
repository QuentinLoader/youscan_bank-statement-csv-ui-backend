# Production Addvision authentication

YouScan production moved to the Addvision Authentication Cluster on 23 October
2026. Railway retains the application database and existing integer customer IDs.
`users.supabase_user_id` maps each reviewed shared UUID to its original account;
this does not transfer billing data or administrator authority into Supabase.

The four existing verified accounts were mapped in a guarded transaction. Every
other business row was compared before/after using counts and digests. Plans,
credits, renewal dates, payment/usage/export history and administrator grants were
preserved. Three shared identities kept their existing passwords; the missing
identity received its existing bcrypt hash through the supported Auth Admin API.
Legacy hashes are retained for controlled recovery, never accepted in shared mode.

## Runtime configuration

- `AUTH_PROVIDER=supabase`
- `SUPABASE_URL=https://nysyurwlggaklhskmzma.supabase.co`
- `SUPABASE_PUBLISHABLE_KEY`: the cluster's public client key, never an admin key
- `APP_URL=https://youscan.addvision.co.za`
- `YOUSCAN_V2_AI_TIMEOUT_MS=180000`; existing AI/mail/payment credentials preserved
- `SHARED_ENROLMENT_ENABLED=false`: existing migrated accounts work; opening new
  local accounts requires a separately approved change to this gate

The verifier checks issuer, audience, role and lifetime, then calls the fixed
cluster `/auth/v1/user`. A verified active identity must match an explicit local
UUID and email mapping. MFA-enabled identities require AAL2. User metadata never
grants administrator access. Local administrator memberships remain authoritative.
Provider outages fail closed; unknown identities receive ACCOUNT_NOT_LINKED.
There is no automatic linking by email and no legacy token fallback.

Legacy password/reset/verification writes are blocked. `/auth/me` still returns
the local customer profile. Old custom JWTs are rejected. Users who already had an
Addvision account use that password, which can differ from their old YouScan one.

## Recovery and operation

The frontend uses the existing cluster's SMTP and exact callback
`https://youscan.addvision.co.za/auth/callback`. Preserve the shared Site URL, SMTP
and other applications' redirects. Recovery uses PKCE in the requesting browser;
copy the recovery email link into the provided same-browser form if a mail client
opens links elsewhere. A shared password change affects other Addvision apps.

Owner confirmed production sign-on and reported recovery seemed fine. This is
owner acceptance, not independent evidence of every customer's login or a charge.
Detailed restricted migration evidence remains outside the repository. No live
payment was created for acceptance. Incident credential rotation was explicitly
deferred by the owner; this release does not resolve that separate work.

Migration-only staging API/database/volume and Vercel project were removed. The
staging callback was removed and the disposable identity deleted through the
supported Admin API. Do not recreate them from old deployment links. The retained
synthetic hash-import harness is exercised by unit tests; it does not deploy a
staging environment or run automatically. Admin keys belong only in private
operator processes and must never be stored on this web service or in Git.

After any release verify the runtime provider, final callback, API health/CORS,
owner profile/entitlements, administrator access, rejected old sessions and recovery.
Once shared passwords change or shared-only accounts exist, reverting to legacy
authentication alone is not a safe rollback. Preserve identity mappings and fix
forward with a compatible shared-auth frontend/backend pair.
