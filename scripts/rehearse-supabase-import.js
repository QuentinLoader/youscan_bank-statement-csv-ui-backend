import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import { pathToFileURL } from 'node:url';

// Operator-only, never invoked by an HTTP route. Creates one synthetic identity
// through the supported Auth Admin API; never changes an existing identity.
export async function rehearseHashImport({ url, adminKey, email, fetchImpl = fetch }) {
  if (url !== 'https://nysyurwlggaklhskmzma.supabase.co') throw new Error('Rehearsal stopped: target is not the approved Authentication Cluster');
  if (!/^loaderquentin\+youscan-import-[a-z0-9-]+@gmail\.com$/.test(email || '')) throw new Error('Rehearsal stopped: synthetic email format is invalid');
  adminKey = String(adminKey || '').trim();
  if (!adminKey) throw new Error('Rehearsal stopped: administrator key was empty');
  if (adminKey.startsWith('sb_publishable_')) throw new Error('Rehearsal stopped: publishable key supplied; use the existing secret or service_role key at the hidden prompt');
  const password = crypto.randomBytes(32).toString('base64url');
  const hash = await bcrypt.hash(password, 10);
  let createdId;
  let accessToken;
  let signedOut = false;
  async function request(path, body, { method = 'POST', token = adminKey, allowDenied = false } = {}) {
    const response = await fetchImpl(`${url}/auth/v1${path}`, { method, headers: { apikey: adminKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error', signal: AbortSignal.timeout(20000) });
    if (allowDenied && [400, 401].includes(response.status)) return { denied: true };
    if (!response.ok) throw new Error(`Import rehearsal request failed (${response.status})`);
    if (response.status === 204) return {};
    return response.json();
  }
  try {
    const created = await request('/admin/users', { email, password_hash: hash, email_confirm: true });
    if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(created.id || '')) throw new Error('Fixture creation returned no usable identity ID; inspect the synthetic fixture before retrying');
    createdId = created.id;
    const session = await request('/token?grant_type=password', { email, password });
    accessToken = session.access_token;
    if (!accessToken || session.user?.id !== createdId) throw new Error('Imported hash did not authenticate its synthetic owner');
    const denied = await request('/token?grant_type=password', { email, password: crypto.randomBytes(32).toString('base64url') }, { allowDenied: true });
    if (!denied.denied) throw new Error('Wrong password was not rejected');
    await request('/logout?scope=local', undefined, { token: accessToken });
    signedOut = true;
    return { bcryptCost: 10, supportedAdminApi: true, importedPasswordWorks: true, wrongPasswordRejected: true, existingIdentityModified: false };
  } finally {
    // Only the ID returned by this invocation's successful create is eligible
    // for cleanup. Never find/delete an account by an email match.
    if (createdId) {
      if (accessToken && !signedOut) await request('/logout?scope=local', undefined, { token: accessToken });
      await request(`/admin/users/${createdId}`, undefined, { method: 'DELETE' });
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv.includes('--execute')) {
    console.log('Prepared only. Execute requires --execute, SUPABASE_ADMIN_KEY and an unused YOUSCAN_IMPORT_TEST_EMAIL. Never put the key in chat, source control or a frontend.');
  } else {
    try {
      const result = await rehearseHashImport({ url: process.env.SUPABASE_URL, adminKey: process.env.SUPABASE_ADMIN_KEY, email: process.env.YOUSCAN_IMPORT_TEST_EMAIL });
      console.log(JSON.stringify({ checkedAt: new Date().toISOString(), ...result, syntheticIdentityRemoved: true }));
    } catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
