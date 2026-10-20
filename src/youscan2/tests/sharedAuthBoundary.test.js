import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import { once } from 'node:events';

test('shared-auth mode closes legacy sign-in, registration and reset routes and rejects custom JWTs', async () => {
  process.env.AUTH_PROVIDER = 'supabase';
  process.env.SUPABASE_URL = 'https://cluster.example.invalid';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'synthetic-public-key';
  process.env.RESEND_API_KEY = 're_synthetic_no_delivery';
  process.env.JWT_SECRET = 'synthetic-old-token-secret';
  const { default: authRoutes } = await import('../../routes/auth.routes.js');
  const app = express(); app.use(express.json()); app.use('/auth', authRoutes);
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/auth`;
  try {
    for (const route of ['login', 'register', 'forgot-password', 'reset-password', 'change-password', 'resend-verification', 'verify-email']) {
      const response = await fetch(`${url}/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      assert.equal(response.status, 409, route);
      assert.equal((await response.json()).code, 'SHARED_AUTH_MANAGED');
    }
    const token = jwt.sign({ userId: 42 }, process.env.JWT_SECRET);
    const response = await fetch(`${url}/me`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(response.status, 401);
    const disabledEnrolment = await fetch(`${url}/enrol`, { method: 'POST' });
    assert.equal(disabledEnrolment.status, 409);
    assert.equal((await disabledEnrolment.json()).code, 'ENROLMENT_DISABLED');
    process.env.SHARED_ENROLMENT_ENABLED = 'true';
    const missingIdentity = await fetch(`${url}/enrol`, { method: 'POST' });
    assert.equal(missingIdentity.status, 401);
    const forgedIdentity = await fetch(`${url}/enrol`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    assert.equal(forgedIdentity.status, 401);
  } finally { delete process.env.SHARED_ENROLMENT_ENABLED; server.close(); await once(server, 'close'); }
});
