import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../netlify/functions/crm-state.mjs';

test('malformed session cookies are rejected without throwing', async () => {
  process.env.CRM_LOGIN_PASSWORD = 'synthetic-password-only';
  process.env.CRM_SESSION_SECRET = 'synthetic-session-secret-at-least-32-characters';
  for (const cookie of ['%', '%E0%A4%A', '%ZZ']) {
    const response = await handler(new Request('https://peppy-salamander-2d8776.netlify.app/.netlify/functions/crm-state?action=session', {
      headers: { cookie: `crm_session=${cookie}` }
    }));
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { authenticated: false });
  }
});
