import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import handler, { __test } from '../netlify/functions/whatsapp-status-webhook.mjs';

function signed(body, secret) {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}

test('webhook verifies GET challenge and rejects incorrect verification token', async () => {
  const previous = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = 'fixture-verify-token';
  try {
    const ok = await handler(new Request('https://test.invalid/.netlify/functions/whatsapp-status-webhook?hub.mode=subscribe&hub.verify_token=fixture-verify-token&hub.challenge=challenge-123'));
    assert.equal(ok.status, 200);
    assert.equal(await ok.text(), 'challenge-123');
    const bad = await handler(new Request('https://test.invalid/?hub.mode=subscribe&hub.verify_token=bad&hub.challenge=x'));
    assert.equal(bad.status, 403);
  } finally {
    if (previous === undefined) delete process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN; else process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = previous;
  }
});

test('webhook rejects missing or invalid Meta signature before accessing database', async () => {
  const previous = { secret: process.env.WHATSAPP_APP_SECRET, fetch: globalThis.fetch };
  process.env.WHATSAPP_APP_SECRET = 'fixture-app-secret';
  let fetchCalls = 0;
  globalThis.fetch = async () => { fetchCalls++; throw new Error('should not access database'); };
  try {
    const response = await handler(new Request('https://test.invalid/', { method: 'POST', body: '{"entry":[]}' }));
    assert.equal(response.status, 401);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = previous.fetch;
    if (previous.secret === undefined) delete process.env.WHATSAPP_APP_SECRET; else process.env.WHATSAPP_APP_SECRET = previous.secret;
  }
});

test('signed status webhook updates only mocked provider status rows', async () => {
  const previous = {
    secret: process.env.WHATSAPP_APP_SECRET,
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
    fetch: globalThis.fetch
  };
  process.env.WHATSAPP_APP_SECRET = 'fixture-app-secret';
  process.env.SUPABASE_URL = 'https://supabase.test.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-server-secret-for-tests';
  const body = JSON.stringify({ entry: [{ changes: [{ value: { statuses: [
    { id: 'wamid.TEST_ONLY_1', status: 'delivered', timestamp: '1791633600', recipient_id: '5515000000000' },
    { id: 'wamid.TEST_ONLY_2', status: 'failed', timestamp: '1791633601', errors: [{ code: 131026, title: 'fixture failure' }] }
  ] } }] }] });
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options, body: JSON.parse(options.body) });
    return new Response(JSON.stringify([{ id: 'fixture-attempt' }]), { status: 200 });
  };
  try {
    const response = await handler(new Request('https://test.invalid/', { method: 'POST', headers: { 'x-hub-signature-256': signed(body, process.env.WHATSAPP_APP_SECRET) }, body }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, received: 2, updated: 2, unmatched: 0 });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].body.provider_status, 'delivered');
    assert.equal(calls[1].body.provider_status, 'failed');
    assert.equal(calls[1].body.provider_error_code, '131026');
  } finally {
    globalThis.fetch = previous.fetch;
    for (const [name, value] of [['WHATSAPP_APP_SECRET', previous.secret], ['SUPABASE_URL', previous.url], ['SUPABASE_SERVICE_ROLE_KEY', previous.key]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});

test('signature verifier rejects tampering', () => {
  assert.equal(__test.verifySignature('{"a":1}', signed('{"a":1}', 'secret'), 'secret'), true);
  assert.equal(__test.verifySignature('{"a":2}', signed('{"a":1}', 'secret'), 'secret'), false);
});
