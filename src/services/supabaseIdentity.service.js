import jwt from 'jsonwebtoken';

export class IdentityError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

const denied = () => new IdentityError(401, 'INVALID_IDENTITY', 'Invalid or expired sign-in.');
const unavailable = () => new IdentityError(503, 'IDENTITY_UNAVAILABLE', 'Sign-in verification is temporarily unavailable.');
const normalizeEmail = value => String(value || '').trim().toLowerCase();

// The shared Auth service verifies the signature and current identity. Unverified
// JWT claims below are used only for early rejection, never to grant app access.
export function createSupabaseIdentityVerifier({ env = process.env, fetchImpl = fetch, now = Date.now } = {}) {
  return async token => {
    const url = String(env.SUPABASE_URL || '').replace(/\/+$/, '');
    const key = env.SUPABASE_PUBLISHABLE_KEY;
    let parsed;
    try { parsed = new URL(url); } catch { throw unavailable(); }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash || !key) throw unavailable();

    const decoded = jwt.decode(token, { complete: true });
    const claims = decoded?.payload;
    const audience = Array.isArray(claims?.aud) ? claims.aud : [claims?.aud];
    if (!['HS256', 'ES256', 'RS256'].includes(decoded?.header?.alg) || !claims ||
        claims.iss !== `${url}/auth/v1` || !audience.includes('authenticated') ||
        claims.role !== 'authenticated' || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(claims.sub || '') ||
        !Number.isFinite(claims.exp) || claims.exp * 1000 <= now() ||
        (claims.nbf !== undefined && (!Number.isFinite(claims.nbf) || claims.nbf * 1000 > now()))) throw denied();

    let response;
    try {
      response = await fetchImpl(`${url}/auth/v1/user`, {
        headers: { apikey: key, Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8000), redirect: 'error',
      });
    } catch { throw unavailable(); }
    if ([401, 403].includes(response.status)) throw denied();
    if (!response.ok) throw unavailable();
    let identity;
    try { identity = await response.json(); } catch { throw unavailable(); }
    if (identity.id !== claims.sub || !identity.email) throw denied();
    if (!identity.email_confirmed_at || (identity.banned_until && new Date(identity.banned_until).getTime() > now())) {
      throw new IdentityError(403, 'IDENTITY_NOT_VERIFIED', 'A verified active Addvision account is required.');
    }
    if (identity.factors?.some(factor => factor.status === 'verified') && claims.aal !== 'aal2') {
      throw new IdentityError(403, 'MFA_REQUIRED', 'Complete two-factor sign-in before accessing YouScan.');
    }

    return { id: identity.id, email: normalizeEmail(identity.email) };
  };
}

export function createSupabaseAuthenticator(options = {}) {
  const verify = createSupabaseIdentityVerifier(options);
  return async token => {
    const identity = await verify(token);
    let result;
    try { result = await options.dbPool.query('SELECT id, email, is_verified FROM users WHERE supabase_user_id=$1 LIMIT 1', [identity.id]); }
    catch { throw unavailable(); }
    const user = result.rows[0];
    if (!user || normalizeEmail(user.email) !== normalizeEmail(identity.email)) {
      throw new IdentityError(403, 'ACCOUNT_NOT_LINKED', 'This Addvision account does not have linked YouScan access.');
    }
    // Local verification and administrator grants remain app-specific gates.
    // Neither JWT metadata nor a shared cluster role grants local privileges.
    return { userId: user.id, supabaseUserId: identity.id };
  };
}
